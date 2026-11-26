import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { clientLimitKey, hashClientIp, readClientIp } from '@/features/admin/client-ip'

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

// NS-132 (audit M5 M1): one IPv6 /64 is one network, often one machine, and holds 2^64 addresses. Keyed by the
// whole address, each one had its own 5 tries, so a single /64 never met the per-IP limit.
describe('clientLimitKey', () => {
  it('two addresses of one IPv6 /64 share one per-IP count', () => {
    expect(clientLimitKey('2001:db8:abcd:12::1')).toBe(clientLimitKey('2001:db8:abcd:12::10'))
    expect(clientLimitKey('2001:db8:abcd:12::1')).toBe(clientLimitKey('2001:db8:abcd:12:ffff:ffff:ffff:ffff'))
    expect(clientLimitKey('2001:db8:abcd:12::1')).toBe('2001:db8:abcd:12::/64')
  })

  it('reads the short, the full and the upper-case spelling as one /64', () => {
    const key = clientLimitKey('2001:db8:abcd:12::1')
    for (const spelling of [
      '2001:0db8:abcd:0012:0000:0000:0000:0001',
      '2001:DB8:ABCD:12:0:0:0:1',
      '2001:0DB8:abcd:12::9:8:7',
      '2001:db8:abcd:12:1::',
      '2001:db8:abcd:12::203.0.113.7',
    ]) {
      expect(clientLimitKey(spelling), spelling).toBe(key)
    }
    // :: where the zeros are in the prefix.
    expect(clientLimitKey('2001:db8::1')).toBe('2001:db8:0:0::/64')
    expect(clientLimitKey('2001:0db8:0000:0000:ffff::1')).toBe('2001:db8:0:0::/64')
    expect(clientLimitKey('::1')).toBe('0:0:0:0::/64')
    expect(clientLimitKey('::')).toBe('0:0:0:0::/64')
  })

  it('keeps another /64 apart', () => {
    expect(clientLimitKey('2001:db8:abcd:13::1')).not.toBe(clientLimitKey('2001:db8:abcd:12::1'))
    expect(clientLimitKey('2001:db8:abce:12::1')).not.toBe(clientLimitKey('2001:db8:abcd:12::1'))
  })

  it('keys IPv4 by the whole address, an IPv4-mapped IPv6 address included', () => {
    expect(clientLimitKey('203.0.113.7')).toBe('203.0.113.7')
    expect(clientLimitKey('203.0.113.8')).not.toBe(clientLimitKey('203.0.113.7'))
    for (const spelling of ['::ffff:203.0.113.7', '::FFFF:203.0.113.7', '0:0:0:0:0:ffff:203.0.113.7', '::ffff:cb00:7107', '0000:0000:0000:0000:0000:FFFF:CB00:7107']) {
      expect(clientLimitKey(spelling), spelling).toBe('203.0.113.7')
    }
  })

  it('leaves anything that is not an address as it is', () => {
    for (const text of ['unknown', '203.0.113', '203.0.113.256', '203.0.113.07', '2001:db8::1::2', '2001:db8:abcd:12:0:0:0:0:1', '2001:db8:abcd:12::g', ':2001:db8::1', 'fe80::1%eth0', '[2001:db8::1]']) {
      expect(clientLimitKey(text), text).toBe(text)
    }
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
