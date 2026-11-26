// The admin UI entry (audit PR #124 M2): only src/app/admin/** imports it (dependency-cruiser
// `admin-ui-entry-only-from-admin`). index.ts is the entry of shop-reachable code (`checkout` reads the session
// through it); a client component re-exported there ships its chunk, and the id of the action it calls, with every
// shop page (Turbopack follows the barrel's client references, see products/admin.ts). check:bundle checks the build.
export { AdminGate } from '@/features/admin/components/admin-gate'
export { AdminHeader } from '@/features/admin/components/admin-header'
export { AdminShell, AdminShellSkeleton } from '@/features/admin/components/admin-shell'
export { LoginForm } from '@/features/admin/components/login-form'
export { LogoutButton } from '@/features/admin/components/logout-button'
