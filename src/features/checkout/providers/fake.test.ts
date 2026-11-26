import { describe, expect, it } from 'vitest'
import { MAX_WEBHOOK_BODY_BYTES } from '@/features/checkout/body'
import { createFakeProvider } from '@/features/checkout/providers/fake'
import { FAKE_SIGNATURE_HEADER, signFakeEvent } from '@/features/checkout/signature'
import { WebhookRejected } from '@/features/checkout/types'

// Fake values, test only.
const SECRET = 'test-fake-payment-secret-0123456789ab'
const REF = 'fake_00000000-0000-4000-8000-000000000000'
const provider = createFakeProvider({ secret: SECRET })

const webhook = async (body: string, header?: string | null): Promise<Request> => {
  const signature = header === undefined ? await signFakeEvent({ secret: SECRET, body, now: new Date() }) : header
  return new Request('http://localhost/api/webhooks/payment', {
    method: 'POST',
    body,
    headers: signature === null ? {} : { [FAKE_SIGNATURE_HEADER]: signature },
  })
}

const reasonOf = async (request: Promise<Request>): Promise<unknown> => {
  try {
    await provider.verifyWebhook(await request)
  } catch (error) {
    return error instanceof WebhookRejected ? error.reason : error
  }
  return 'accepted'
}

describe('createFakeProvider', () => {
  it('createCheckout returns a fresh fake_ ref and a same-origin checkout path', async () => {
    const input = {
      orderCode: 7,
      amount: 1000,
      description: 'Đơn 7',
      returnUrl: 'http://localhost/checkout/success',
      cancelUrl: 'http://localhost/cart',
    }
    const first = await provider.createCheckout(input)
    const second = await provider.createCheckout(input)
    expect(first.paymentRef).toMatch(/^fake_[0-9a-f-]{36}$/)
    expect(first.paymentRef).not.toBe(second.paymentRef)
    expect(first.checkoutUrl).toBe(`/checkout/test?ref=${first.paymentRef}`)
    expect(provider.id).toBe('fake')
  })

  it('verifyWebhook parses a signed paid event', async () => {
    const body = JSON.stringify({ type: 'paid', paymentRef: REF, orderCode: 7, amount: 1000 })
    expect(await provider.verifyWebhook(await webhook(body))).toEqual({
      type: 'paid',
      paymentRef: REF,
      orderCode: 7,
      amount: 1000,
    })
    const cancelled = JSON.stringify({ type: 'cancelled', paymentRef: REF, orderCode: 7 })
    expect(await provider.verifyWebhook(await webhook(cancelled))).toEqual({
      type: 'cancelled',
      paymentRef: REF,
      orderCode: 7,
    })
  })

  it('verifyWebhook throws too-large, unsigned, bad-signature, expired, malformed', async () => {
    const body = JSON.stringify({ type: 'paid', paymentRef: REF, orderCode: 7, amount: 1000 })
    expect(await reasonOf(webhook(' '.repeat(MAX_WEBHOOK_BODY_BYTES + 1) + body))).toBe('too-large')
    expect(await reasonOf(webhook(body, null))).toBe('unsigned')
    expect(await reasonOf(webhook(body, `t=1700000000,v1=${'A'.repeat(43)}`))).toBe('expired')
    const wrong = await signFakeEvent({ secret: SECRET, body: `${body} `, now: new Date() })
    expect(await reasonOf(webhook(body, wrong))).toBe('bad-signature')
    const old = await signFakeEvent({ secret: SECRET, body, now: new Date(Date.now() - 301_000) })
    expect(await reasonOf(webhook(body, old))).toBe('expired')
    // Signed correctly, but not an event: malformed, and only after the signature was checked.
    for (const bad of [
      'not json',
      '[]',
      '{}',
      JSON.stringify({ type: 'refunded', paymentRef: REF, orderCode: 7 }),
      JSON.stringify({ type: 'paid', paymentRef: 'real_1', orderCode: 7, amount: 1000 }),
      JSON.stringify({ type: 'paid', paymentRef: REF, orderCode: 0, amount: 1000 }),
      JSON.stringify({ type: 'paid', paymentRef: REF, orderCode: 7, amount: 1000.5 }),
      JSON.stringify({ type: 'paid', paymentRef: REF, orderCode: 7, amount: -1 }),
      JSON.stringify({ type: 'paid', paymentRef: REF, orderCode: 7 }),
    ]) {
      expect(await reasonOf(webhook(bad)), bad).toBe('malformed')
    }
  })

  it('verifies the signature before it parses the body', async () => {
    expect(await reasonOf(webhook('not json', null))).toBe('unsigned')
    expect(await reasonOf(webhook('not json', `t=1700000000,v1=${'A'.repeat(43)}`))).toBe('expired')
  })

  it('keeps the signed bytes: a BOM or invalid UTF-8 is malformed after a good MAC, never silently repaired', async () => {
    const json = new TextEncoder().encode(JSON.stringify({ type: 'cancelled', paymentRef: REF, orderCode: 7 }))
    const bom = new Uint8Array([0xef, 0xbb, 0xbf, ...json])
    const invalid = new Uint8Array([...json.slice(0, -1), 0xff, 0x7d])
    for (const bytes of [bom, invalid]) {
      const header = await signFakeEvent({ secret: SECRET, body: bytes, now: new Date() })
      const request = new Request('http://localhost/api/webhooks/payment', {
        method: 'POST',
        body: bytes,
        headers: { [FAKE_SIGNATURE_HEADER]: header },
      })
      expect(await reasonOf(Promise.resolve(request))).toBe('malformed')
    }
    // The same bytes under a MAC made for the BOM-less body are not accepted.
    const header = await signFakeEvent({ secret: SECRET, body: json, now: new Date() })
    const request = new Request('http://localhost/api/webhooks/payment', {
      method: 'POST',
      body: bom,
      headers: { [FAKE_SIGNATURE_HEADER]: header },
    })
    expect(await reasonOf(Promise.resolve(request))).toBe('bad-signature')
  })
})
