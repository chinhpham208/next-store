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

type DatabaseEnv = {
  DATABASE_URL?: string
  VERCEL?: string
  VERCEL_ENV?: string
  PGLITE_DATA_DIR?: string
  NEON_PRODUCTION_ENDPOINT?: string
}

export type DatabaseTarget = { kind: 'postgres'; url: string } | { kind: 'pglite'; dataDir: string }

const DEFAULT_PGLITE_DATA_DIR = '.data/pglite'
// One source for both lists, so a new Vercel environment cannot be valid for resolveDatabaseTarget yet unknown to
// the endpoint and DB_LOG guards (which treat anything not listed here as production).
const NON_PRODUCTION_VERCEL_ENVS = ['preview', 'development']
const VERCEL_ENVS = ['production', ...NON_PRODUCTION_VERCEL_ENVS]
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

const POOLER_SUFFIX = '-pooler'
const NEON_ENDPOINT_ID = /^ep-[a-z0-9]+(?:-[a-z0-9]+)*$/
// Neon's fallback for clients without SNI: `endpoint=<id>;<password>` or `project=<id>$<password>`.
const NEON_PASSWORD_ENDPOINT = /^(?:endpoint|project)=/i

// Fixed text: the endpoint id, host and URL never appear, so a refusal in a public build log reveals nothing.
const ENDPOINT_MALFORMED_MESSAGE =
  'Từ chối kết nối: NEON_PRODUCTION_ENDPOINT không hợp lệ — phải là endpoint id của Neon branch production ' +
  '(dạng ep-…, chữ thường, không có hậu tố -pooler, không có tên miền).'
const ENDPOINT_MISSING_MESSAGE =
  'Từ chối kết nối: NEON_PRODUCTION_ENDPOINT chưa được đặt cho môi trường preview / development trên Vercel; ' +
  'không có nó thì không phân biệt được database của bản này với database production.'
const ENDPOINT_IS_PRODUCTION_MESSAGE =
  'Từ chối kết nối: database của bản preview / development trỏ tới endpoint production ' +
  '(trùng NEON_PRODUCTION_ENDPOINT); kiểm tra Neon branch mà tích hợp Neon gán cho nhánh git này.'
const ENDPOINT_IN_PASSWORD_MESSAGE =
  'Từ chối kết nối: mật khẩu trong URL database bắt đầu bằng endpoint= hoặc project=, tức Neon có thể định tuyến ' +
  'tới endpoint khác với host đã kiểm theo NEON_PRODUCTION_ENDPOINT; dùng URL do tích hợp Neon cấp.'
const ENDPOINT_UNKNOWN_NEON_HOST_MESSAGE =
  'Từ chối kết nối: host Neon của bản preview / development không mang endpoint id (ep-…), nên không so được với ' +
  'NEON_PRODUCTION_ENDPOINT; dùng URL do tích hợp Neon cấp.'
const ENDPOINT_NOT_PRODUCTION_MESSAGE =
  'Từ chối kết nối: database của production không nằm trên endpoint khai báo trong NEON_PRODUCTION_ENDPOINT; ' +
  'sửa giá trị biến hoặc DATABASE_URL trên Vercel.'

// Strips every trailing -pooler, not just one (audit PR #35 L2): whether Neon strips once or repeatedly is not
// verified, so `<prod>-pooler-pooler` must count as production rather than as an unknown endpoint.
const withoutPooler = (label: string): string => {
  let id = label
  while (id.endsWith(POOLER_SUFFIX)) id = id.slice(0, -POOLER_SUFFIX.length)
  return id
}

// Neon hostnames are `ep-<id>[-pooler].<region>.aws.neon.tech`; anything else has no endpoint in its host.
const hostEndpointId = (url: ParsedPostgresUrl): string | undefined => {
  const label = withoutPooler((url.host.split('.')[0] ?? '').toLowerCase())
  return label.startsWith('ep-') ? label : undefined
}

/** Every Neon endpoint the connection could reach: the host label and `options=endpoint=<id>` (SNI fallback). */
export const neonEndpointIds = (url: ParsedPostgresUrl): string[] => {
  const fromHost = hostEndpointId(url)
  const option = url.params.get('options')
  const fromOptions = option?.startsWith('endpoint=') ? withoutPooler(option.slice('endpoint='.length).toLowerCase()) : undefined
  return [...new Set([fromHost, fromOptions].filter((id) => id !== undefined))]
}

// A trailing dot is the same DNS name, so `api.….neon.tech.` must not slip past the suffix check.
const isNeonHost = (host: string): boolean => {
  const name = host.toLowerCase().replace(/\.+$/, '')
  return name === 'neon.tech' || name.endsWith('.neon.tech')
}

type EndpointGuardInput = { url: ParsedPostgresUrl; vercelEnv: string; productionEndpoint: string | undefined }

// Why a missing variable is fatal on preview / development but not on production: preview builds run
// migrate and seed, so silently losing the guard there is exactly the accident we prevent (fail closed).
// Production must keep deploying while the variable is being rolled out; once it is set, a wrong value
// stops production right away, which also verifies what the owner typed.
// The variable holds exactly one endpoint id (audit PR #15 L2). A read replica on the production branch is a
// second compute with its own id: before enabling one, widen this to a list, otherwise production refuses the
// replica and a preview pointed at it is not recognised as production.
// Password and host checks (audit PR #15 L1): Neon routes clients without SNI by an `endpoint=` / `project=`
// prefix in the password, and a Neon host without an `ep-` label names no endpoint, so in both cases the host we
// compared is not necessarily where the connection lands.
export const assertEndpointAllowed = ({ url, vercelEnv, productionEndpoint }: EndpointGuardInput): void => {
  const production = productionEndpoint?.trim() ?? ''
  if (production !== '' && (!NEON_ENDPOINT_ID.test(production) || production.endsWith(POOLER_SUFFIX))) {
    throw new Error(ENDPOINT_MALFORMED_MESSAGE)
  }
  // trimStart (audit PR #35 L2): a leading space must not hide the prefix from us if the proxy ignores it.
  if (NEON_PASSWORD_ENDPOINT.test(url.password.trimStart())) throw new Error(ENDPOINT_IN_PASSWORD_MESSAGE)
  const ids = neonEndpointIds(url)
  if (NON_PRODUCTION_VERCEL_ENVS.includes(vercelEnv)) {
    if (production === '') throw new Error(ENDPOINT_MISSING_MESSAGE)
    if (isNeonHost(url.host) && hostEndpointId(url) === undefined) throw new Error(ENDPOINT_UNKNOWN_NEON_HOST_MESSAGE)
    if (ids.includes(production)) throw new Error(ENDPOINT_IS_PRODUCTION_MESSAGE)
    return
  }
  if (production === '') return
  // The host must be the production endpoint, and an `options` endpoint (if any) must not route elsewhere.
  if (hostEndpointId(url) !== production || ids.some((id) => id !== production)) {
    throw new Error(ENDPOINT_NOT_PRODUCTION_MESSAGE)
  }
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
    const parsed = parsePostgresUrl(url)
    resolveSsl(parsed)
    // One choke point for runtime, db:migrate and db:seed. Off Vercel (local, CI, VPS) there is no preview
    // concept to protect, so the check would only add configuration.
    if (onVercel) {
      assertEndpointAllowed({
        url: parsed,
        vercelEnv: env.VERCEL_ENV ?? '',
        productionEndpoint: env.NEON_PRODUCTION_ENDPOINT,
      })
    }
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

// Fixed text: names the variable only, never the URL or host the refusal is about.
const DB_LOG_REFUSED_MESSAGE =
  'Từ chối DB_LOG=1: log của Drizzle in mọi câu lệnh kèm tham số (dữ liệu khách hàng), nên chỉ bật được với PGlite, ' +
  'Postgres trên localhost, hoặc bản preview / development chạy trên Vercel; tắt DB_LOG cho database này.'

/** The one definition of "DB_LOG is on": the guard and the logger must never disagree (audit PR #35 L3). */
export const isDbLogOn = (value: string | undefined): boolean => value === '1'

type DbLogGuardInput = {
  dbLog: string | undefined
  target: DatabaseTarget
  vercel: string | undefined
  vercelEnv: string | undefined
}

// Allow-list, same spirit as assertSeedAllowed: a remote Postgres counts as production unless Vercel says it is
// a preview / development deployment. A VPS, a missing or misspelt VERCEL_ENV must never turn on query logging
// for customer data (ADR-0008). VERCEL_ENV counts only when VERCEL is set (audit PR #35 M1): only then has
// resolveDatabaseTarget run the endpoint guard, so off Vercel a hand-set VERCEL_ENV=preview proves nothing.
export const assertDbLogAllowed = ({ dbLog, target, vercel, vercelEnv }: DbLogGuardInput): void => {
  if (!isDbLogOn(dbLog)) return
  if (target.kind === 'pglite') return
  if (isLocalHost(parsePostgresUrl(target.url).host)) return
  if (Boolean(vercel) && vercelEnv !== undefined && NON_PRODUCTION_VERCEL_ENVS.includes(vercelEnv)) return
  throw new Error(DB_LOG_REFUSED_MESSAGE)
}

export const createConnection = (target: DatabaseTarget, { max = 5, name = 'DATABASE_URL' }: ConnectionOptions = {}) => {
  // Before anything else: no client, and so no logger, may exist for a database that must not be logged.
  const dbLog = process.env.DB_LOG
  assertDbLogAllowed({ dbLog, target, vercel: process.env.VERCEL, vercelEnv: process.env.VERCEL_ENV })
  const logger = isDbLogOn(dbLog)
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
    NEON_PRODUCTION_ENDPOINT: process.env.NEON_PRODUCTION_ENDPOINT,
  }),
))

export const db: Db = connection.db

export const closeConnection = async (target: Connection = connection) => {
  if (target.kind === 'postgres') return target.db.$client.end()
  return target.db.$client.close()
}
