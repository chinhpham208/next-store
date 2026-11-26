import type { NextRequest } from 'next/server'
import { resolveAdminConfig } from '@/features/admin/config-rules'
import { type AdminCookieName, adminCookieNameFor } from '@/features/admin/cookie-name'
import { verifySession } from '@/features/admin/session'
import { getSiteUrl } from '@/lib/site-url'

// The only entry src/proxy.ts uses for the admin area (dependency-cruiser `proxy-entry-only`, `proxy-narrow-entry`,
// `admin-proxy-api-narrow`). No `server-only` file, no zod, no database: the proxy checks the session optimistically
// from the cookie alone (plan M5 D2); every admin page, read and action checks again (ADR-0018, audit PR #106 H1).

// One cookie name, chosen like the app does (adminCookieName in cookie.ts): from getSiteUrl(), not from
// request.nextUrl.protocol. The site URL is what the cookie was written under; behind a proxy that terminates TLS
// the request can arrive as http while the browser holds __Host-ns_admin. Reading only that name means the proxy
// never lets through a cookie the pages and actions would refuse (audit PR #104 L1).
const siteCookieName = (): AdminCookieName | undefined => {
  try {
    return adminCookieNameFor(getSiteUrl())
  } catch {
    // An invalid SITE_URL: closed, as the app would fail too. Nothing is logged.
    return undefined
  }
}

// `/admin`, anything under it, and the App Router transport forms of `/admin` itself (`/admin.rsc`,
// `/admin.segments/…`), which the matcher also sends here (see SLUG_PATH in src/proxy.ts).
const ADMIN_PATH = /^\/admin(?:$|\/|\.rsc$|\.segments\/)/

// Exactly the login page, with its `.rsc` and segment-prefetch forms (`next start` strips only the final `.rsc`,
// Vercel nothing; audit PR #26 M1). Segment names are restricted to plain characters, so no `..` or encoded form can
// turn a login path into another page.
const SEGMENT = '[A-Za-z0-9_$-]+'
const ADMIN_LOGIN_PATH = new RegExp(`^/admin/login(?:\\.segments/(?:${SEGMENT}/)*${SEGMENT}\\.segment)?(?:\\.rsc)?$`)

export const isAdminPath = (pathname: string): boolean => ADMIN_PATH.test(pathname)

export const isAdminLoginPath = (pathname: string): boolean => ADMIN_LOGIN_PATH.test(pathname)

// The pathname as a router that decodes percent escapes or ignores case could read it (audit PR #104 L4). Each
// escape is decoded on its own, so one malformed escape does not hide the others; `%2F` becomes `/` too, so
// `/admin%2Fproducts` reads as `/admin/products`. Never used to let a request through: only to guard more.
const PERCENT_ESCAPE = /%[0-9A-Fa-f]{2}/g
const decodeEscape = (escape: string): string => String.fromCharCode(Number.parseInt(escape.slice(1), 16))
const looseSpelling = (pathname: string): string => pathname.replace(PERCENT_ESCAPE, decodeEscape).toLowerCase()

/**
 * True for every path the proxy must guard as admin: the canonical forms of isAdminPath, and any spelling that
 * reads as one once percent escapes are decoded and case is folded (`/%61dmin/…`, `/admin%2F…`, `/Admin/…`).
 * isAdminLoginPath stays canonical only, so a loose spelling of the login page is guarded like any admin page.
 */
export const isGuardedAdminPath = (pathname: string): boolean =>
  isAdminPath(pathname) || isAdminPath(looseSpelling(pathname))

/**
 * True when the admin cookie of the site's scheme holds a valid session. Reads the env directly (config.ts is
 * `server-only`) with the same fail-closed rules: a missing or weak value → false, never a check against an empty
 * secret.
 */
export const hasValidAdminCookie = async (request: NextRequest): Promise<boolean> => {
  const config = resolveAdminConfig({
    ADMIN_PASSWORD: process.env.ADMIN_PASSWORD,
    SESSION_SECRET: process.env.SESSION_SECRET,
  })
  if (!config.enabled) return false
  const name = siteCookieName()
  if (name === undefined) return false
  const token = request.cookies.get(name)?.value
  return verifySession({ token, secret: config.sessionSecret, now: new Date() })
}
