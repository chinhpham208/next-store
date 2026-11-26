import { createHmac } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { signFakeEvent, verifyFakeSignature } from '@/features/checkout/signature'

// Fake values, test only.
const SECRET = 'test-fake-payment-secret-0123456789ab'
const OTHER_SECRET = 'other-fake-payment-secret-0123456789'
const NOW = new Date('2026-11-26T08:00:00.000Z')
const NOW_SECONDS = Math.floor(NOW.getTime() / 1000)
const BODY = '{"type":"paid","paymentRef":"fake_00000000-0000-4000-8000-000000000000","orderCode":7,"amount":1000}'
const HEADER_SHAPE = /^t=\d{10},v1=[A-Za-z0-9_-]{43}$/

const at = (seconds: number): Date => new Date(seconds * 1000)

// Independent of signFakeEvent: node:crypto, not Web Crypto.
const headerFor = (seconds: number, body: string, secret = SECRET): string => {
  const mac = createHmac('sha256', secret).update(`${String(seconds)}.${body}`).digest('base64url')
  return `t=${String(seconds)},v1=${mac}`
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('signFakeEvent / verifyFakeSignature', () => {
  it('round-trips a fresh signature', async () => {
    const header = await signFakeEvent({ secret: SECRET, body: BODY, now: NOW })
    expect(header).toMatch(HEADER_SHAPE)
    expect(header).toBe(headerFor(NOW_SECONDS, BODY))
    expect(await verifyFakeSignature({ secret: SECRET, body: BODY, header, now: NOW })).toBe('ok')
    expect(await verifyFakeSignature({ secret: OTHER_SECRET, body: BODY, header, now: NOW })).toBe('bad-signature')
  })

  it('verifies with crypto.subtle.verify over the raw body', async () => {
    const header = await signFakeEvent({ secret: SECRET, body: BODY, now: NOW })
    const verify = vi.spyOn(crypto.subtle, 'verify')
    expect(await verifyFakeSignature({ secret: SECRET, body: BODY, header, now: NOW })).toBe('ok')
    expect(verify).toHaveBeenCalledTimes(1)
    const data = verify.mock.calls[0]?.[3]
    expect(new TextDecoder().decode(data as ArrayBuffer)).toBe(`${String(NOW_SECONDS)}.${BODY}`)
    // One changed byte, and the same JSON written with other whitespace, are not the signed body.
    expect(await verifyFakeSignature({ secret: SECRET, body: BODY.replace('1000', '1001'), header, now: NOW })).toBe(
      'bad-signature',
    )
    expect(await verifyFakeSignature({ secret: SECRET, body: `${BODY} `, header, now: NOW })).toBe('bad-signature')
    expect(await verifyFakeSignature({ secret: SECRET, body: BODY.replace(',', ', '), header, now: NOW })).toBe(
      'bad-signature',
    )
  })

  it('rejects a signature older than 300 seconds', async () => {
    const old = await signFakeEvent({ secret: SECRET, body: BODY, now: at(NOW_SECONDS - 301) })
    expect(await verifyFakeSignature({ secret: SECRET, body: BODY, header: old, now: NOW })).toBe('expired')
    const edge = await signFakeEvent({ secret: SECRET, body: BODY, now: at(NOW_SECONDS - 300) })
    expect(await verifyFakeSignature({ secret: SECRET, body: BODY, header: edge, now: NOW })).toBe('ok')
    const future = await signFakeEvent({ secret: SECRET, body: BODY, now: at(NOW_SECONDS + 301) })
    expect(await verifyFakeSignature({ secret: SECRET, body: BODY, header: future, now: NOW })).toBe('expired')
    const nearFuture = await signFakeEvent({ secret: SECRET, body: BODY, now: at(NOW_SECONDS + 300) })
    expect(await verifyFakeSignature({ secret: SECRET, body: BODY, header: nearFuture, now: NOW })).toBe('ok')
  })

  it('rejects a header in any other shape without calling verify', async () => {
    const good = await signFakeEvent({ secret: SECRET, body: BODY, now: NOW })
    const [time, sig] = good.split(',') as [string, string]
    const verify = vi.spyOn(crypto.subtle, 'verify')
    for (const header of [
      '',
      time,
      sig,
      `${time},${sig}0`,
      `${time},${sig},${sig}`,
      `${sig},${time}`,
      ` ${good}`,
      `${good}\n`,
      `t=${String(NOW_SECONDS).slice(1)},${sig}`,
      `${time},v1=${'!'.repeat(43)}`,
      `${time},${sig.slice(0, -1)}`,
      'x'.repeat(4096),
    ]) {
      expect(await verifyFakeSignature({ secret: SECRET, body: BODY, header, now: NOW }), header.slice(0, 30)).toBe(
        'bad-signature',
      )
    }
    expect(verify).not.toHaveBeenCalled()
  })

  it('treats a missing header as unsigned', async () => {
    expect(await verifyFakeSignature({ secret: SECRET, body: BODY, header: null, now: NOW })).toBe('unsigned')
  })

  it('refuses to sign or verify without a 32-character secret', async () => {
    const header = await signFakeEvent({ secret: SECRET, body: BODY, now: NOW })
    for (const secret of ['', 'x'.repeat(31), ' '.repeat(40)]) {
      await expect(signFakeEvent({ secret, body: BODY, now: NOW })).rejects.toThrow('fake payment: the secret is too short')
      await expect(verifyFakeSignature({ secret, body: BODY, header, now: NOW })).rejects.toThrow(
        'fake payment: the secret is too short',
      )
    }
  })
})
