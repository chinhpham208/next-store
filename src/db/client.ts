import 'server-only'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite'
import { drizzle as drizzlePostgres } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from '@/db/schema'

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>

type DatabaseEnv = { DATABASE_URL?: string; VERCEL?: string; VERCEL_ENV?: string; PGLITE_DATA_DIR?: string }

export type DatabaseTarget = { kind: 'postgres'; url: string } | { kind: 'pglite'; dataDir: string }

const DEFAULT_PGLITE_DATA_DIR = '.data/pglite'
const VERCEL_ENVS = ['production', 'preview', 'development']
const LOCAL_HOSTNAMES = ['localhost', '127.0.0.1', '::1', '[::1]']
// Fixed text on purpose: the URL carries the password, and Node's own URL errors echo their input.
const INVALID_URL_MESSAGE = 'DATABASE_URL is invalid: expected postgres:// or postgresql:// with a hostname.'

const parsePostgresUrl = (url: string): URL => {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new Error(INVALID_URL_MESSAGE)
  }
  if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') throw new Error(INVALID_URL_MESSAGE)
  if (parsed.hostname === '') throw new Error(INVALID_URL_MESSAGE)
  return parsed
}

export const resolveDatabaseTarget = (env: DatabaseEnv): DatabaseTarget => {
  // `.env.example` ships `DATABASE_URL=`; an empty or whitespace value must mean "unset", not "connect to ''".
  const url = env.DATABASE_URL?.trim() ?? ''
  // Vercel sets VERCEL=1 today; any non-empty value counts so a format change cannot silently disable the checks.
  const onVercel = Boolean(env.VERCEL)
  // A Vercel build without DATABASE_URL would silently use a throwaway PGlite inside the build container.
  if (onVercel && url === '') {
    throw new Error('DATABASE_URL is required on Vercel (VERCEL is set); refusing to fall back to PGlite.')
  }
  // The seed guard trusts VERCEL_ENV, so on Vercel an unknown value is a misconfiguration, not "not production".
  if (onVercel && !VERCEL_ENVS.includes(env.VERCEL_ENV ?? '')) {
    throw new Error('VERCEL_ENV must be one of production | preview | development when VERCEL is set.')
  }
  if (url !== '') {
    parsePostgresUrl(url)
    return { kind: 'postgres', url }
  }
  return { kind: 'pglite', dataDir: env.PGLITE_DATA_DIR || DEFAULT_PGLITE_DATA_DIR }
}

// One log line for CLI scripts: enough to see which database is about to change, never credentials or query.
export const describeTarget = (target: DatabaseTarget): string => {
  if (target.kind === 'pglite') return `pglite dir=${target.dataDir}`
  const url = parsePostgresUrl(target.url)
  return `postgres host=${url.hostname} db=${url.pathname.slice(1) || '(mặc định)'}`
}

const describeOne = (error: Error): string => {
  const code = 'code' in error && (typeof error.code === 'string' || typeof error.code === 'number') ? error.code : ''
  return code === '' ? error.message.trim() : `${error.message.trim()} (code ${code})`
}

// Driver errors can embed connection details; scripts print only the message and the SQLSTATE / errno code.
// Drizzle wraps driver errors ("Failed query: …"), so the real reason (ECONNREFUSED, 42P01) lives in `cause`.
export const describeError = (error: unknown): string => {
  if (!(error instanceof Error)) return 'unknown error'
  if (error.cause instanceof Error) return `${describeOne(error)}; nguyên nhân: ${describeOne(error.cause)}`
  return describeOne(error)
}

// Remote Postgres must be TLS; keep a stronger `sslmode=verify-full` from the URL instead of downgrading it.
const sslFor = (url: URL) => {
  if (LOCAL_HOSTNAMES.includes(url.hostname)) return undefined
  return url.searchParams.get('sslmode') === 'verify-full' ? 'verify-full' : 'require'
}

type ConnectionOptions = { max?: number }

export const createConnection = (target: DatabaseTarget, { max = 5 }: ConnectionOptions = {}) => {
  const logger = process.env.DB_LOG === '1'
  if (target.kind === 'postgres') {
    // Neon pooled URL (PgBouncer, transaction mode) cannot keep prepared statements across transactions.
    const client = postgres(target.url, {
      prepare: false,
      max,
      idle_timeout: 20,
      connect_timeout: 10,
      ssl: sslFor(parsePostgresUrl(target.url)),
    })
    return { kind: 'postgres', target, db: drizzlePostgres({ client, schema, logger }) } as const
  }
  // PGlite does not create missing parent directories (fresh clone has no `.data/`).
  if (!target.dataDir.startsWith('memory://')) mkdirSync(dirname(target.dataDir), { recursive: true })
  const client = new PGlite(target.dataDir)
  return { kind: 'pglite', target, db: drizzlePglite({ client, schema, logger }) } as const
}

export type Connection = ReturnType<typeof createConnection>

declare global {
  // Survives dev hot reload so PGlite (single process, single handle) is never opened twice.
  var nextStoreDbConnection: Connection | undefined
}

export const connection: Connection = (globalThis.nextStoreDbConnection ??= createConnection(
  resolveDatabaseTarget({
    DATABASE_URL: process.env.DATABASE_URL,
    VERCEL: process.env.VERCEL,
    VERCEL_ENV: process.env.VERCEL_ENV,
    PGLITE_DATA_DIR: process.env.PGLITE_DATA_DIR,
  }),
))

export const db: Db = connection.db

export const closeConnection = async (target: Connection = connection) => {
  if (target.kind === 'postgres') return target.db.$client.end()
  return target.db.$client.close()
}
