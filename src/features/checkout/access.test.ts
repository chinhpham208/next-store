import { beforeEach, describe, expect, it, vi } from 'vitest'

const hasAdminSession = vi.fn<() => Promise<boolean>>()
vi.mock('@/features/admin', () => ({ hasAdminSession: () => hasAdminSession() }))

// Fake values, test only.
const SECRET = 'test-fake-payment-secret-0123456789ab'

const loadAccess = async (env: Record<string, string>) => {
  vi.resetModules()
  vi.unstubAllEnvs()
  for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value)
  return (await import('@/features/checkout/access')).checkoutAccess
}

beforeEach(() => {
  hasAdminSession.mockReset()
  vi.unstubAllEnvs()
})

describe('checkoutAccess', () => {
  it('is open for everyone with public access', async () => {
    hasAdminSession.mockResolvedValue(false)
    const checkoutAccess = await loadAccess({ FAKE_PAYMENT_SECRET: SECRET, TEST_PAYMENTS_ACCESS: 'public' })
    expect(await checkoutAccess()).toBe('open')
    expect(hasAdminSession).not.toHaveBeenCalled()
  })

  it('is open only with an admin session with admin access', async () => {
    const checkoutAccess = await loadAccess({ FAKE_PAYMENT_SECRET: SECRET, TEST_PAYMENTS_ACCESS: '' })
    hasAdminSession.mockResolvedValue(false)
    expect(await checkoutAccess()).toBe('not-open')
    hasAdminSession.mockResolvedValue(true)
    expect(await checkoutAccess()).toBe('open')
  })

  it('is not-configured when payments are off, without reading the session', async () => {
    const checkoutAccess = await loadAccess({ FAKE_PAYMENT_SECRET: '', TEST_PAYMENTS_ACCESS: 'public' })
    expect(await checkoutAccess()).toBe('not-configured')
    expect(hasAdminSession).not.toHaveBeenCalled()
  })
})
