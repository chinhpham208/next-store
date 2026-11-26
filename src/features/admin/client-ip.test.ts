import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { hashClientIp, readClientIp } from '@/features/admin/client-ip'

// Fake value, test only.
const SECRET = 'test-session-secret-0123456789abcdef'

const withForwardedFor = (value: string) => new Headers({ 'x-forwarded-for': value })

describe('readClientIp', () => {
  it('takes the first address of x-forwarded-for', () => {
    expect(readClientIp(withForwardedFor('203.0.113.7'))).toBe('203.0.113.7')
    expect(readClientIp(withForwardedFor(' 203.0.113.7 , 198.51.100.2'))).toBe('203.0.113.7')
    expect(readClientIp(withForwardedFor('2001:db8::1,198.51.100.2'))).toBe('2001:db8::1')
  })

  it('falls back to unknown', () => {
    expect(readClientIp(new Headers())).toBe('unknown')
    expect(readClientIp(withForwardedFor(''))).toBe('unknown')
    expect(readClientIp(withForwardedFor(' , 198.51.100.2'))).toBe('unknown')
  })

  it('keeps at most 45 characters', () => {
    expect(readClientIp(withForwardedFor('a'.repeat(4000)))).toBe('a'.repeat(45))
  })
})

describe('hashClientIp', () => {
  it('hashes with HMAC so the same IP gives the same hash and the raw IP is not in it', async () => {
    const hash = await hashClientIp({ ip: '203.0.113.7', secret: SECRET })
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
    expect(hash).toBe(createHmac('sha256', SECRET).update('203.0.113.7').digest('hex'))
    expect(await hashClientIp({ ip: '203.0.113.7', secret: SECRET })).toBe(hash)
    expect(await hashClientIp({ ip: '203.0.113.8', secret: SECRET })).not.toBe(hash)
    expect(await hashClientIp({ ip: '203.0.113.7', secret: `${SECRET}x` })).not.toBe(hash)
    expect(hash).not.toContain('203')
  })
})
