import Link from 'next/link'
import type { ReactNode } from 'react'
import { AdminHeader } from '@/features/admin/components/admin-header'
import { LogoutButton } from '@/features/admin/components/logout-button'

export type AdminShellProps = {
  children: ReactNode
  /** Error groups seen in the last 24 hours (monitoring): the chip of "Lỗi", only when above 0. */
  errorCount?: number
}

// The chip shows two characters at most, so the bar keeps its two rows at 390 px (design-system "Component M6").
const CHIP_CAP = 9

const NAV_LINK =
  'inline-flex min-h-11 min-w-11 items-center justify-center gap-1 px-2 font-medium underline-offset-8 hover:underline'

// Gate 2 decision 9 (M6): the count of groups, not the sum of their occurrences; the full text for a screen reader,
// the capped number for the eye.
const ErrorCountChip = ({ count }: { count: number }) => (
  <>
    <span className="sr-only">{` (${count} lỗi trong 24 giờ qua)`}</span>
    <span
      aria-hidden="true"
      className="inline-flex h-5 min-w-5 items-center justify-center rounded-sm border border-inverse-foreground bg-inverse-foreground px-1 font-mono text-xs font-semibold text-inverse"
    >
      {count > CHIP_CAP ? `${CHIP_CAP}+` : count}
    </span>
  </>
)

// The signed-in admin bar (Gate 2 decision 1, design-system.md "Component M5", M6 adds "Lỗi"): title, "Sản phẩm",
// "Lỗi" with its chip, "Đăng xuất"; then the page. Rendered only by AdminGate, after the session check: nothing of
// the bar reaches a visitor without a session. The page passed in is not protected by this (audit PR #106 H1): it
// checks the session itself. No aria-current: a Server Component does not know the path (same decision as the shop
// header, NS-50).
export const AdminShell = ({ children, errorCount = 0 }: AdminShellProps) => (
  <>
    <AdminHeader layout="shell">
      <nav aria-label="Quản trị" className="-ml-2 flex sm:ml-0">
        <Link href="/admin/products" className={NAV_LINK}>
          Sản phẩm
        </Link>
        <Link href="/admin/errors" className={NAV_LINK}>
          Lỗi
          {errorCount > 0 && <ErrorCountChip count={errorCount} />}
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
