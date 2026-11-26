import 'server-only'
import { and, asc, eq, gte, isNull, sql } from 'drizzle-orm'
import { cartItems, carts, dbQuery, orders, products } from '@/db'
import { parseOrderItems, paymentRefSchema } from '@/features/orders/schema'
import { decrementStockForOrder, type StockLine } from '@/features/products/stock'
import type { ApplyOutcome, CreateOrderError, OrderItem, PaymentEvent, PaymentProviderId } from '@/features/orders/types'

// Orders by parameter: no cookie, no header, `now` is a parameter, so it runs on PGlite (conventions.md §1). The
// only importer of products/stock.ts (dependency-cruiser stock-only-from-orders).
//
// A database error (deadlock 40P01, DB_QUERY_TIMEOUT, a lost connection) is never caught here: it leaves the
// function, so the webhook answers 503 and the gateway sends the event again. Applying is idempotent (the row lock
// and the status check share one transaction), so a resend is safe; a write that timed out may or may not have
// committed (ADR-0011), which is why nothing here retries (audit PR #122 L1).
//
// dbQuery replaces the message of any error thrown in a transaction. One with a SQLSTATE (40P01, 22003, a timeout)
// is the database's and a resend can fix it; one WITHOUT a code is a broken invariant of ours (stored items invalid,
// an order that is not there) and will 503 on every resend until a human looks (audit PR #126 N3, Task 8 and 12).
//
// Lock order: applyPaymentEvent locks orders, then deletes cart_items. The cart purge and evict delete carts, which
// cascades to cart_items and sets orders.cart_id to NULL: the reverse order. A purge of this very cart during a
// payment can deadlock (40P01); the webhook answers 503, the gateway resends, and the purge swallows its own error.

const STORED_ITEMS_INVALID = 'orders: stored items are invalid'
const REF_NOT_ATTACHED = 'orders: payment ref not attached'
// The largest value of orders.total (int4); audit PR #126 L2.
const MAX_ORDER_TOTAL = 2_147_483_647

type CreatePendingOrderInput = { cartId: string; liveSince: Date; provider: PaymentProviderId; now: Date }

export type CreatePendingOrderResult =
  | { ok: true; orderId: number; total: number; items: OrderItem[] }
  | { ok: false; error: CreateOrderError }

/**
 * Snapshots a cart into a pending order, in one transaction. `liveSince` is the caller's expiry cutoff (the cart
 * feature's `cartExpiryCutoff(now)`), so orders does not import cart. The cart row is locked, not written: reading
 * a cart never slides its expiry. Nothing is held or decremented (ADR-0014): stock is taken when payment arrives.
 */
export const createPendingOrder = async ({
  cartId,
  liveSince,
  provider,
  now,
}: CreatePendingOrderInput): Promise<CreatePendingOrderResult> =>
  dbQuery({
    name: 'orders.create',
    transaction: async (tx): Promise<CreatePendingOrderResult> => {
      const locked = await tx
        .select({ id: carts.id })
        .from(carts)
        .where(and(eq(carts.id, cartId), gte(carts.updatedAt, liveSince)))
        .for('update')
      if (locked.length === 0) return { ok: false, error: 'missing-cart' }

      const lines = await tx
        .select({
          productId: products.id,
          slug: products.slug,
          name: products.name,
          // The current price: it is snapshotted into the order here and never read again (ADR-0014 4A, (c)).
          price: products.price,
          stock: products.stock,
          quantity: cartItems.quantity,
        })
        .from(cartItems)
        .innerJoin(products, eq(cartItems.productId, products.id))
        .where(eq(cartItems.cartId, cartId))
        .orderBy(asc(cartItems.createdAt), asc(cartItems.productId))
      if (lines.length === 0) return { ok: false, error: 'empty' }

      // ADR-0014 10A: a line the shop cannot fill blocks the order; the first such line names the error.
      for (const line of lines) {
        if (line.stock === 0) return { ok: false, error: 'out-of-stock' }
        if (line.quantity > line.stock) return { ok: false, error: 'over-stock' }
      }

      const items: OrderItem[] = lines.map(({ stock: _stock, ...line }) => ({
        ...line,
        lineTotal: line.price * line.quantity,
      }))
      const total = items.reduce((sum, item) => sum + item.lineTotal, 0)
      if (total === 0) return { ok: false, error: 'zero-total' }
      // 20 lines x 10 x 100.000.000 overflows int4: a domain error here, not a 22003 from the INSERT (audit PR #126 L2).
      if (total > MAX_ORDER_TOTAL) return { ok: false, error: 'too-large' }
      // Read back through the schema before it is stored: an order the webhook could never parse would be paid and
      // then stuck pending forever (audit PR #126 L3). Throwing rolls the transaction back, so nothing is written.
      if (parseOrderItems(items) === undefined) throw new Error(STORED_ITEMS_INVALID)

      const [created] = await tx
        .insert(orders)
        .values({ items, total, status: 'pending', provider, cartId, createdAt: now, updatedAt: now })
        .returning({ id: orders.id })
      if (created === undefined) throw new Error('orders: order not created')
      return { ok: true, orderId: created.id, total, items }
    },
  })

type AttachPaymentRefInput = { orderId: number; paymentRef: string; now: Date }

/** Sets the gateway's ref on a pending order that has none; any other order is a bug, so it throws a fixed message. */
export const attachPaymentRef = async ({ orderId, paymentRef, now }: AttachPaymentRefInput): Promise<void> => {
  // A ref outside the shape getOrderByRef accepts could never be looked up again (audit PR #126 N2).
  if (!paymentRefSchema.safeParse(paymentRef).success) throw new Error(REF_NOT_ATTACHED)
  const updated = await dbQuery({
    name: 'orders.attach-ref',
    run: (db) =>
      db
        .update(orders)
        .set({ paymentRef, updatedAt: now })
        .where(and(eq(orders.id, orderId), isNull(orders.paymentRef), eq(orders.status, 'pending')))
        .returning({ id: orders.id }),
  })
  if (updated.length !== 1) throw new Error(REF_NOT_ATTACHED)
}

type ApplyPaymentEventInput = { event: PaymentEvent; provider: PaymentProviderId; now: Date }

export type ApplyPaymentEventResult = { outcome: ApplyOutcome; slugs: string[] }

const IGNORED: ApplyPaymentEventResult = { outcome: 'ignored', slugs: [] }

const stockLinesOf = (items: readonly OrderItem[]): StockLine[] => {
  const byProduct = new Map<number, number>()
  for (const { productId, quantity } of items) byProduct.set(productId, (byProduct.get(productId) ?? 0) + quantity)
  return [...byProduct].map(([productId, quantity]) => ({ productId, quantity }))
}

/**
 * Applies one gateway event to its order, once. One transaction: the `orders` row is locked by `payment_ref`, and
 * only a `pending` order is written (the status check sits inside the lock, so two deliveries at once cannot both
 * see `pending`). The order code and provider must match the row, never the event alone.
 *
 * Returns the slugs the caller must refresh in the cache: those of the products decremented, and also those of an
 * order that is already `paid` (a duplicate), so a first delivery that died after COMMIT is repaired by the resend.
 */
export const applyPaymentEvent = async ({ event, provider, now }: ApplyPaymentEventInput): Promise<ApplyPaymentEventResult> =>
  dbQuery({
    name: 'orders.apply-payment',
    transaction: async (tx): Promise<ApplyPaymentEventResult> => {
      const [order] = await tx
        .select({
          id: orders.id,
          provider: orders.provider,
          status: orders.status,
          total: orders.total,
          items: orders.items,
          cartId: orders.cartId,
        })
        .from(orders)
        .where(eq(orders.paymentRef, event.paymentRef))
        .for('update')
      if (order === undefined || order.id !== event.orderCode || order.provider !== provider) return IGNORED

      if (order.status !== 'pending') {
        if (order.status !== 'paid') return { outcome: 'duplicate', slugs: [] }
        const items = parseOrderItems(order.items)
        if (items === undefined) throw new Error(STORED_ITEMS_INVALID)
        return { outcome: 'duplicate', slugs: items.map((item) => item.slug) }
      }

      const settle = (values: Pick<typeof orders.$inferInsert, 'status' | 'refundReason'>) =>
        tx
          .update(orders)
          .set({ ...values, updatedAt: now })
          .where(eq(orders.id, order.id))

      if (event.type === 'cancelled') {
        await settle({ status: 'cancelled' })
        return { outcome: 'cancelled', slugs: [] }
      }

      if (event.amount !== order.total) {
        await settle({ status: 'needs_refund', refundReason: 'amount-mismatch' })
        return { outcome: 'needs_refund', slugs: [] }
      }

      const items = parseOrderItems(order.items)
      if (items === undefined) throw new Error(STORED_ITEMS_INVALID)
      const decremented = await decrementStockForOrder(tx, stockLinesOf(items))
      if (!decremented.ok) {
        await settle({ status: 'needs_refund', refundReason: 'out-of-stock' })
        return { outcome: 'needs_refund', slugs: [] }
      }

      await settle({ status: 'paid' })
      // The cart of the order, read from the row, never from the event; a cart that is gone (cart_id null) has
      // nothing to clear.
      if (order.cartId !== null) await tx.delete(cartItems).where(eq(cartItems.cartId, order.cartId))
      return { outcome: 'paid', slugs: decremented.slugs }
    },
  })
