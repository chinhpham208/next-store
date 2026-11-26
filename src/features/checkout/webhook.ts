import 'server-only'
import { revalidateTag } from 'next/cache'
import { getPaymentProvider } from '@/features/checkout/provider'
import { WebhookRejected } from '@/features/checkout/types'
import { recordHandledError } from '@/features/monitoring'
import { applyPaymentEvent } from '@/features/orders'
import { tagsForProductWrite } from '@/features/products'

// The body of POST /api/webhooks/payment (ADR-0021). Order: configuration, then the signature (nothing is parsed and no
// database is reached before it), then the event, then the cache. Every answer is a fixed code: no request byte, no
// signature, no ref, no error text ever leaves in a body or reaches a log.

const NO_STORE = { 'cache-control': 'no-store' }

const reply = (status: number, body: Record<string, string | boolean>): Response =>
  Response.json(body, { status, headers: NO_STORE })

// A failure that is ours, not the sender's: answered 503 so the gateway resends (safe, the apply is idempotent) and
// recorded so it shows in /admin/errors. An error without a SQLSTATE (dbQuery's message has none) is a broken
// invariant of ours (stored items invalid, an order that is gone) that will answer 503 for ever: that is the case
// somebody has to see (audit PR #126 N3). Only the fixed route path goes to the record, never request.url.
const unavailable = async (error: unknown): Promise<Response> => {
  console.error('checkout: applying a payment event failed')
  await recordHandledError({ routePath: '/api/webhooks/payment', method: 'POST', error })
  return reply(503, { error: 'unavailable' })
}

// product:<slug> and products for each product the event changed (or, for a resend of a paid order, changed already),
// each tag once; never product-slugs. 'max' serves the old page once and refreshes behind it (ADR-0003).
const revalidateProducts = (slugs: readonly string[]): void => {
  const tags = new Set(slugs.flatMap((slug) => tagsForProductWrite({ slug, change: 'fields' })))
  for (const tag of tags) revalidateTag(tag, 'max')
}

export const handlePaymentWebhook = async (request: Request, now: Date = new Date()): Promise<Response> => {
  const provider = getPaymentProvider()
  if (provider === null) return reply(503, { error: 'not-configured' })

  let event
  try {
    event = await provider.verifyWebhook(request)
  } catch (error) {
    if (error instanceof WebhookRejected) {
      return reply(error.reason === 'too-large' ? 413 : 400, { error: error.reason })
    }
    return unavailable(error)
  }

  try {
    const { outcome, slugs } = await applyPaymentEvent({ event, provider: provider.id, now })
    revalidateProducts(slugs)
    return reply(200, { received: true, outcome })
  } catch (error) {
    return unavailable(error)
  }
}
