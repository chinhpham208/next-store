import 'server-only'
import { db, type Db } from '@/db/client'

/** `<domain>.<operation>`: a constant in code, never built from user input — it is printed as is. */
export type DbQueryName = `${string}.${string}`

type DbQueryInput<T> = {
  name: DbQueryName
  run: (client: Db) => PromiseLike<T>
  timeoutMs?: number
}

// Owner decision 10 (plan M3): a waking Neon compute usually answers within 1–2 s, while the client waits up to
// 10 s to connect (connect_timeout), so a page gives up well before that.
const DEFAULT_TIMEOUT_MS = 5000
const MIN_TIMEOUT_MS = 100
const MAX_TIMEOUT_MS = 10_000
// Digits only: Number() would also accept '1e3', '0x3e8', ' 1000' and '1000.5'.
const TIMEOUT_DIGITS = /^[0-9]+$/

const TIMEOUT_CODE = 'DB_QUERY_TIMEOUT'
// A SQLSTATE (42703, 08006), a Node errno (ECONNREFUSED) or a postgres-js constant (below). None can hold a host,
// a path or query text; anything else the driver sets as `code` is dropped rather than printed.
const SQLSTATE = /^[0-9A-Z]{5}$/
const ERRNO = /^E[A-Z0-9_]{2,30}$/
// postgres-js 4.1.1's own codes (src/errors.js, pool.js, connection.js, index.js) for connection, timeout and
// authentication failures — exactly when the on-call reader needs the reason most (audit PR #38 L1). Fixed
// constants, compared exactly; the message and the address / port next to them are still dropped.
const DRIVER_CODES: ReadonlySet<string> = new Set([
  'CONNECT_TIMEOUT',
  'CONNECTION_CLOSED',
  'CONNECTION_DESTROYED',
  'CONNECTION_ENDED',
  'QUEUE_TIMEOUT',
  'QUERY_TIMEOUT',
  'CANCEL_UNANSWERED',
  'TLS_HANDSHAKE_FAILED',
  'AUTHENTICATION_INCOMPLETE',
  'AUTH_TYPE_NOT_IMPLEMENTED',
  'SASL_MECHANISM_NOT_SUPPORTED',
  'SASL_NONCE_MISMATCH',
  'SASL_SIGNATURE_MISMATCH',
  'CHANNEL_BINDING_REQUIRED',
  'MESSAGE_NOT_SUPPORTED',
])

const parseTimeout = (raw: string | undefined): number | undefined => {
  if (raw === undefined || !TIMEOUT_DIGITS.test(raw)) return undefined
  const value = Number(raw)
  return value >= MIN_TIMEOUT_MS && value <= MAX_TIMEOUT_MS ? value : undefined
}

export const resolveQueryTimeout = (raw: string | undefined): number => parseTimeout(raw) ?? DEFAULT_TIMEOUT_MS

// Fixed text, never the value: a mistyped variable is visible in the log instead of silently becoming 5000.
const INVALID_TIMEOUT_WARNING =
  `DB_QUERY_TIMEOUT_MS is ignored: expected a whole number of milliseconds from ${MIN_TIMEOUT_MS} to ` +
  `${MAX_TIMEOUT_MS}; using ${DEFAULT_TIMEOUT_MS}.`

/** Unset or empty is the documented default and stays silent. Called once when this module loads. */
export const warnIfInvalidQueryTimeout = (raw: string | undefined, warn: (message: string) => void = console.warn) => {
  if (raw === undefined || raw === '' || parseTimeout(raw) !== undefined) return
  warn(INVALID_TIMEOUT_WARNING)
}

warnIfInvalidQueryTimeout(process.env.DB_QUERY_TIMEOUT_MS)

// A caller-supplied limit gets the same bounds as the variable: NaN would fire at once, a huge value would
// outlast connect_timeout (audit PR #38 L3).
const clampTimeout = (timeoutMs: number): number =>
  Number.isFinite(timeoutMs) ? Math.min(Math.max(timeoutMs, MIN_TIMEOUT_MS), MAX_TIMEOUT_MS) : DEFAULT_TIMEOUT_MS

const safeCode = (candidate: unknown): string | undefined => {
  if (!(candidate instanceof Error) || !('code' in candidate)) return undefined
  const { code } = candidate
  if (typeof code !== 'string') return undefined
  return SQLSTATE.test(code) || ERRNO.test(code) || DRIVER_CODES.has(code) ? code : undefined
}

// Drizzle puts the driver error in `cause`, so the precise reason is read there first, then from the error itself.
const codeOf = (error: unknown): string | undefined =>
  safeCode(error instanceof Error ? error.cause : undefined) ?? safeCode(error)

// Drizzle wraps driver errors as "Failed query: <sql> params: <values>" with `query`, `params` and `cause`, the
// postgres-js cause names host:port, and Next prints the whole object. So the error is replaced, never wrapped:
// a new Error with fixed text and the code only — no cause, params, query or original message (ADR-0011).
const queryFailed = (name: DbQueryName, error: unknown): Error => {
  const code = codeOf(error)
  if (code === undefined) return new Error(`database query failed: ${name}`)
  return Object.assign(new Error(`database query failed: ${name} (${code})`), { code })
}

const queryTimedOut = (name: DbQueryName): Error =>
  Object.assign(new Error(`database query timed out: ${name}`), { code: TIMEOUT_CODE })

const TIMED_OUT = Symbol('timed out')

/**
 * The only way code outside src/db reaches the database.
 *
 * A timeout abandons the query, it does not cancel it, and the connection is NOT closed (audit PR #38 M1):
 * connect_timeout only covers connecting and idle_timeout only an idle connection, so a connection waiting on an
 * answer keeps its pool slot until the query finishes or the socket dies, and further queries queue behind it.
 * A hang on the server side is bounded by statement_timeout of the app role (NS-36, M3 Task 4–5); a network that
 * drops packets on open connections needs the client to be recycled, tracked in a follow-up ticket (ADR-0011).
 */
export const dbQuery = async <T>({ name, run, timeoutMs }: DbQueryInput<T>): Promise<T> => {
  const limit = timeoutMs === undefined ? resolveQueryTimeout(process.env.DB_QUERY_TIMEOUT_MS) : clampTimeout(timeoutMs)
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<typeof TIMED_OUT>((resolve) => {
    timer = setTimeout(() => resolve(TIMED_OUT), limit)
    // A pending limit must never keep a CLI script or a test worker alive.
    timer.unref?.()
  })
  // The executor turns a synchronous throw of `run` into a rejection; resolve() also runs a Drizzle builder's then.
  const query = new Promise<T>((resolve) => resolve(run(db)))
  let result: T | typeof TIMED_OUT
  try {
    // race() keeps a handler on `query`, so a rejection that arrives after the timeout is not unhandled.
    result = await Promise.race([query, timeout])
  } catch (error) {
    throw queryFailed(name, error)
  } finally {
    clearTimeout(timer)
  }
  if (result === TIMED_OUT) throw queryTimedOut(name)
  return result
}
