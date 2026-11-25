import { afterEach, describe, expect, it, vi } from 'vitest'
import { ADMIN_SESSION_TTL_SECONDS, signSession, verifySession } from '@/features/admin/session'

// Fake values, test only: 32+ characters, never used anywhere real.
const SECRET = 'test-session-secret-0123456789abcdef'
const OTHER_SECRET = 'other-session-secret-0123456789abcdef'
const NOW = new Date('2026-11-25T08:00:00.000Z')
const NOW_SECONDS = Math.floor(NOW.getTime() / 1000)
const TOKEN_SHAPE = /^v1\.\d{10}\.[A-Za-z0-9_-]{43}$/

const base64Url = (bytes: ArrayBuffer): string =>
  Buffer.from(bytes).toString('base64').replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')

// Builds a correctly signed token for any expiry, independently of signSession (node:crypto, not Web Crypto).
const tokenFor = async (exp: number, secret = SECRET): Promise<string> => {
  const { createHmac } = await import('node:crypto')
  const payload = `v1.${String(exp)}`
  const mac = createHmac('sha256', secret).update(payload).digest()
  return `${payload}.${base64Url(mac.buffer.slice(mac.byteOffset, mac.byteOffset + mac.byteLength))}`
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('signSession / verifySession', () => {
  it('round-trips a fresh token', async () => {
    const token = await signSession({ secret: SECRET, now: NOW })
    expect(token).toMatch(TOKEN_SHAPE)
    expect(token.split('.')[1]).toBe(String(NOW_SECONDS + ADMIN_SESSION_TTL_SECONDS))
    expect(token).toBe(await tokenFor(NOW_SECONDS + ADMIN_SESSION_TTL_SECONDS))
    expect(await verifySession({ token, secret: SECRET, now: NOW })).toBe(true)
    // Still valid one second before the absolute expiry, not at it.
    const almost = new Date((NOW_SECONDS + ADMIN_SESSION_TTL_SECONDS - 1) * 1000)
    expect(await verifySession({ token, secret: SECRET, now: almost })).toBe(true)
  })

  it('has an absolute TTL of 8 hours', () => {
    expect(ADMIN_SESSION_TTL_SECONDS).toBe(28_800)
  })

  it('rejects a token signed with another secret', async () => {
    const token = await signSession({ secret: OTHER_SECRET, now: NOW })
    expect(await verifySession({ token, secret: SECRET, now: NOW })).toBe(false)
  })

  it('rejects one changed character in the signature', async () => {
    const token = await signSession({ secret: SECRET, now: NOW })
    const prefix = token.slice(0, token.lastIndexOf('.') + 1)
    const signature = token.slice(prefix.length)
    for (let index = 0; index < signature.length; index += 1) {
      const original = signature.charAt(index)
      const changed = original === 'A' ? 'B' : 'A'
      const tampered = `${prefix}${signature.slice(0, index)}${changed}${signature.slice(index + 1)}`
      expect(await verifySession({ token: tampered, secret: SECRET, now: NOW }), `position ${index}`).toBe(false)
    }
  })

  it('rejects a non-canonical last character that decodes to the same bytes', async () => {
    // 43 base64url characters carry 258 bits for 256: the last character has 2 spare bits. A decoder that ignores
    // them would accept 4 spellings of one signature.
    const token = await signSession({ secret: SECRET, now: NOW })
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
    const last = alphabet.indexOf(token.charAt(token.length - 1))
    for (let spare = 1; spare < 4; spare += 1) {
      const sibling = `${token.slice(0, -1)}${alphabet.charAt(last + spare)}`
      expect(await verifySession({ token: sibling, secret: SECRET, now: NOW })).toBe(false)
    }
  })

  it('rejects a changed expiry with the old signature', async () => {
    const token = await signSession({ secret: SECRET, now: NOW })
    const [, , signature] = token.split('.')
    const earlier = `v1.${String(NOW_SECONDS + 60)}.${signature ?? ''}`
    expect(await verifySession({ token: earlier, secret: SECRET, now: NOW })).toBe(false)
  })

  it('rejects an expired token', async () => {
    const token = await signSession({ secret: SECRET, now: NOW })
    const atExpiry = new Date((NOW_SECONDS + ADMIN_SESSION_TTL_SECONDS) * 1000)
    expect(await verifySession({ token, secret: SECRET, now: atExpiry })).toBe(false)
    const later = new Date((NOW_SECONDS + ADMIN_SESSION_TTL_SECONDS + 3600) * 1000)
    expect(await verifySession({ token, secret: SECRET, now: later })).toBe(false)
  })

  it('rejects an expiry further than the TTL', async () => {
    const atLimit = await tokenFor(NOW_SECONDS + ADMIN_SESSION_TTL_SECONDS)
    expect(await verifySession({ token: atLimit, secret: SECRET, now: NOW })).toBe(true)
    const beyond = await tokenFor(NOW_SECONDS + ADMIN_SESSION_TTL_SECONDS + 1)
    expect(await verifySession({ token: beyond, secret: SECRET, now: NOW })).toBe(false)
    const farFuture = await tokenFor(9_999_999_999)
    expect(await verifySession({ token: farFuture, secret: SECRET, now: NOW })).toBe(false)
  })

  it('rejects malformed tokens without calling verify', async () => {
    const verify = vi.spyOn(crypto.subtle, 'verify')
    const good = await signSession({ secret: SECRET, now: NOW })
    const [, exp, signature = ''] = good.split('.')
    const malformed = [
      undefined,
      '',
      `v2.${exp ?? ''}.${signature}`,
      `V1.${exp ?? ''}.${signature}`,
      `v1.${(exp ?? '').slice(1)}.${signature}`,
      `v1.0${exp ?? ''}.${signature}`,
      `v1.${exp ?? ''}.${signature}A`,
      `v1.${exp ?? ''}.${signature.slice(1)}`,
      `v1.${exp ?? ''}.${signature.slice(0, -1)}+`,
      `v1.${exp ?? ''}.${signature}=`,
      ` ${good}`,
      `${good}\n`,
      `${good}.extra`,
      `v1.${exp ?? ''}`,
      'x'.repeat(4096),
      `v1.${exp ?? ''}.${'A'.repeat(4096)}`,
    ]
    for (const token of malformed) {
      expect(await verifySession({ token, secret: SECRET, now: NOW }), JSON.stringify(token)).toBe(false)
    }
    expect(verify).not.toHaveBeenCalled()
  })

  it('refuses to sign or verify without a 32-character secret', async () => {
    const token = await signSession({ secret: SECRET, now: NOW })
    for (const secret of ['', 'short', 'x'.repeat(31), ' '.repeat(40)]) {
      await expect(signSession({ secret, now: NOW })).rejects.toThrow('admin session: the secret is too short')
      await expect(verifySession({ token, secret, now: NOW })).rejects.toThrow('admin session: the secret is too short')
    }
  })

  it('verifies with crypto.subtle.verify', async () => {
    const verify = vi.spyOn(crypto.subtle, 'verify')
    const token = await signSession({ secret: SECRET, now: NOW })
    expect(await verifySession({ token, secret: SECRET, now: NOW })).toBe(true)
    expect(verify).toHaveBeenCalledTimes(1)
    const [algorithm, , signature, data] = verify.mock.calls[0] ?? []
    expect(algorithm).toBe('HMAC')
    expect(signature).toBeInstanceOf(Uint8Array)
    expect(signature instanceof Uint8Array ? signature.byteLength : 0).toBe(32)
    expect(data instanceof Uint8Array ? new TextDecoder().decode(data) : '').toBe(token.slice(0, token.lastIndexOf('.')))

    // The answer comes from Web Crypto: when it says no, the token is refused whatever the strings look like.
    verify.mockResolvedValueOnce(false)
    expect(await verifySession({ token, secret: SECRET, now: NOW })).toBe(false)
  })

  it('answers false when Web Crypto throws', async () => {
    const token = await signSession({ secret: SECRET, now: NOW })
    vi.spyOn(crypto.subtle, 'verify').mockRejectedValueOnce(new Error('boom'))
    expect(await verifySession({ token, secret: SECRET, now: NOW })).toBe(false)
  })
})
