import 'server-only'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { readAdminConfig } from '@/features/admin/config'
import { type AdminCookieName, adminCookieNameFor } from '@/features/admin/cookie-name'
import { ADMIN_SESSION_TTL_SECONDS, signSession, verifySession } from '@/features/admin/session'
import { getSiteUrl } from '@/lib/site-url'

// The only file in the app that reads or writes the admin cookie (ADR-0018 6A, conventions.md §1); the proxy reads
// it through proxy-api.ts. Never logs the cookie or a config value.

const LOGIN_PATH = '/admin/login'

type AdminCookieOptions = { httpOnly: true; sameSite: 'strict'; path: '/'; secure: boolean; maxAge: number }

const isSecureSite = (): boolean => getSiteUrl().protocol === 'https:'

// Same rule as the proxy (cookie-name.ts): __Host-ns_admin on an https site, ns_admin on http.
export const adminCookieName = (): AdminCookieName => adminCookieNameFor(getSiteUrl())

// Strict: a request started from another site never carries it (CSRF, ADR-0018 7A). maxAge equals the absolute TTL
// inside the token; the token, not the browser, decides validity.
export const adminCookieOptions = (): AdminCookieOptions => ({
  httpOnly: true,
  sameSite: 'strict',
  path: '/',
  secure: isSecureSite(),
  maxAge: ADMIN_SESSION_TTL_SECONDS,
})

/** A valid session cookie under the current scheme's name. A disabled config closes the area: always false. */
export const hasAdminSession = async (): Promise<boolean> => {
  const config = readAdminConfig()
  if (!config.enabled) return false
  const token = (await cookies()).get(adminCookieName())?.value
  return verifySession({ token, secret: config.sessionSecret, now: new Date() })
}

/** Only in a Server Action, after the password matched. A disabled config throws: never a session without a secret. */
export const writeAdminSession = async (): Promise<void> => {
  const config = readAdminConfig()
  if (!config.enabled) throw new Error('admin: not configured')
  const token = await signSession({ secret: config.sessionSecret, now: new Date() })
  ;(await cookies()).set(adminCookieName(), token, adminCookieOptions())
}

/** Only in a Server Action. Needs no valid session and no config: logging out always works. */
export const clearAdminSession = async (): Promise<void> => {
  // Same attributes as when it was set, or the browser keeps the __Host- cookie. No maxAge: the cookie library would
  // turn it into an expiry in the future and undo the deletion.
  const { httpOnly, sameSite, path, secure } = adminCookieOptions()
  ;(await cookies()).delete({ name: adminCookieName(), httpOnly, sameSite, path, secure })
}

/** For admin pages: no session → /admin/login. A second layer behind the proxy (plan M5 D2, D5). */
export const requireAdminPage = async (): Promise<void> => {
  if (!(await hasAdminSession())) redirect(LOGIN_PATH)
}
