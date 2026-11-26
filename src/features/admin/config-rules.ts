import { MIN_SESSION_SECRET_LENGTH } from '@/features/admin/session'
import type { AdminConfig, AdminEnv } from '@/features/admin/types'

// The fail-closed rules of ADR-0018, in one place for config.ts (app, `server-only`) and proxy-api.ts (proxy, which
// cannot import a `server-only` file). No `server-only`, no zod. Never logs, never puts a value in a disabled answer.

export const MIN_ADMIN_PASSWORD_LENGTH = 20
// Length alone lets `abababab…` or `12345678901234567890` through (ADR-0023, decision 10A). Not an entropy measure:
// the safety still rests on the password being generated (`openssl rand -base64 24`), see the README.
export const MIN_PASSWORD_DISTINCT_CHARACTERS = 16

// Trimmed: a value pasted into Vercel with a trailing newline must not become part of the password or the HMAC key.
// Every later use (length, equality, password comparison, signing) sees only the trimmed value.
const present = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

// Distinct code points of the trimmed value (`[...value]` iterates by code point, so an emoji counts once).
const distinctCharacters = (value: string): number => new Set(value).size

export const resolveAdminConfig = (env: AdminEnv): AdminConfig => {
  const password = present(env.ADMIN_PASSWORD)
  const sessionSecret = present(env.SESSION_SECRET)
  if (password === undefined || sessionSecret === undefined) return { enabled: false, reason: 'missing' }
  // Padding does not make a value stronger: these are the lengths of the trimmed values. Length counts UTF-16 units,
  // distinct characters count code points; env values are ASCII, so both agree — do not "fix" one side alone.
  if (password.length < MIN_ADMIN_PASSWORD_LENGTH) return { enabled: false, reason: 'weak' }
  if (distinctCharacters(password) < MIN_PASSWORD_DISTINCT_CHARACTERS) return { enabled: false, reason: 'weak' }
  if (sessionSecret.length < MIN_SESSION_SECRET_LENGTH) return { enabled: false, reason: 'weak' }
  // One value for both would let whoever learns the password sign sessions, and the other way round.
  if (password === sessionSecret) return { enabled: false, reason: 'weak' }
  return { enabled: true, password, sessionSecret }
}
