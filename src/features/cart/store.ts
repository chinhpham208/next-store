import 'server-only'
import { and, asc, count, eq, gte, inArray, lt, sql } from 'drizzle-orm'
import { cartItems, carts, dbQuery, products } from '@/db'
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

type AddLineInput = { cartId: CartId; slug: string; quantity: number; create: boolean; now: Date }

/**
 * Adds `quantity` of a product to a cart in one transaction, after every check passes; a refusal writes nothing.
 * `create: true` inserts the cart with `cartId` (a new server-generated id, never one from the cookie).
 */
export const addLine = async ({ cartId, slug, quantity, create, now }: AddLineInput): Promise<AddLineResult> =>
  dbQuery({
    name: 'cart.add',
    transaction: async (tx): Promise<AddLineResult> => {
      if (!create) {
        // First, before reading the line: the row lock makes every write of one cart wait for the previous one
        // to commit (two tabs run side by side, plan M4 D3), so the check below sees what the other wrote. It
        // also slides the expiry; an expired cart matches no row and stays expired.
        const locked = await tx
          .update(carts)
          .set({ updatedAt: now })
          .where(liveCart(cartId, now))
          .returning({ id: carts.id })
        if (locked.length === 0) return { ok: false, error: 'missing-cart' }
      }

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

      const [total] = await tx
        .select({ count: sql`coalesce(sum(${cartItems.quantity}), 0)`.mapWith(Number) })
        .from(cartItems)
        .where(eq(cartItems.cartId, cartId))
      return { ok: true, count: total?.count ?? 0 }
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
