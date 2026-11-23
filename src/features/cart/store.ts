import 'server-only'
import { and, asc, eq, gte, sql } from 'drizzle-orm'
import { cartItems, carts, dbQuery, products } from '@/db'
import { CART_TTL_DAYS } from '@/features/cart/limits'
import type { CartId } from '@/features/cart/schema'
import type { CartLine } from '@/features/cart/types'

// Reads and writes of the cart by id: no cookie, no header, so it runs on PGlite in tests (conventions.md §1).
// `now` is a parameter for the same reason, and so one request uses one cutoff for every statement.
//
// There is no trigger on carts.updated_at (audit PR #69): every write of a cart (Tasks 5, 6) must set it itself,
// and reads never do — only a write slides the expiry (ADR-0014 6A).

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
