import { MIN_SESSION_SECRET_LENGTH } from '@/features/admin/session'
import type { AdminConfig, AdminEnv } from '@/features/admin/types'

// The fail-closed rules of ADR-0018, in one place for config.ts (app, `server-only`) and proxy-api.ts (proxy, which
// cannot import a `server-only` file). No `server-only`, no zod. Never logs, never puts a value in a disabled answer.

export const MIN_ADMIN_PASSWORD_LENGTH = 20

const present = (value: string | undefined): string | undefined => (value?.trim() ? value : undefined)

export const resolveAdminConfig = (env: AdminEnv): AdminConfig => {
  const password = present(env.ADMIN_PASSWORD)
  const sessionSecret = present(env.SESSION_SECRET)
  if (password === undefined || sessionSecret === undefined) return { enabled: false, reason: 'missing' }
  // Lengths without surrounding whitespace: padding does not make a value stronger. The values themselves are used
  // as given (trimming would change what the owner set).
  if (password.trim().length < MIN_ADMIN_PASSWORD_LENGTH) return { enabled: false, reason: 'weak' }
  if (sessionSecret.trim().length < MIN_SESSION_SECRET_LENGTH) return { enabled: false, reason: 'weak' }
  // One value for both would let whoever learns the password sign sessions, and the other way round.
  if (password === sessionSecret) return { enabled: false, reason: 'weak' }
  return { enabled: true, password, sessionSecret }
}
