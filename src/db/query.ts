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
// A SQLSTATE (42703, 08006) or a Node errno (ECONNREFUSED). Neither can hold a host, a path or query text;
// anything else the driver sets as `code` is dropped rather than printed.
const SQLSTATE = /^[0-9A-Z]{5}$/
const ERRNO = /^E[A-Z0-9_]{2,30}$/

export const resolveQueryTimeout = (raw: string | undefined): number => {
  if (raw === undefined || !TIMEOUT_DIGITS.test(raw)) return DEFAULT_TIMEOUT_MS
  const value = Number(raw)
  return value >= MIN_TIMEOUT_MS && value <= MAX_TIMEOUT_MS ? value : DEFAULT_TIMEOUT_MS
}

const safeCode = (candidate: unknown): string | undefined => {
  if (!(candidate instanceof Error) || !('code' in candidate)) return undefined
  const { code } = candidate
  return typeof code === 'string' && (SQLSTATE.test(code) || ERRNO.test(code)) ? code : undefined
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
 * The only way code outside src/db reaches the database. The driver query is not cancelled on timeout: the
 * connection is closed by postgres-js itself (connect_timeout / idle_timeout); the page just stops waiting.
 */
export const dbQuery = async <T>({ name, run, timeoutMs }: DbQueryInput<T>): Promise<T> => {
  const limit = timeoutMs ?? resolveQueryTimeout(process.env.DB_QUERY_TIMEOUT_MS)
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
