import { z } from 'zod'
import type { OrderItem } from '@/features/orders/types'

// orders.items is jsonb: whatever is stored is read back through this schema, never trusted by type alone (plan M6
// Task 7). strict(), like the cart's inputs: a key the writer does not produce means the row is not ours.
const orderItemSchema = z
  .object({
    productId: z.int().positive(),
    slug: z.string().min(1).max(120),
    name: z.string().min(1).max(200),
    price: z.int().min(0),
    quantity: z.int().min(1).max(99),
    lineTotal: z.int().min(0),
  })
  .strict()
  .refine((item) => item.lineTotal === item.price * item.quantity)

// 1 to 20 lines: MAX_CART_LINES of the cart (ADR-0014 5A) is the most one order can snapshot.
export const orderItemsSchema = z.array(orderItemSchema).min(1).max(20)

// The same shape for every provider (plan M6 Task 7); it also keeps a ref from carrying anything but safe characters.
export const paymentRefSchema = z.string().regex(/^[A-Za-z0-9_-]{8,64}$/)

// A parsed array is typed by the schema; this keeps it assignable to OrderItem without a cast.
export const parseOrderItems = (value: unknown): OrderItem[] | undefined => {
  const parsed = orderItemsSchema.safeParse(value)
  return parsed.success ? parsed.data : undefined
}
