// No imports on purpose: checkout uses these types and orders must not import checkout (plan M6 Task 6, ADR-0021).
// The unions repeat the database enums (ORDER_STATUSES, REFUND_REASONS in src/db/schema.ts); a test compares them.

/** What a payment gateway tells us (ADR-0004). `amount` is whole dong. */
export type PaymentEvent =
  | { type: 'paid'; paymentRef: string; orderCode: number; amount: number }
  | { type: 'cancelled'; paymentRef: string; orderCode: number }

/** Gateways with an adapter; widened when one is added. */
export type PaymentProviderId = 'fake'

export type OrderStatus = 'pending' | 'paid' | 'needs_refund' | 'cancelled'

export type RefundReason = 'out-of-stock' | 'amount-mismatch'
