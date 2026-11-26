import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const hasAdminSession = vi.fn<() => Promise<boolean>>()
const connection = vi.fn<() => Promise<void>>()
vi.mock('@/features/admin', () => ({ hasAdminSession: () => hasAdminSession() }))
vi.mock('next/server', () => ({ connection: () => connection() }))

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
  connection.mockReset()
  connection.mockResolvedValue(undefined)
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

  // Audit PR #124 M1 (same class as #105 M1): env is read after the request, so a build's env is never baked in.
  it('awaits connection() before it reads the environment, in every branch', async () => {
    const events: string[] = []
    connection.mockImplementation(() => {
      events.push('connection')
      return Promise.resolve()
    })
    hasAdminSession.mockImplementation(() => {
      events.push('session')
      return Promise.resolve(true)
    })
    for (const env of [
      { FAKE_PAYMENT_SECRET: '', TEST_PAYMENTS_ACCESS: 'public' },
      { FAKE_PAYMENT_SECRET: SECRET, TEST_PAYMENTS_ACCESS: 'public' },
      { FAKE_PAYMENT_SECRET: SECRET, TEST_PAYMENTS_ACCESS: '' },
    ]) {
      events.length = 0
      const checkoutAccess = await loadAccess(env)
      // A getter that records when the config is read: connection() must already be in the list.
      const reads: string[][] = []
      const original = process.env
      Object.defineProperty(process, 'env', {
        configurable: true,
        value: new Proxy(original, {
          get(target, key, receiver) {
            if (key === 'FAKE_PAYMENT_SECRET') reads.push([...events])
            return Reflect.get(target, key, receiver) as unknown
          },
        }),
      })
      try {
        await checkoutAccess()
      } finally {
        Object.defineProperty(process, 'env', { configurable: true, value: original })
      }
      expect(reads.length, JSON.stringify(env)).toBeGreaterThan(0)
      for (const seen of reads) expect(seen[0]).toBe('connection')
    }
  })

  it('reads connection() in the source before any other await or env read', () => {
    const source = readFileSync('src/features/checkout/access.ts', 'utf8').replace(/^\s*\/\/.*$/gm, '')
    const body = source.slice(source.indexOf('export const checkoutAccess'))
    expect(body.indexOf('await connection()')).toBeGreaterThan(-1)
    expect(body.indexOf('await connection()')).toBeLessThan(body.indexOf('readPaymentConfig()'))
    expect(body.indexOf('await connection()')).toBeLessThan(body.indexOf('hasAdminSession()'))
  })
})
