import { describe, expect, it } from 'vitest'
import { resolveMigrationUrl } from '@/db/migrate'

const POOLED = 'postgres://shop:s3cr3t-pass@ep-cool-x-123-pooler.eu-central-1.aws.neon.tech/neondb?sslmode=require'
const DIRECT = 'postgres://shop:s3cr3t-pass@ep-cool-x-123.eu-central-1.aws.neon.tech/neondb?sslmode=require'
const MISMATCH = /DATABASE_URL_UNPOOLED must point to the same database as DATABASE_URL/

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
  ])('refuses %s without printing either URL', (_case, unpooledUrl) => {
    const run = () => resolveMigrationUrl({ pooledUrl: POOLED, unpooledUrl })
    expect(run).toThrow(MISMATCH)
    expect(run).not.toThrow(/s3cr3t|neon\.tech|neondb|otherdb|6543/)
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
  ])('names DATABASE_URL_UNPOOLED for %s', (_case, unpooledUrl, message) => {
    const run = () => resolveMigrationUrl({ pooledUrl: POOLED, unpooledUrl })
    expect(run).toThrow(message)
    expect(run).not.toThrow(/s3cr3t|neon\.tech/)
  })
})
