// The narrow entry: the session reads and the types, no component. Shop-reachable code (`checkout`, `products`)
// imports this one; the admin UI is in ui.ts, which only src/app/admin/** imports (audit PR #124 M2).
export { hasAdminSession, redirectSignedInAdmin, requireAdminPage } from '@/features/admin/cookie'
export type { AdminConfig, AdminConfigDisabledReason, LoginError, LoginState } from '@/features/admin/types'
