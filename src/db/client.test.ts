import { describe, expect, it } from 'vitest'
import { describeError, describeTarget, resolveDatabaseTarget } from '@/db/client'

const SECRET_URL = 'postgres://shop:s3cr3t-pass@ep-x-pooler.neon.tech/neondb?sslmode=require&options=s3cr3t-opt'

describe('resolveDatabaseTarget', () => {
  it('uses PGlite at .data/pglite by default', () => {
    expect(resolveDatabaseTarget({})).toEqual({ kind: 'pglite', dataDir: '.data/pglite' })
  })
  it('uses PGLITE_DATA_DIR when set', () => {
    expect(resolveDatabaseTarget({ PGLITE_DATA_DIR: 'memory://' })).toEqual({ kind: 'pglite', dataDir: 'memory://' })
  })
  it('treats an empty DATABASE_URL as unset', () => {
    expect(resolveDatabaseTarget({ DATABASE_URL: '' }).kind).toBe('pglite')
  })
  it('uses Postgres when DATABASE_URL is set', () => {
    expect(resolveDatabaseTarget({ DATABASE_URL: 'postgres://u:p@h/db' })).toEqual({
      kind: 'postgres',
      url: 'postgres://u:p@h/db',
    })
  })
  it('trims whitespace around DATABASE_URL', () => {
    expect(resolveDatabaseTarget({ DATABASE_URL: '  postgresql://u:p@h/db\n' })).toEqual({
      kind: 'postgres',
      url: 'postgresql://u:p@h/db',
    })
  })
  it('requires DATABASE_URL on Vercel', () => {
    expect(() => resolveDatabaseTarget({ VERCEL: '1' })).toThrow(/DATABASE_URL/)
  })
  it('treats a whitespace-only DATABASE_URL on Vercel as missing', () => {
    expect(() => resolveDatabaseTarget({ VERCEL: '1', VERCEL_ENV: 'preview', DATABASE_URL: '  \t' })).toThrow(
      /DATABASE_URL is required/,
    )
  })
  it('treats any non-empty VERCEL as running on Vercel', () => {
    expect(() => resolveDatabaseTarget({ VERCEL: 'true', VERCEL_ENV: 'preview' })).toThrow(/DATABASE_URL/)
  })
  it.each([undefined, '', 'Production', 'prod', 'staging'])('rejects VERCEL_ENV=%j on Vercel', (vercelEnv) => {
    expect(() => resolveDatabaseTarget({ VERCEL: '1', VERCEL_ENV: vercelEnv, DATABASE_URL: SECRET_URL })).toThrow(
      /VERCEL_ENV must be one of/,
    )
  })
  it.each(['production', 'preview', 'development'])('accepts VERCEL_ENV=%s on Vercel', (vercelEnv) => {
    expect(resolveDatabaseTarget({ VERCEL: '1', VERCEL_ENV: vercelEnv, DATABASE_URL: SECRET_URL }).kind).toBe(
      'postgres',
    )
  })
  it.each([
    'mysql://shop:s3cr3t-pass@h/db',
    'postgres:///db?password=s3cr3t-pass',
    'shop:s3cr3t-pass@h/db',
    'http://shop:s3cr3t-pass@h/db',
  ])('rejects %s without echoing it', (url) => {
    expect(() => resolveDatabaseTarget({ DATABASE_URL: url })).toThrow(/DATABASE_URL is invalid/)
    expect(() => resolveDatabaseTarget({ DATABASE_URL: url })).not.toThrow(/s3cr3t/)
  })
})

describe('describeTarget', () => {
  it('shows host and database but never user, password or query', () => {
    const line = describeTarget({ kind: 'postgres', url: SECRET_URL })
    expect(line).toBe('postgres host=ep-x-pooler.neon.tech db=neondb')
    expect(line).not.toMatch(/shop|s3cr3t|sslmode/)
  })
  it('shows the PGlite directory', () => {
    expect(describeTarget({ kind: 'pglite', dataDir: '.data/pglite' })).toBe('pglite dir=.data/pglite')
  })
})

describe('describeError', () => {
  it('keeps only the message and code', () => {
    const error = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:1'), {
      code: 'ECONNREFUSED',
      options: { pass: 's3cr3t-pass' },
    })
    expect(describeError(error)).toBe('connect ECONNREFUSED 127.0.0.1:1 (code ECONNREFUSED)')
  })
  it('includes the message and code of a wrapped cause', () => {
    const cause = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:1'), { code: 'ECONNREFUSED' })
    expect(describeError(new Error('Failed query: select 1', { cause }))).toBe(
      'Failed query: select 1; nguyên nhân: connect ECONNREFUSED 127.0.0.1:1 (code ECONNREFUSED)',
    )
  })
  it('does not stringify non-Error values', () => {
    expect(describeError({ password: 's3cr3t-pass' })).toBe('unknown error')
  })
})
