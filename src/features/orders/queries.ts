import 'server-only'
import { eq } from 'drizzle-orm'
import { dbQuery, orders } from '@/db'
import { orderItemsSchema, paymentRefSchema } from '@/features/orders/schema'
import type { CustomerOrder } from '@/features/orders/types'

// Never cached: an order changes when the webhook arrives, and the page that shows it must show that (plan M6).

/**
 * The order with this payment ref, or null. A ref of the wrong shape never reaches the database. The stored items
 * are read back through the schema; a row that fails it is a bug, not something to show.
 */
export const getOrderByRef = async (ref: unknown): Promise<CustomerOrder | null> => {
  const parsedRef = paymentRefSchema.safeParse(ref)
  if (!parsedRef.success) return null
  const [row] = await dbQuery({
    name: 'orders.by-ref',
    run: (db) =>
      db
        .select({
          id: orders.id,
          status: orders.status,
          refundReason: orders.refundReason,
          total: orders.total,
          items: orders.items,
          provider: orders.provider,
          cartId: orders.cartId,
        })
        .from(orders)
        .where(eq(orders.paymentRef, parsedRef.data))
        .limit(1),
  })
  if (row === undefined) return null
  const items = orderItemsSchema.safeParse(row.items)
  if (!items.success) throw new Error('orders: stored items are invalid')
  if (row.provider !== 'fake') throw new Error('orders: stored provider is unknown')
  return { ...row, items: items.data, provider: row.provider }
}
