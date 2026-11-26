import { describe, expect, it } from 'vitest'
import type { OrderStatus, PaymentEvent, PaymentProviderId, RefundReason } from '@/features/orders'

describe('orders types', () => {
  it('accept the events ADR-0004 names', () => {
    const paid: PaymentEvent = { type: 'paid', paymentRef: 'fake_1', orderCode: 1, amount: 1 }
    const cancelled: PaymentEvent = { type: 'cancelled', paymentRef: 'fake_1', orderCode: 1 }
    const status: OrderStatus[] = ['pending', 'paid', 'needs_refund', 'cancelled']
    const reasons: RefundReason[] = ['out-of-stock', 'amount-mismatch']
    const provider: PaymentProviderId = 'fake'
    expect([paid.type, cancelled.type, status.length, reasons.length, provider]).toEqual(['paid', 'cancelled', 4, 2, 'fake'])
  })
})
