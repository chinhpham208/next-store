import 'server-only'
import { resolveAdminConfig } from '@/features/admin/config-rules'
import type { AdminConfig, AdminEnv } from '@/features/admin/types'

// Named reads, not process.env as a whole: only these two ever matter, and nothing here logs them.
const processEnv = (): AdminEnv => ({
  ADMIN_PASSWORD: process.env.ADMIN_PASSWORD,
  SESSION_SECRET: process.env.SESSION_SECRET,
})

/**
 * The admin configuration, read on each call. Missing ADMIN_PASSWORD or SESSION_SECRET → `missing`; a password under
 * 20 characters, a secret under 32, or both equal → `weak`. Disabled means the admin area is closed (ADR-0018).
 */
export const readAdminConfig = (env: AdminEnv = processEnv()): AdminConfig => resolveAdminConfig(env)
