import { describe, expect, it } from 'vitest'
import { readPaymentConfig } from '@/features/checkout/config'

// Fake values, test only.
const SECRET = 'test-fake-payment-secret-0123456789ab'
const SESSION = 'test-session-secret-0123456789abcdef'

describe('readPaymentConfig', () => {
  it('is enabled with a 32-character secret', () => {
    expect(readPaymentConfig({ FAKE_PAYMENT_SECRET: SECRET, SESSION_SECRET: SESSION, TEST_PAYMENTS_ACCESS: 'public' })).toEqual({
      enabled: true,
      provider: 'fake',
      fakeSecret: SECRET,
      access: 'public',
    })
  })

  it('defaults to fake when PAYMENT_PROVIDER is empty', () => {
    for (const PAYMENT_PROVIDER of [undefined, '', '  ', ' fake ']) {
      const config = readPaymentConfig({ PAYMENT_PROVIDER, FAKE_PAYMENT_SECRET: SECRET })
      expect(config.enabled, String(PAYMENT_PROVIDER)).toBe(true)
    }
  })

  it('is unsupported for any other provider', () => {
    for (const PAYMENT_PROVIDER of ['payos', 'vnpay', 'FAKE', 'fake2']) {
      expect(readPaymentConfig({ PAYMENT_PROVIDER, FAKE_PAYMENT_SECRET: SECRET }), PAYMENT_PROVIDER).toEqual({
        enabled: false,
        reason: 'unsupported',
      })
    }
  })

  it('is disabled when FAKE_PAYMENT_SECRET is missing or under 32 characters', () => {
    for (const FAKE_PAYMENT_SECRET of [undefined, '', '   \n']) {
      expect(readPaymentConfig({ FAKE_PAYMENT_SECRET }), String(FAKE_PAYMENT_SECRET)).toEqual({
        enabled: false,
        reason: 'missing',
      })
    }
    for (const FAKE_PAYMENT_SECRET of ['x'.repeat(31), `  ${'x'.repeat(31)}  `]) {
      expect(readPaymentConfig({ FAKE_PAYMENT_SECRET })).toEqual({ enabled: false, reason: 'weak' })
    }
    expect(readPaymentConfig({ FAKE_PAYMENT_SECRET: 'x'.repeat(32) }).enabled).toBe(true)
  })

  it('is disabled when FAKE_PAYMENT_SECRET equals SESSION_SECRET', () => {
    expect(readPaymentConfig({ FAKE_PAYMENT_SECRET: SECRET, SESSION_SECRET: SECRET })).toEqual({
      enabled: false,
      reason: 'weak',
    })
    expect(readPaymentConfig({ FAKE_PAYMENT_SECRET: SECRET, SESSION_SECRET: `${SECRET}\n` })).toEqual({
      enabled: false,
      reason: 'weak',
    })
  })

  it('test payments default to admin access when TEST_PAYMENTS_ACCESS is empty or unknown', () => {
    for (const TEST_PAYMENTS_ACCESS of [undefined, '', 'Public', 'open', 'true', 'admin']) {
      const config = readPaymentConfig({ FAKE_PAYMENT_SECRET: SECRET, TEST_PAYMENTS_ACCESS })
      expect(config.enabled && config.access, String(TEST_PAYMENTS_ACCESS)).toBe('admin')
    }
    const config = readPaymentConfig({ FAKE_PAYMENT_SECRET: SECRET, TEST_PAYMENTS_ACCESS: 'public ' })
    expect(config.enabled && config.access).toBe('public')
  })

  it('never puts a value in a disabled answer', () => {
    expect(JSON.stringify(readPaymentConfig({ FAKE_PAYMENT_SECRET: 'x'.repeat(10) }))).not.toContain('xxxx')
  })
})
