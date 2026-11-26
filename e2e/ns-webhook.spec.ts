import { signFakeEvent, FAKE_SIGNATURE_HEADER } from '@/features/checkout/signature'
import { VIEWPORT_INDEPENDENT } from './catalog'
import { WRITE_TAG } from './production'
import { expect, test } from './test'

// The payment webhook on a real build (plan M6 Task 8, ADR-0021). Every case is a POST, so the whole file carries the
// write tag: Production runs none of it and is covered by the smoke case `webhook-unsigned` instead. Answers are fixed
// codes only (`{ error: <code> }`), never a word of the request.
//
// "đơn không đổi": an order can only be made by the checkout button (Task 9), so the proof that a refused request
// leaves every order alone is the Vitest `does not touch the database before the signature is verified`; the E2E
// below proves the answer on the real build and, in Task 16, the order of a real checkout stays `pending`.
test.skip(({ isMobile }) => isMobile, VIEWPORT_INDEPENDENT)

const WEBHOOK = '/api/webhooks/payment'
const SECRET = process.env.E2E_FAKE_PAYMENT_SECRET
const NEEDS_SECRET = 'Cần E2E_FAKE_PAYMENT_SECRET (chỉ có khi chạy local / CI: scripts/verify.sh, playwright.config.ts)'
const FIVE_MINUTES_MS = 5 * 60_000

// A syntactically valid header whose MAC is not the body's: the right shape, a fresh time, 43 base64url characters.
const forgedSignature = () => `t=${Math.floor(Date.now() / 1000)},v1=${'A'.repeat(43)}`

const paidEvent = (overrides: Record<string, unknown> = {}) =>
  JSON.stringify({
    type: 'paid',
    paymentRef: `fake_${crypto.randomUUID()}`,
    orderCode: 2_000_000_000,
    amount: 1,
    ...overrides,
  })

test.describe('webhook', { tag: WRITE_TAG }, () => {
  test('webhook: không có chữ ký thì 400, đơn không đổi', async ({ request }) => {
    const response = await request.post(WEBHOOK, { data: paidEvent(), headers: { 'content-type': 'application/json' } })
    expect(response.status()).toBe(400)
    expect(await response.json()).toEqual({ error: 'unsigned' })
    expect(response.headers()['set-cookie']).toBeUndefined()
  })

  test('webhook: chữ ký sai thì 400, đơn không đổi', async ({ request }) => {
    const response = await request.post(WEBHOOK, {
      data: paidEvent(),
      headers: { 'content-type': 'application/json', [FAKE_SIGNATURE_HEADER]: forgedSignature() },
    })
    expect(response.status()).toBe(400)
    expect(await response.json()).toEqual({ error: 'bad-signature' })
  })

  test('webhook: thân trên 8 KB thì 413', async ({ request }) => {
    const response = await request.post(WEBHOOK, {
      data: 'x'.repeat(8 * 1024 + 1),
      headers: { 'content-type': 'application/json', [FAKE_SIGNATURE_HEADER]: forgedSignature() },
    })
    expect(response.status()).toBe(413)
    expect(await response.json()).toEqual({ error: 'too-large' })
  })

  test('webhook: sự kiện ký quá 5 phút thì 400', async ({ request }) => {
    test.skip(SECRET === undefined || SECRET === '', NEEDS_SECRET)
    const body = paidEvent()
    // Signed with the real secret: only its age can be the reason.
    const signature = await signFakeEvent({ secret: SECRET ?? '', body, now: new Date(Date.now() - FIVE_MINUTES_MS - 60_000) })
    const response = await request.post(WEBHOOK, {
      data: body,
      headers: { 'content-type': 'application/json', [FAKE_SIGNATURE_HEADER]: signature },
    })
    expect(response.status()).toBe(400)
    expect(await response.json()).toEqual({ error: 'expired' })
  })

  test('webhook: GET thì 405', async ({ request }) => {
    const response = await request.get(WEBHOOK)
    expect(response.status()).toBe(405)
  })

  test('webhook: PUT và DELETE thì 405', async ({ request }) => {
    expect((await request.put(WEBHOOK, { data: '{}' })).status()).toBe(405)
    expect((await request.delete(WEBHOOK)).status()).toBe(405)
  })

  test('webhook: đơn không tồn tại thì 200 và không ghi gì', async ({ request }) => {
    test.skip(SECRET === undefined || SECRET === '', NEEDS_SECRET)
    const body = paidEvent()
    const signature = await signFakeEvent({ secret: SECRET ?? '', body, now: new Date() })
    const response = await request.post(WEBHOOK, {
      data: body,
      headers: { 'content-type': 'application/json', [FAKE_SIGNATURE_HEADER]: signature },
    })
    expect(response.status()).toBe(200)
    expect(await response.json()).toEqual({ received: true, outcome: 'ignored' })
  })
})
