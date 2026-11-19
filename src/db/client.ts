import 'server-only'
import { mkdirSync, readFileSync } from 'node:fs'
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
// Compared after `new URL`, which serialises `[0:0:0:0:0:0:0:1]` as `[::1]`; the brackets are stripped below.
const LOCAL_HOSTS = ['localhost', '127.0.0.1', '::1']
const DEFAULT_PORT = 5432

// All messages are fixed text on purpose: the URL carries the password, query values can carry secrets
// (`options`, file paths), and Node's own URL / fs errors echo their input. `name` is the variable name only.
const invalidUrlMessage = (name: string) =>
  `${name} is invalid: expected postgres:// or postgresql:// with one hostname, a port other than 0 and a ` +
  'database name; no whitespace or control characters; no host / hostaddr / port query parameters; ' +
  'each of sslmode, ssl, sslrootcert, channel_binding, options, application_name at most once; ' +
  'channel_binding = disable | prefer | require.'
const insecureTlsMessage = (name: string) =>
  `${name} is refused: a non-local host needs verified TLS — sslmode/ssl must be absent or one of ` +
  'require | verify-ca | verify-full | true (all are enforced as verify-full), sslrootcert must not be empty; ' +
  'disable, allow, prefer, false, an empty or an unknown value would allow plaintext or an unverified certificate.'
const unknownLocalTlsMessage = (name: string) =>
  `${name} is refused: sslmode/ssl on a local host must be absent or one of ` +
  'disable | false | allow | prefer | require | verify-ca | verify-full | true, and sslrootcert must not be empty.'
const invalidOptionsMessage = (name: string) =>
  `${name} is refused: the options parameter must be exactly endpoint=<id> (lower-case letters, digits and -); ` +
  'no other startup option is forwarded.'
const missingUserMessage = (name: string) =>
  `${name} is refused: a non-local host needs a user name in the URL; ` +
  'the client never falls back to PGUSER or the operating-system user.'
const sslrootcertReadMessage = (name: string) => `${name} sslrootcert could not be read`
const clientCreateMessage = (name: string) => `Could not create the Postgres client from ${name}`

// postgres-js would let these override the hostname and port of the URL; refuse them outright, any case.
const FORBIDDEN_QUERY_PARAMS = ['host', 'hostaddr', 'port']
// The only query parameters we act on (exact, case-sensitive keys, as libpq and postgres-js read them).
// Everything else is dropped, not forwarded: postgres-js copies unknown keys into the startup message
// *after* user and database, so `?database=other` or `?user=x` would silently change the target, and keys such
// as target_session_attrs / sslcert / sslkey change driver behaviour we have not reviewed.
//   options          — Neon needs `options=endpoint%3D<id>` for clients without SNI.
//   application_name — a label in pg_stat_activity, no effect on routing or security.
//   channel_binding  — Neon URLs ship `channel_binding=require` (SCRAM-SHA-256-PLUS); dropping it would downgrade.
const TLS_QUERY_PARAMS = ['sslmode', 'ssl', 'sslrootcert']
const STARTUP_QUERY_PARAMS = ['options', 'application_name']
const SINGLE_QUERY_PARAMS = [...TLS_QUERY_PARAMS, ...STARTUP_QUERY_PARAMS, 'channel_binding']
const CHANNEL_BINDINGS = ['disable', 'prefer', 'require'] as const
const REMOTE_TLS_MODES = ['require', 'verify-ca', 'verify-full', 'true']
const LOCAL_PLAINTEXT_MODES = ['disable', 'false']
// postgres-js 4.1.1 treats verify-ca and true exactly like verify-full, and its `SSL` type only knows the
// normalised names; loadSsl then sends 'verify-full' as an explicit object (see there).
const LOCAL_TLS_MODES: Record<string, 'allow' | 'prefer' | 'require' | 'verify-full'> = {
  allow: 'allow',
  prefer: 'prefer',
  require: 'require',
  'verify-ca': 'verify-full',
  'verify-full': 'verify-full',
  true: 'verify-full',
}

// Raw: C0 controls, space and DEL anywhere in the trimmed URL (`new URL` silently strips tab / newline).
const RAW_FORBIDDEN_CHARS = /[\u0000- \u007f]/
// Decoded: postgres-js writes user, database and startup parameters as NUL-terminated strings, so an encoded
// NUL would inject extra startup parameters; other controls have no legitimate use there either.
const DECODED_FORBIDDEN_CHARS = /[\u0000-\u001f\u007f]/
// Neon's SNI workaround is the only reason to accept `options`; anything wider (`-c role=…`, `-c search_path=…`,
// several endpoints) would change server behaviour after our checks, so the value is pinned to that one shape.
const NEON_ENDPOINT_OPTION = /^endpoint=[a-z0-9-]+$/

export type ParsedPostgresUrl = {
  /** Exactly what the client connects to; IPv6 literals without brackets. */
  host: string
  port: number
  database: string
  username: string
  password: string
  params: URLSearchParams
}

/** `{ caFile }`: verify the chain against this CA and keep Node's default hostname check. */
export type SslPolicy = false | 'allow' | 'prefer' | 'require' | 'verify-full' | { caFile: string }

const isLocalHost = (host: string) => LOCAL_HOSTS.includes(host.toLowerCase())

const decodeOrRaw = (value: string): string => {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

// The single parser: the guard, the log line and the client all read these values, never the raw string.
export const parsePostgresUrl = (rawUrl: string, name = 'DATABASE_URL'): ParsedPostgresUrl => {
  const invalid = () => new Error(invalidUrlMessage(name))
  const url = rawUrl.trim()
  if (RAW_FORBIDDEN_CHARS.test(url)) throw invalid()
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw invalid()
  }
  if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') throw invalid()
  // Opaque hosts keep `%xx` and `,` verbatim; neither is a hostname we could resolve as written.
  if (parsed.hostname === '' || /[%,]/.test(parsed.hostname)) throw invalid()
  if (parsed.port === '0') throw invalid()
  const database = decodeOrRaw(parsed.pathname.slice(1))
  if (database === '' || /[@/]/.test(database)) throw invalid()
  const params = parsed.searchParams
  const keys = [...params.keys()]
  if (keys.some((key) => FORBIDDEN_QUERY_PARAMS.includes(key.toLowerCase()))) throw invalid()
  if (SINGLE_QUERY_PARAMS.some((key) => params.getAll(key).length > 1)) throw invalid()
  const channelBinding = params.get('channel_binding')
  if (channelBinding !== null && !(CHANNEL_BINDINGS as readonly string[]).includes(channelBinding)) throw invalid()
  const username = decodeOrRaw(parsed.username)
  const password = decodeOrRaw(parsed.password)
  const decoded = [username, password, database, ...SINGLE_QUERY_PARAMS.map((key) => params.get(key) ?? '')]
  if (decoded.some((value) => DECODED_FORBIDDEN_CHARS.test(value))) throw invalid()
  const options = params.get('options')
  if (options !== null && !NEON_ENDPOINT_OPTION.test(options)) throw new Error(invalidOptionsMessage(name))
  const host = parsed.hostname.replace(/^\[(.*)\]$/, '$1')
  // postgres-js turns an empty user into PGUSER / the OS user, so a truncated URL would log in as someone else.
  if (username === '' && !isLocalHost(host)) throw new Error(missingUserMessage(name))
  return {
    host,
    port: parsed.port === '' ? DEFAULT_PORT : Number(parsed.port),
    database,
    username,
    password,
    params,
  }
}


// Same precedence as libpq / postgres-js: a non-empty sslmode wins, otherwise ssl; an empty sslmode with no
// ssl is "stated but empty" (''), which is not the same as absent (undefined).
const requestedTlsMode = (params: URLSearchParams): string | undefined => {
  const sslmode = params.get('sslmode')
  const ssl = params.get('ssl')
  if (sslmode) return sslmode.toLowerCase()
  if (ssl !== null) return ssl.toLowerCase()
  return sslmode === null ? undefined : ''
}

// The client is always built with an explicit `ssl`, which beats both the URL and PGSSLMODE in postgres-js.
// Remote host: any accepted mode becomes 'verify-full' (chain + hostname, enforced in loadSsl). Neon serves publicly trusted
// certificates, so require / verify-ca / true lose nothing; everything else is refused before a socket opens.
// `sslrootcert=<path>` swaps the trust store but keeps hostname verification (stricter than libpq verify-ca).
// Local host: absent / disable / false → no TLS; other known modes pass through (verify-ca / true → verify-full).
export const resolveSsl = (url: ParsedPostgresUrl, name = 'DATABASE_URL'): SslPolicy => {
  const mode = requestedTlsMode(url.params)
  const rootCert = url.params.get('sslrootcert')
  const local = isLocalHost(url.host)
  const refuse = () => new Error(local ? unknownLocalTlsMessage(name) : insecureTlsMessage(name))
  if (rootCert === '') throw refuse()
  const verified: SslPolicy = rootCert === null || rootCert === 'system' ? 'verify-full' : { caFile: rootCert }
  if (!local) {
    if (mode !== undefined && !REMOTE_TLS_MODES.includes(mode)) throw refuse()
    return verified
  }
  if (mode === undefined || LOCAL_PLAINTEXT_MODES.includes(mode)) return false
  const localMode = Object.hasOwn(LOCAL_TLS_MODES, mode) ? LOCAL_TLS_MODES[mode] : undefined
  if (localMode === undefined) throw refuse()
  return rootCert === null ? localMode : verified
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
    // Fail at resolve time so `db:migrate` / `prebuild` stop before any connection attempt.
    resolveSsl(parsePostgresUrl(url))
    return { kind: 'postgres', url }
  }
  return { kind: 'pglite', dataDir: env.PGLITE_DATA_DIR || DEFAULT_PGLITE_DATA_DIR }
}

// One log line for CLI scripts: enough to see which database is about to change, never credentials or query.
export const describeTarget = (target: DatabaseTarget): string => {
  if (target.kind === 'pglite') return `pglite dir=${target.dataDir}`
  const url = parsePostgresUrl(target.url)
  // The user tells which role DDL runs as (owner vs app role); the password and query never appear.
  return `postgres host=${url.host} port=${url.port} db=${url.database} user=${url.username}`
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

/** `name`: the variable the URL came from, used in every error so the operator knows which one to fix. */
type ConnectionOptions = { max?: number; name?: string }
type PostgresOptions = postgres.Options<Record<string, never>>

// Rethrow with fixed text and the errno / SQLSTATE code only; no `cause`, because describeError prints it.
const withFixedMessage = (message: string, error: unknown): Error => {
  const code = error instanceof Error && 'code' in error ? error.code : undefined
  return Object.assign(new Error(message), typeof code === 'string' || typeof code === 'number' ? { code } : {})
}

type LoadSslOptions = { policy: SslPolicy; name: string; readFile: (path: string) => Buffer }

// Verified TLS is always an object with `rejectUnauthorized: true`: postgres-js 4.1.1 turns the string
// 'verify-full' into `{}`, and Node then applies the process default, which NODE_TLS_REJECT_UNAUTHORIZED=0
// silently switches off. No checkServerIdentity override: Node's default verifies the hostname.
const loadSsl = ({ policy, name, readFile }: LoadSslOptions): PostgresOptions['ssl'] => {
  if (policy === 'verify-full') return { rejectUnauthorized: true }
  if (typeof policy !== 'object') return policy
  try {
    return { ca: readFile(policy.caFile), rejectUnauthorized: true }
  } catch (error) {
    throw withFixedMessage(sslrootcertReadMessage(name), error)
  }
}

// Explicit options only — postgres-js never sees the URL string, so it cannot re-parse it differently from us,
// and host / port / database / user / ssl from PG* env variables cannot override what we checked.
export const buildPostgresOptions = (
  url: string,
  { max = 5, name = 'DATABASE_URL' }: ConnectionOptions = {},
  readFile: (path: string) => Buffer = readFileSync,
): PostgresOptions => {
  const parsed = parsePostgresUrl(url, name)
  const ssl = loadSsl({ policy: resolveSsl(parsed, name), name, readFile })
  const connection = Object.fromEntries(
    STARTUP_QUERY_PARAMS.flatMap((key) => {
      const value = parsed.params.get(key)
      return value === null ? [] : [[key, value]]
    }),
  )
  const channelBinding = CHANNEL_BINDINGS.find((known) => known === parsed.params.get('channel_binding'))
  return {
    host: [parsed.host],
    port: [parsed.port],
    database: parsed.database,
    username: parsed.username,
    password: parsed.password,
    ssl,
    ...(channelBinding === undefined ? {} : { channel_binding: channelBinding }),
    connection,
    // Neon pooled URL (PgBouncer, transaction mode) cannot keep prepared statements across transactions.
    prepare: false,
    max,
    idle_timeout: 20,
    connect_timeout: 10,
  }
}

export const createConnection = (target: DatabaseTarget, { max = 5, name = 'DATABASE_URL' }: ConnectionOptions = {}) => {
  const logger = process.env.DB_LOG === '1'
  if (target.kind === 'postgres') {
    // Our own refusals already carry fixed text; only the driver's constructor errors need wrapping.
    const options = buildPostgresOptions(target.url, { max, name })
    let client: postgres.Sql
    try {
      client = postgres(options)
    } catch (error) {
      throw withFixedMessage(clientCreateMessage(name), error)
    }
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
