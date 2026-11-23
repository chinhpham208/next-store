import 'server-only'
import { and, asc, count, eq, gte, inArray, lt, sql } from 'drizzle-orm'
import { cartItems, carts, dbQuery, products, type Db } from '@/db'
import { CART_TTL_DAYS, MAX_CART_LINES, MAX_LINE_QUANTITY } from '@/features/cart/limits'
import type { CartId } from '@/features/cart/schema'
import type { CartError, CartLine } from '@/features/cart/types'

// Reads and writes of the cart by id: no cookie, no header, so it runs on PGlite in tests (conventions.md §1).
// `now` is a parameter for the same reason, and so one request uses one cutoff for every statement.
//
// There is no trigger on carts.updated_at (audit PR #69): every write of a cart (Tasks 5, 6) must set it itself,
// and reads never do — only a write slides the expiry (ADR-0014 6A).
//
// Stock is read here, inside the write's transaction, never through the products feature: getProductBySlug is
// cached for hours, and the server is where the stock check is decided (plan M4 Global Constraints).

const DAY_MS = 86_400_000

/** Carts last written before this are expired and read as empty, even before they are purged. */
export const cartExpiryCutoff = (now: Date): Date => new Date(now.getTime() - CART_TTL_DAYS * DAY_MS)

const liveCart = (cartId: CartId, now: Date) => and(eq(carts.id, cartId), gte(carts.updatedAt, cartExpiryCutoff(now)))

export const readCartLines = async (cartId: CartId, now: Date): Promise<CartLine[]> => {
  const rows = await dbQuery({
    name: 'cart.lines',
    run: (db) =>
      db
        .select({
          slug: products.slug,
          name: products.name,
          image: products.image,
          // The current price, never a snapshot (ADR-0014 4A).
          price: products.price,
          quantity: cartItems.quantity,
          stock: products.stock,
        })
        .from(cartItems)
        .innerJoin(carts, eq(cartItems.cartId, carts.id))
        .innerJoin(products, eq(cartItems.productId, products.id))
        .where(liveCart(cartId, now))
        // product_id breaks ties: lines added in one transaction share created_at.
        .orderBy(asc(cartItems.createdAt), asc(cartItems.productId)),
  })
  return rows.map((row) => ({ ...row, lineTotal: row.price * row.quantity }))
}

export const countCartItems = async (cartId: CartId, now: Date): Promise<number> => {
  const [row] = await dbQuery({
    name: 'cart.count',
    run: (db) =>
      db
        .select({ count: sql`coalesce(sum(${cartItems.quantity}), 0)`.mapWith(Number) })
        .from(cartItems)
        .innerJoin(carts, eq(cartItems.cartId, carts.id))
        .where(liveCart(cartId, now)),
  })
  return row?.count ?? 0
}

/**
 * `missing-cart`: the id names no live cart (unknown or expired); the action then starts a new cart with a new id.
 * `invalid` and `unavailable` are the action's own: input parsing and database failures never reach the store.
 */
export type AddLineResult =
  | { ok: true; count: number }
  | { ok: false; error: Exclude<CartError, 'invalid' | 'unavailable'> | 'missing-cart'; available?: number }

type CartTx = Parameters<Parameters<Db['transaction']>[0]>[0]

// Step 1 of every write of an existing cart, as in addLine: takes the row lock (writes of one cart run one after
// the other, plan M4 D3) and slides the expiry. An unknown or expired cart matches no row.
const lockCart = async (tx: CartTx, cartId: CartId, now: Date): Promise<boolean> => {
  const locked = await tx
    .update(carts)
    .set({ updatedAt: now })
    .where(liveCart(cartId, now))
    .returning({ id: carts.id })
  return locked.length > 0
}

const countInTx = async (tx: CartTx, cartId: CartId): Promise<number> => {
  const [total] = await tx
    .select({ count: sql`coalesce(sum(${cartItems.quantity}), 0)`.mapWith(Number) })
    .from(cartItems)
    .where(eq(cartItems.cartId, cartId))
  return total?.count ?? 0
}

type AddLineInput = { cartId: CartId; slug: string; quantity: number; create: boolean; now: Date }

/**
 * Adds `quantity` of a product to a cart in one transaction, after every check passes; a refusal writes nothing.
 * `create: true` inserts the cart with `cartId` (a new server-generated id, never one from the cookie).
 */
export const addLine = async ({ cartId, slug, quantity, create, now }: AddLineInput): Promise<AddLineResult> =>
  dbQuery({
    name: 'cart.add',
    transaction: async (tx): Promise<AddLineResult> => {
      // First, before reading the line: the row lock makes every write of one cart wait for the previous one to
      // commit (two tabs run side by side, plan M4 D3), so the check below sees what the other wrote.
      if (!create && !(await lockCart(tx, cartId, now))) return { ok: false, error: 'missing-cart' }

      const [product] = await tx
        .select({ id: products.id, stock: products.stock })
        .from(products)
        .where(eq(products.slug, slug))
      if (product === undefined) return { ok: false, error: 'not-found' }

      const [line] = await tx
        .select({ quantity: cartItems.quantity })
        .from(cartItems)
        .where(and(eq(cartItems.cartId, cartId), eq(cartItems.productId, product.id)))
      // What is already in the cart counts against the stock (US-08: 2 in the cart + 2 more, 3 left → refused).
      const wanted = (line?.quantity ?? 0) + quantity

      if (product.stock === 0) return { ok: false, error: 'out-of-stock' }
      if (wanted > product.stock) return { ok: false, error: 'over-stock', available: product.stock }
      if (wanted > MAX_LINE_QUANTITY) return { ok: false, error: 'line-limit' }
      // A new cart has no lines yet, so only an existing one can be full.
      if (line === undefined && !create) {
        const [lines] = await tx.select({ value: count() }).from(cartItems).where(eq(cartItems.cartId, cartId))
        if ((lines?.value ?? 0) >= MAX_CART_LINES) return { ok: false, error: 'cart-full' }
      }

      // Only now: a first add that was refused leaves no empty cart behind.
      if (create) await tx.insert(carts).values({ id: cartId, createdAt: now, updatedAt: now })
      await tx
        .insert(cartItems)
        .values({ cartId, productId: product.id, quantity, createdAt: now })
        .onConflictDoUpdate({
          target: [cartItems.cartId, cartItems.productId],
          set: { quantity: sql`${cartItems.quantity} + excluded.quantity` },
        })

      return { ok: true, count: await countInTx(tx, cartId) }
    },
  })

/**
 * Errors of an update or a removal. No `line-limit` (the action's schema caps the quantity) and no `cart-full` (an
 * update never adds a line). `missing-cart`: the action answers with an empty cart; it never creates one.
 */
export type SetLineResult =
  | { ok: true; count: number }
  | { ok: false; error: 'not-found' | 'out-of-stock' | 'over-stock' | 'missing-cart'; available?: number }

type SetLineInput = { cartId: CartId; slug: string; quantity: number; now: Date }

/**
 * Sets the quantity of a line already in the cart; 0 removes it (US-07). Never creates a line or a cart.
 * Lowering is always allowed, even while the line stays above the stock (ADR-0014 10A): only raising is checked.
 */
export const setLine = async ({ cartId, slug, quantity, now }: SetLineInput): Promise<SetLineResult> =>
  dbQuery({
    name: 'cart.set',
    transaction: async (tx): Promise<SetLineResult> => {
      if (!(await lockCart(tx, cartId, now))) return { ok: false, error: 'missing-cart' }

      const [product] = await tx
        .select({ id: products.id, stock: products.stock })
        .from(products)
        .where(eq(products.slug, slug))
      if (product === undefined) return { ok: false, error: 'not-found' }
      const ofLine = and(eq(cartItems.cartId, cartId), eq(cartItems.productId, product.id))

      if (quantity === 0) {
        await tx.delete(cartItems).where(ofLine)
        return { ok: true, count: await countInTx(tx, cartId) }
      }

      const [line] = await tx.select({ quantity: cartItems.quantity }).from(cartItems).where(ofLine)
      // The stock is checked only when raising: a line already above it (stock fell since the add) can go down.
      if (quantity > (line?.quantity ?? 0)) {
        if (product.stock === 0) return { ok: false, error: 'out-of-stock' }
        if (quantity > product.stock) return { ok: false, error: 'over-stock', available: product.stock }
      }
      if (line === undefined) return { ok: false, error: 'not-found' }

      await tx.update(cartItems).set({ quantity }).where(ofLine)
      return { ok: true, count: await countInTx(tx, cartId) }
    },
  })

type RemoveLineInput = { cartId: CartId; slug: string; now: Date }

/** Removes a line; a line (or a product) that is not there is still `ok` (idempotent). */
export const removeLine = async ({ cartId, slug, now }: RemoveLineInput): Promise<SetLineResult> =>
  dbQuery({
    name: 'cart.remove',
    transaction: async (tx): Promise<SetLineResult> => {
      if (!(await lockCart(tx, cartId, now))) return { ok: false, error: 'missing-cart' }
      await tx
        .delete(cartItems)
        .where(
          and(
            eq(cartItems.cartId, cartId),
            inArray(cartItems.productId, tx.select({ id: products.id }).from(products).where(eq(products.slug, slug))),
          ),
        )
      return { ok: true, count: await countInTx(tx, cartId) }
    },
  })

/** Most expired carts one purge deletes (ADR-0014 7A), so the add that triggers it stays quick. */
const PURGE_BATCH = 50

/** Deletes up to 50 of the oldest expired carts; their lines go with them (ON DELETE CASCADE). One statement. */
export const purgeExpiredCarts = async (now: Date): Promise<void> => {
  await dbQuery({
    name: 'cart.purge',
    run: (db) =>
      db.delete(carts).where(
        inArray(
          carts.id,
          db
            .select({ id: carts.id })
            .from(carts)
            .where(lt(carts.updatedAt, cartExpiryCutoff(now)))
            .orderBy(asc(carts.updatedAt))
            .limit(PURGE_BATCH),
        ),
      ),
  })
}
