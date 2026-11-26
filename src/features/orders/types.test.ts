import { describe, expect, it } from 'vitest'
import { ORDER_STATUSES, REFUND_REASONS } from '@/db'
import type { OrderStatus, PaymentEvent, PaymentProviderId, RefundReason } from '@/features/orders/types'

// orders/types.ts imports nothing (checkout uses it and orders must not import checkout), so it repeats the database
// enums. These records are exhaustive over the unions (a missing or extra key fails the typecheck) and are compared
// with the enums of the schema at run time, so the two lists cannot drift (audit PR #124 L2).
const STATUS_KEYS: Record<OrderStatus, true> = { pending: true, paid: true, needs_refund: true, cancelled: true }
const REASON_KEYS: Record<RefundReason, true> = { 'out-of-stock': true, 'amount-mismatch': true }

type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false
const statusesMatch: Same<OrderStatus, (typeof ORDER_STATUSES)[number]> = true
const reasonsMatch: Same<RefundReason, (typeof REFUND_REASONS)[number]> = true

describe('orders types', () => {
  it('accept the events ADR-0004 names', () => {
    const paid: PaymentEvent = { type: 'paid', paymentRef: 'fake_1', orderCode: 1, amount: 1 }
    const cancelled: PaymentEvent = { type: 'cancelled', paymentRef: 'fake_1', orderCode: 1 }
    const provider: PaymentProviderId = 'fake'
    expect([paid.type, cancelled.type, provider]).toEqual(['paid', 'cancelled', 'fake'])
  })

  it('orders types match the database enums', () => {
    expect(statusesMatch && reasonsMatch).toBe(true)
    expect(Object.keys(STATUS_KEYS).sort()).toEqual([...ORDER_STATUSES].sort())
    expect(Object.keys(REASON_KEYS).sort()).toEqual([...REFUND_REASONS].sort())
  })
})
