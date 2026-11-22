import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { assertSeedAllowed, seed } from '@/db/seed'

// Pretend the runtime connection is Postgres; `transaction` is the first DB call seed makes, so a guard that
// ran after any statement would show up as a call on this spy.
const fake = vi.hoisted(() => ({ transaction: vi.fn(async () => undefined) }))
vi.mock('@/db/client', () => ({
  db: fake,
  connection: { kind: 'postgres', target: { kind: 'postgres', url: 'postgres://u:p@h/db' }, db: fake },
  closeConnection: vi.fn(),
  describeError: vi.fn(),
  describeTarget: vi.fn(),
}))

afterEach(() => {
  vi.unstubAllEnvs()
  fake.transaction.mockClear()
})

describe('assertSeedAllowed', () => {
  it.each([undefined, '', 'production', 'Production', 'production ', 'prod', 'development', 'preview '])(
    'refuses Postgres when VERCEL_ENV=%j',
    (vercelEnv) => {
      expect(() => assertSeedAllowed({ targetKind: 'postgres', vercelEnv })).toThrow(/production/)
    },
  )
  it('allows Postgres on a Vercel preview', () => {
    expect(() => assertSeedAllowed({ targetKind: 'postgres', vercelEnv: 'preview' })).not.toThrow()
  })
  it('has no production override left', () => {
    expect(() => assertSeedAllowed({ targetKind: 'postgres', vercelEnv: 'production' })).toThrow(/db:seed:sql/)
    expect(readFileSync('src/db/seed.ts', 'utf8')).not.toMatch(/allow-?production/i)
  })
  it('points to the Neon SQL Editor route in the refusal', () => {
    expect(() => assertSeedAllowed({ targetKind: 'postgres', vercelEnv: undefined })).toThrow(/Neon SQL Editor/)
  })
  it('always allows PGlite, even with VERCEL_ENV=production', () => {
    expect(() => assertSeedAllowed({ targetKind: 'pglite', vercelEnv: 'production' })).not.toThrow()
  })
})

describe('seed on a Postgres target', () => {
  it('refuses before any statement when VERCEL_ENV is unset', async () => {
    vi.stubEnv('VERCEL_ENV', undefined)
    await expect(seed()).rejects.toThrow(/production/)
    expect(fake.transaction).not.toHaveBeenCalled()
  })
  it('refuses before any statement when VERCEL_ENV=production', async () => {
    vi.stubEnv('VERCEL_ENV', 'production')
    await expect(seed()).rejects.toThrow(/production/)
    expect(fake.transaction).not.toHaveBeenCalled()
  })
  it('seeds a Vercel preview', async () => {
    vi.stubEnv('VERCEL_ENV', 'preview')
    await seed()
    expect(fake.transaction).toHaveBeenCalledOnce()
  })
})
