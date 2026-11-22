import postgres from 'postgres'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readMigrationEnv, resolveMigrationTarget, resolveMigrationUrl } from '@/db/migrate'

// Spy on the real factory so a refusal can be shown to happen before any client exists.
vi.mock('postgres', async (importOriginal) => {
  const actual = (await importOriginal<{ default: typeof postgres }>()).default
  return { default: Object.assign(vi.fn(actual), actual) }
})
const postgresFactory = vi.mocked(postgres)

beforeEach(() => postgresFactory.mockClear())
afterEach(() => vi.unstubAllEnvs())

const POOLED = 'postgres://shop:s3cr3t-pass@ep-cool-x-123-pooler.eu-central-1.aws.neon.tech/neondb?sslmode=require'
const DIRECT = 'postgres://shop:s3cr3t-pass@ep-cool-x-123.eu-central-1.aws.neon.tech/neondb?sslmode=require'
const MISMATCH = /DATABASE_URL_UNPOOLED must point to the same database as DATABASE_URL/

describe('readMigrationEnv', () => {
  it('forwards exactly the four variables the migration target needs', () => {
    expect(
      readMigrationEnv({
        DATABASE_URL_UNPOOLED: 'u',
        VERCEL: '1',
        VERCEL_ENV: 'preview',
        NEON_PRODUCTION_ENDPOINT: 'ep-x',
        DB_LOG: '1',
        DATABASE_URL: 'p',
        NODE_ENV: 'production',
      }),
    ).toStrictEqual({ DATABASE_URL_UNPOOLED: 'u', VERCEL: '1', VERCEL_ENV: 'preview', NEON_PRODUCTION_ENDPOINT: 'ep-x' })
  })
})

describe('resolveMigrationUrl', () => {
  it('uses DATABASE_URL when DATABASE_URL_UNPOOLED is unset', () => {
    expect(resolveMigrationUrl({ pooledUrl: POOLED, unpooledUrl: '' })).toBe(POOLED)
  })
  it('uses DATABASE_URL_UNPOOLED when it points at the same host and database', () => {
    const same = 'postgres://admin:other@db.example.com/shop'
    expect(resolveMigrationUrl({ pooledUrl: 'postgres://u:p@db.example.com/shop', unpooledUrl: same })).toBe(same)
  })
  it('uses the Neon direct endpoint of the pooled host', () => {
    expect(resolveMigrationUrl({ pooledUrl: POOLED, unpooledUrl: DIRECT })).toBe(DIRECT)
  })
  it('accepts DATABASE_URL_UNPOOLED identical to DATABASE_URL', () => {
    expect(resolveMigrationUrl({ pooledUrl: POOLED, unpooledUrl: POOLED })).toBe(POOLED)
  })
  it('compares database names decoded on both sides', () => {
    const encoded = DIRECT.replace('/neondb', '/neon%64b')
    expect(resolveMigrationUrl({ pooledUrl: POOLED, unpooledUrl: encoded })).toBe(encoded)
    expect(resolveMigrationUrl({ pooledUrl: POOLED.replace('/neondb', '/neon%64b'), unpooledUrl: DIRECT })).toBe(DIRECT)
  })
  it('accepts the same Neon endpoint options on both URLs', () => {
    const pooled = `${POOLED}&options=endpoint%3Dep-cool-x-123`
    const direct = `${DIRECT}&options=endpoint%3Dep-cool-x-123`
    expect(resolveMigrationUrl({ pooledUrl: pooled, unpooledUrl: direct })).toBe(direct)
  })
  it('treats an absent port as 5432', () => {
    const explicit = DIRECT.replace('.tech/', '.tech:5432/')
    expect(resolveMigrationUrl({ pooledUrl: POOLED, unpooledUrl: explicit })).toBe(explicit)
  })
  it.each([
    ['a different database', DIRECT.replace('/neondb', '/otherdb')],
    ['a different host', DIRECT.replace('ep-cool-x-123.', 'ep-other-456.')],
    ['a different region', DIRECT.replace('eu-central-1', 'us-east-2')],
    ['the -pooler suffix on another endpoint', DIRECT.replace('ep-cool-x-123.', 'ep-cool-x-12.')],
    ['a different port', DIRECT.replace('.tech/', '.tech:6543/')],
    ['the pooled host again with other credentials', POOLED.replace('shop:s3cr3t-pass', 'admin:s3cr3t-other')],
    ['options only on DATABASE_URL_UNPOOLED', `${DIRECT}&options=endpoint%3Dep-other-456`],
  ])('refuses %s without printing either URL', (_case, unpooledUrl) => {
    const run = () => resolveMigrationUrl({ pooledUrl: POOLED, unpooledUrl })
    expect(run).toThrow(MISMATCH)
    expect(run).not.toThrow(/s3cr3t|neon\.tech|neondb|otherdb|6543|ep-other/)
  })
  it.each([
    ['options only on DATABASE_URL', `${POOLED}&options=endpoint%3Dep-cool-x-123`, DIRECT],
    [
      'different endpoint options',
      `${POOLED}&options=endpoint%3Dep-cool-x-123`,
      `${DIRECT}&options=endpoint%3Dep-other-456`,
    ],
  ])('refuses %s', (_case, pooledUrl, unpooledUrl) => {
    const run = () => resolveMigrationUrl({ pooledUrl, unpooledUrl })
    expect(run).toThrow(MISMATCH)
    expect(run).not.toThrow(/s3cr3t|neon\.tech|ep-other|ep-cool/)
  })
  it('refuses a pooled host when DATABASE_URL is the direct one', () => {
    expect(() => resolveMigrationUrl({ pooledUrl: DIRECT, unpooledUrl: POOLED })).toThrow(MISMATCH)
  })
  it('refuses when both URLs use pooled hosts', () => {
    const otherPooled = POOLED.replace('ep-cool-x-123-pooler.', 'ep-other-456-pooler.')
    expect(() => resolveMigrationUrl({ pooledUrl: POOLED, unpooledUrl: otherPooled })).toThrow(MISMATCH)
  })
  it.each([
    ['a malformed URL', 'mysql://shop:s3cr3t-pass@h/db', /^DATABASE_URL_UNPOOLED is invalid/],
    ['a control character', DIRECT.replace('/neondb', '/neon\tdb'), /^DATABASE_URL_UNPOOLED is invalid/],
    ['a duplicate sslmode', `${DIRECT}&sslmode=disable`, /^DATABASE_URL_UNPOOLED is invalid/],
    ['plaintext TLS', DIRECT.replace('sslmode=require', 'sslmode=disable'), /^DATABASE_URL_UNPOOLED is refused/],
    ['a truncated URL without user', DIRECT.replace('shop:s3cr3t-pass@', ''), /^DATABASE_URL_UNPOOLED is refused: a non-local/],
    ['unsupported options', `${DIRECT}&options=-c%20role%3Ds3cr3t`, /^DATABASE_URL_UNPOOLED is refused: the options/],
  ])('names DATABASE_URL_UNPOOLED for %s', (_case, unpooledUrl, message) => {
    const run = () => resolveMigrationUrl({ pooledUrl: POOLED, unpooledUrl })
    expect(run).toThrow(message)
    expect(run).not.toThrow(/s3cr3t|neon\.tech/)
  })
})

// The exact pair the Vercel ↔ Neon Marketplace integration injects (credentials are fake).
describe('resolveMigrationUrl with Neon integration URLs', () => {
  const QUERY = '?sslmode=require&channel_binding=require'
  const NEON_POOLED = `postgresql://neondb_owner:npg_FakePass123@ep-fake-dew-a1b2c3d4-pooler.ap-southeast-1.aws.neon.tech/neondb${QUERY}`
  const NEON_DIRECT = `postgresql://neondb_owner:npg_FakePass123@ep-fake-dew-a1b2c3d4.ap-southeast-1.aws.neon.tech/neondb${QUERY}`

  it('uses DATABASE_URL_UNPOOLED for the direct endpoint of the same Neon branch', () => {
    expect(resolveMigrationUrl({ pooledUrl: NEON_POOLED, unpooledUrl: NEON_DIRECT })).toBe(NEON_DIRECT)
  })
  it('accepts the pair when only sslmode is present', () => {
    const pooled = NEON_POOLED.replace('&channel_binding=require', '')
    const direct = NEON_DIRECT.replace('&channel_binding=require', '')
    expect(resolveMigrationUrl({ pooledUrl: pooled, unpooledUrl: direct })).toBe(direct)
  })
  it('refuses the direct endpoint of another Neon branch', () => {
    const otherBranch = NEON_DIRECT.replace('ep-fake-dew-a1b2c3d4.', 'ep-fake-sun-e5f6g7h8.')
    const run = () => resolveMigrationUrl({ pooledUrl: NEON_POOLED, unpooledUrl: otherBranch })
    expect(run).toThrow(MISMATCH)
    expect(run).not.toThrow(/npg_FakePass123|neon\.tech/)
  })
})

// Fake ids only: the real production endpoint lives in Vercel, never in the repo.
describe('production endpoint guard on the migration path (NS-36)', () => {
  const PROD = 'ep-prod-main-a1b2c3d4'
  const BRANCH = 'ep-fake-dew-a1b2c3d4'
  const neon = (host: string) =>
    `postgresql://neondb_owner:npg_FakePass123@${host}.ap-southeast-1.aws.neon.tech/neondb?sslmode=require`
  const preview = (NEON_PRODUCTION_ENDPOINT?: string) => ({ VERCEL: '1', VERCEL_ENV: 'preview', NEON_PRODUCTION_ENDPOINT })

  it('lets a preview migrate over the direct endpoint of its own branch', () => {
    const resolved = resolveMigrationTarget({
      pooledUrl: neon(`${BRANCH}-pooler`),
      env: { ...preview(PROD), DATABASE_URL_UNPOOLED: neon(BRANCH) },
    })
    expect(resolved).toEqual({ target: { kind: 'postgres', url: neon(BRANCH) }, name: 'DATABASE_URL_UNPOOLED' })
  })
  it('checks the unpooled URL against the production endpoint', () => {
    const run = () =>
      resolveMigrationTarget({ pooledUrl: neon(`${PROD}-pooler`), env: { ...preview(PROD), DATABASE_URL_UNPOOLED: neon(PROD) } })
    expect(run).toThrow(/NEON_PRODUCTION_ENDPOINT/)
    expect(run).not.toThrow(/npg_FakePass123|neon\.tech|ep-prod/)
  })
  it('checks the pooled URL when DATABASE_URL_UNPOOLED is unset', () => {
    expect(() => resolveMigrationTarget({ pooledUrl: neon(`${PROD}-pooler`), env: preview(PROD) })).toThrow(
      /NEON_PRODUCTION_ENDPOINT/,
    )
  })
  it('refuses a preview migration when NEON_PRODUCTION_ENDPOINT is missing', () => {
    const run = () =>
      resolveMigrationTarget({ pooledUrl: neon(`${BRANCH}-pooler`), env: { ...preview(), DATABASE_URL_UNPOOLED: neon(BRANCH) } })
    expect(run).toThrow(/NEON_PRODUCTION_ENDPOINT/)
  })

  const PROD_ENV = {
    VERCEL: '1',
    VERCEL_ENV: 'preview',
    NEON_PRODUCTION_ENDPOINT: PROD,
    DATABASE_URL: neon(`${PROD}-pooler`),
    DATABASE_URL_UNPOOLED: neon(PROD),
  }
  // ADR-0010 decision A: DDL needs the owner, and ALTER DEFAULT PRIVILEGES only covers objects that role creates.
  it('keeps the owner role of the URL for db:migrate when the app role is configured (NS-60)', async () => {
    vi.resetModules()
    const env = {
      VERCEL: '1',
      VERCEL_ENV: 'preview',
      NEON_PRODUCTION_ENDPOINT: PROD,
      DATABASE_URL: neon(`${BRANCH}-pooler`),
      DATABASE_URL_UNPOOLED: neon(BRANCH),
      DATABASE_APP_USER: 'next_store_app',
      DATABASE_APP_PASSWORD: 'npg_AppFake456',
    }
    for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value)
    const saved = globalThis.nextStoreDbRuntime
    globalThis.nextStoreDbRuntime = undefined
    try {
      const { openMigrationConnection } = await import('@/db/migrate')
      const { closeConnection, connection, describeTarget } = await import('@/db/client')
      const migration = openMigrationConnection()
      expect(connection.appRole).toEqual({ username: 'next_store_app' })
      expect(migration.appRole).toBeUndefined()
      expect(postgresFactory.mock.calls.at(-1)?.[0]).toMatchObject({
        host: [`${BRANCH}.ap-southeast-1.aws.neon.tech`],
        username: 'neondb_owner',
        password: 'npg_FakePass123',
      })
      expect(describeTarget(migration.target, migration.appRole)).toMatch(/ user=neondb_owner$/)
      await closeConnection(migration)
      await closeConnection(connection)
    } finally {
      globalThis.nextStoreDbRuntime = saved
    }
  })

  it.each(['@/db/migrate', '@/db/seed'])(
    'refuses to migrate a preview against the production endpoint before constructing a client (%s)',
    async (entry) => {
      vi.resetModules()
      for (const [key, value] of Object.entries(PROD_ENV)) vi.stubEnv(key, value)
      const saved = globalThis.nextStoreDbRuntime
      globalThis.nextStoreDbRuntime = undefined
      try {
        await expect(import(entry)).rejects.toThrow(/trùng NEON_PRODUCTION_ENDPOINT/)
        expect(postgresFactory).not.toHaveBeenCalled()
      } finally {
        globalThis.nextStoreDbRuntime = saved
      }
    },
  )
})
