import type { PaymentEvent, PaymentProviderId } from '@/features/orders'

/** The gateway interface of ADR-0004. `verifyWebhook` throws WebhookRejected for anything it will not accept. */
export type PaymentProvider = {
  id: PaymentProviderId
  createCheckout: (input: {
    orderCode: number
    amount: number
    description: string
    returnUrl: string
    cancelUrl: string
  }) => Promise<{ checkoutUrl: string; paymentRef: string }>
  verifyWebhook: (request: Request, now?: Date) => Promise<PaymentEvent>
}

export type WebhookRejectedReason = 'unsigned' | 'bad-signature' | 'expired' | 'too-large' | 'malformed'

// A class on purpose (the one exception to `type` over `interface`): the webhook handler tells it from a bug with
// `instanceof`. The reason is a fixed word, never part of the request.
export class WebhookRejected extends Error {
  readonly reason: WebhookRejectedReason

  constructor(reason: WebhookRejectedReason) {
    super(`webhook rejected: ${reason}`)
    this.name = 'WebhookRejected'
    this.reason = reason
  }
}
