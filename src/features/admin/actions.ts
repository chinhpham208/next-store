'use server'

import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { clientLimitKey, hashClientIp, readClientIp } from '@/features/admin/client-ip'
import { readAdminConfig } from '@/features/admin/config'
import { clearAdminSession, writeAdminSession } from '@/features/admin/cookie'
import { MAX_PASSWORD_LENGTH } from '@/features/admin/limits'
import { isLoginLocked, purgeLoginFailures, recordLoginFailure } from '@/features/admin/login-limit'
import { passwordMatches } from '@/features/admin/password'
import type { LoginError, LoginState } from '@/features/admin/types'

// Each action is a public POST (plan M4 D5): loginAction is the only admin action that needs no session
// (ADR-0018). Its result is a LoginState, never a row; refusals are returned, never thrown, so the form shows them
// next to the field. Nothing here logs the password, the cookie, the IP or its hash: only the fixed lines below.

const RECORD_FAILED_LOG = 'admin: recording a login failure failed'
const LOCK_CHECK_FAILED_LOG = 'admin: the login lock check failed'
const PURGE_FAILED_LOG = 'admin: purging old login failures failed'

const refused = (error: LoginError): LoginState => ({ status: 'error', error })

// A string of 1..MAX_PASSWORD_LENGTH characters, as typed: not trimmed (only the env value is, ADR-0018 "Sửa theo audit PR #104").
// The action is callable with any argument, so anything but FormData is invalid too.
const typedPassword = (formData: unknown): string | undefined => {
  if (!(formData instanceof FormData)) return undefined
  const value = formData.get('password')
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_PASSWORD_LENGTH) return undefined
  return value
}

/**
 * ADR-0018 8A, in this order: configuration, input, lock, password. The lock is checked before the password, so a
 * locked address learns nothing more; a lock check that fails refuses the login (fail-closed). A right password
 * writes the session cookie and redirects, and records nothing.
 */
export async function loginAction(_previous: LoginState, formData: FormData): Promise<LoginState> {
  const config = readAdminConfig()
  // Before the input and before any query: a closed admin area costs nothing.
  if (!config.enabled) return refused('not-configured')
  const password = typedPassword(formData)
  if (password === undefined) return refused('invalid')

  // One clock per request: the lock window, the row's failed_at and the purge agree.
  const now = new Date()
  // Counted per IPv4 address or IPv6 /64 (NS-132), stored as an HMAC only.
  const ipHash = await hashClientIp({ ip: clientLimitKey(readClientIp(await headers())), secret: config.sessionSecret })

  let locked: boolean
  try {
    locked = await isLoginLocked({ ipHash, now })
  } catch {
    console.error(LOCK_CHECK_FAILED_LOG)
    return refused('unavailable')
  }
  if (locked) return refused('locked')

  if (!passwordMatches(password, config.password)) {
    try {
      await recordLoginFailure({ ipHash, now })
    } catch {
      // The answer is the same either way; a failure that went unrecorded is one more guess, the WAF rule
      // (ADR-0015) still counts every request. A timed-out insert may have committed (ADR-0011): no retry.
      console.error(RECORD_FAILED_LOG)
    }
    return refused('wrong-password')
  }

  await writeAdminSession()
  try {
    await purgeLoginFailures(now)
  } catch {
    // The session is already written: a failed purge leaves the old rows to the next one.
    console.error(PURGE_FAILED_LOG)
  }
  redirect('/admin/products')
}

/** Clears the cookie whatever it holds: logging out needs no valid session and no configuration (ADR-0018 6A). */
export async function logoutAction(): Promise<void> {
  await clearAdminSession()
  redirect('/admin/login')
}
