import { z } from 'zod'
import { MAX_WEBHOOK_BODY_BYTES, readCappedBody } from '@/features/checkout/body'
import { FAKE_SIGNATURE_HEADER, verifyFakeSignature } from '@/features/checkout/signature'
import { type PaymentProvider, WebhookRejected } from '@/features/checkout/types'
import type { PaymentEvent } from '@/features/orders'

// The gateway of M6 (ADR-0021): it charges nothing and keeps nothing. The page /checkout/test asks the server to sign
// an event and the browser forwards it to the webhook, so the webhook sees the same HTTP as a real gateway's.

const paymentRef = z.string().regex(/^fake_[0-9a-f-]{36}$/)
const positiveInteger = z.number().int().positive()

export const paymentEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('paid'), paymentRef, orderCode: positiveInteger, amount: positiveInteger }),
  z.object({ type: z.literal('cancelled'), paymentRef, orderCode: positiveInteger }),
])

// After the MAC only. `fatal` refuses invalid UTF-8, `ignoreBOM` keeps a BOM in the text so JSON.parse refuses it:
// the bytes that were signed are the bytes that are parsed, none dropped or replaced.
const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })

const parseEvent = (bytes: Uint8Array): PaymentEvent => {
  let json: unknown
  try {
    json = JSON.parse(decoder.decode(bytes))
  } catch {
    throw new WebhookRejected('malformed')
  }
  const parsed = paymentEventSchema.safeParse(json)
  if (!parsed.success) throw new WebhookRejected('malformed')
  return parsed.data
}

export const createFakeProvider = ({ secret }: { secret: string }): PaymentProvider => ({
  id: 'fake',

  // Same-origin path: a real gateway returns an absolute URL. Nothing is stored here; the order keeps the ref.
  createCheckout: () => {
    const ref = `fake_${crypto.randomUUID()}`
    return Promise.resolve({ checkoutUrl: `/checkout/test?ref=${ref}`, paymentRef: ref })
  },

  // Order matters: size, then signature, then parse. Nothing is parsed, and no database is reached, before the MAC.
  verifyWebhook: async (request, now = new Date()) => {
    const body = await readCappedBody(request, MAX_WEBHOOK_BODY_BYTES)
    if (body === null) throw new WebhookRejected('too-large')
    const verdict = await verifyFakeSignature({
      secret,
      body,
      header: request.headers.get(FAKE_SIGNATURE_HEADER),
      now,
    })
    if (verdict !== 'ok') throw new WebhookRejected(verdict)
    return parseEvent(body)
  },
})
