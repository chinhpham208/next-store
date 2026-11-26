// The pure part of error tracking (ADR-0022): turns what onRequestError may keep into a report, and a report into
// the one log line. It imports nothing (not even a type): src/instrumentation.ts imports it statically, so it is in
// the bundle of the edge runtime and of the proxy, where no database may be (dependency-cruiser
// `monitoring-report-pure`, `npm run check:bundle` check 4). Only Web Crypto, a global, is used.
//
// The input has four fields and no more: the request's headers (the admin and cart cookies are in them) and its
// path (it carries the query) have no place in it, so no caller can hand them over by accident.

export const ERROR_ROUTE_TYPES = ['render', 'route', 'action', 'proxy'] as const
export type ErrorRouteType = (typeof ERROR_ROUTE_TYPES)[number]

export type ErrorReport = {
  fingerprint: string
  routeType: ErrorRouteType
  routePath: string
  method: string
  digest: string | null
  errorName: string
  message: string | null
}

export type ErrorReportInput = {
  error: unknown
  method: string
  routeType: string
  routePath: string
}

export const MAX_ROUTE_PATH_LENGTH = 200
const HTTP_METHODS: readonly string[] = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']
const FALLBACK_METHOD = 'OTHER'
const FALLBACK_ROUTE_TYPE: ErrorRouteType = 'render'
const FALLBACK_ERROR_NAME = 'Error'
// The same shapes as the CHECK constraints of error_events (the last line of defence behind this file).
const ERROR_NAME = /^[A-Za-z]{1,40}$/
const DIGEST = /^[A-Za-z0-9_-]{1,64}$/
// The fixed message of dbQuery (ADR-0011): a name written in code and a SQLSTATE / errno, never user input.
const DB_QUERY_MESSAGE = /^database query (failed|timed out): [a-z0-9.-]{1,60}( \([0-9A-Z_]{1,12}\))?$/

const isRouteType = (value: string): value is ErrorRouteType => (ERROR_ROUTE_TYPES as readonly string[]).includes(value)

// Next.js passes the route file's pattern (`/app/products/[slug]`), not the URL. A query or fragment is cut anyway,
// and the cut counts characters, not UTF-16 units: PostgreSQL refuses half a surrogate pair.
const toRoutePath = (routePath: string): string => {
  const [withoutQuery = ''] = routePath.split(/[?#]/, 1)
  return Array.from(withoutQuery).slice(0, MAX_ROUTE_PATH_LENGTH).join('')
}

const errorNameOf = (error: unknown): string =>
  error instanceof Error && ERROR_NAME.test(error.name) ? error.name : FALLBACK_ERROR_NAME

const digestOf = (error: unknown): string | null => {
  if (typeof error !== 'object' || error === null || !('digest' in error)) return null
  return typeof error.digest === 'string' && DIGEST.test(error.digest) ? error.digest : null
}

const messageOf = (error: unknown): string | null =>
  error instanceof Error && DB_QUERY_MESSAGE.test(error.message) ? error.message : null

// `digest` is not in it: Next.js derives it from the message and the stack, so its values are not bounded and a run
// of errors with different messages would fill the table (audit PR #120 M1). The four fields below have a finite
// set of values that the sender of a request does not choose.
const fingerprintOf = async (parts: readonly string[]): Promise<string> => {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(parts.join('|')))
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export const toErrorReport = async ({ error, method, routeType, routePath }: ErrorReportInput): Promise<ErrorReport> => {
  const normalisedType = isRouteType(routeType) ? routeType : FALLBACK_ROUTE_TYPE
  const normalisedPath = toRoutePath(routePath)
  const errorName = errorNameOf(error)
  const message = messageOf(error)
  const upperMethod = method.toUpperCase()
  return {
    fingerprint: await fingerprintOf([normalisedType, normalisedPath, errorName, message ?? '']),
    routeType: normalisedType,
    routePath: normalisedPath,
    method: HTTP_METHODS.includes(upperMethod) ? upperMethod : FALLBACK_METHOD,
    digest: digestOf(error),
    errorName,
    message,
  }
}

/** One line, fixed fields, JSON-escaped: nothing a visitor typed can start a second line. */
export const formatErrorLogLine = ({ routeType, routePath, digest, errorName }: ErrorReport): string =>
  `monitoring: request error ${JSON.stringify({ routeType, routePath, digest, errorName })}`
