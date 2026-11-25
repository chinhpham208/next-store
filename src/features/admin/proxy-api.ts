import type { NextRequest } from 'next/server'
import { resolveAdminConfig } from '@/features/admin/config-rules'
import { verifySession } from '@/features/admin/session'

// The only entry src/proxy.ts uses for the admin area (dependency-cruiser `proxy-entry-only`, `proxy-narrow-entry`,
// `admin-proxy-api-narrow`). No `server-only` file, no zod, no database: the proxy checks the session optimistically
// from the cookie alone (plan M5 D2); the layout and every admin action check again (ADR-0018).

// Both names: the proxy does not know the scheme the cookie was written under (next start: http, Vercel: https).
// Either one must carry a token signed with this deployment's secret.
const ADMIN_COOKIE_NAMES = ['__Host-ns_admin', 'ns_admin'] as const

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

/**
 * True when either admin cookie holds a valid session. Reads the env directly (config.ts is `server-only`) with the
 * same fail-closed rules: a missing or weak value → false for every cookie, never a check against an empty secret.
 */
export const hasValidAdminCookie = async (request: NextRequest): Promise<boolean> => {
  const config = resolveAdminConfig({
    ADMIN_PASSWORD: process.env.ADMIN_PASSWORD,
    SESSION_SECRET: process.env.SESSION_SECRET,
  })
  if (!config.enabled) return false
  const now = new Date()
  for (const name of ADMIN_COOKIE_NAMES) {
    const token = request.cookies.get(name)?.value
    if (await verifySession({ token, secret: config.sessionSecret, now })) return true
  }
  return false
}
