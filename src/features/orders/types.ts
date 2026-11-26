// No imports on purpose: checkout uses these types and orders must not import checkout (plan M6 Task 6, ADR-0021).
// The unions repeat the database enums (ORDER_STATUSES, REFUND_REASONS in src/db/schema.ts); types.test.ts compares them
// (`orders types match the database enums`), so the two lists cannot drift.

/** What a payment gateway tells us (ADR-0004). `amount` is whole dong. */
export type PaymentEvent =
  | { type: 'paid'; paymentRef: string; orderCode: number; amount: number }
  | { type: 'cancelled'; paymentRef: string; orderCode: number }

/** Gateways with an adapter; widened when one is added. */
export type PaymentProviderId = 'fake'

export type OrderStatus = 'pending' | 'paid' | 'needs_refund' | 'cancelled'

export type RefundReason = 'out-of-stock' | 'amount-mismatch'

/** One line of an order: the cart line with the price at the time of the order (ADR-0014 (c)). */
export type OrderItem = {
  productId: number
  slug: string
  name: string
  price: number
  quantity: number
  lineTotal: number
}

export type CreateOrderError = 'missing-cart' | 'empty' | 'over-stock' | 'out-of-stock' | 'zero-total'

/**
 * What applying a payment event did. `duplicate`: the order was no longer pending, nothing was written. `ignored`:
 * no order has this ref, or the order code or provider does not match.
 */
export type ApplyOutcome = 'paid' | 'needs_refund' | 'cancelled' | 'duplicate' | 'ignored'

/** An order as the shop shows it. `cartId` is only for the server's own checks (canActOnOrder) and never reaches the UI. */
export type CustomerOrder = {
  id: number
  status: OrderStatus
  refundReason: RefundReason | null
  total: number
  items: OrderItem[]
  provider: PaymentProviderId
  cartId: string | null
}
