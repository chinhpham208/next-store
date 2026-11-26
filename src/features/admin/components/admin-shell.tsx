import Link from 'next/link'
import type { ReactNode } from 'react'
import { AdminHeader } from '@/features/admin/components/admin-header'
import { LogoutButton } from '@/features/admin/components/logout-button'

export type AdminShellProps = { children: ReactNode }

// The signed-in admin bar (Gate 2 decision 1, design-system.md "Component M5"): title, "Sản phẩm", "Đăng xuất"; then
// the page. Rendered only by AdminGate, after the session check: nothing of it reaches a visitor without a session.
// No aria-current: a Server Component does not know the path (same decision as the shop header, NS-50).
export const AdminShell = ({ children }: AdminShellProps) => (
  <>
    <AdminHeader layout="shell">
      <nav aria-label="Quản trị" className="-ml-2 flex sm:ml-0">
        <Link
          href="/admin/products"
          className="inline-flex min-h-11 items-center px-2 font-medium underline-offset-8 hover:underline"
        >
          Sản phẩm
        </Link>
      </nav>
      <LogoutButton />
    </AdminHeader>
    <main className="flex-1">{children}</main>
  </>
)

// The Suspense fallback of (protected)/layout.tsx: the title only, no nav, no button, an empty main. Shows nothing of
// the admin area before the session is checked.
export const AdminShellSkeleton = () => (
  <>
    <AdminHeader layout="shell" />
    <main className="flex-1" />
  </>
)
