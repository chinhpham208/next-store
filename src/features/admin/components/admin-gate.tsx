import { unstable_rethrow } from 'next/navigation'
import type { ReactNode } from 'react'
import { AdminShell } from '@/features/admin/components/admin-shell'
import { requireAdminPage } from '@/features/admin/cookie'

export type AdminGateProps = {
  children: ReactNode
  /**
   * The count behind the chip of "Lỗi", given by the layout because `admin` imports no domain. It is called after the
   * session check, and it checks the session itself too (a read of monitoring/admin-queries.ts).
   */
  countErrors?: () => Promise<number>
}

// A read that fails (the database is down) must not take the bar down with it: the page under it shows its own error,
// and a bar that is there lets the admin go to another page. No chip is shown for a count that is not known.
const readErrorCount = async (countErrors: AdminGateProps['countErrors']): Promise<number> => {
  if (countErrors === undefined) return 0
  try {
    return await countErrors()
  } catch (error) {
    // Control flow of Next.js (a redirect, notFound, a postponed render) is not a failed read (as LoginForm).
    unstable_rethrow(error)
    return 0
  }
}

// Keeps the signed-in bar (nav, "Đăng xuất") from a visitor without a session. It does NOT protect the page under
// it: Next.js renders a page alongside its layout, not inside it, so when this redirects the page has already run
// and its content still goes out in the flight payload and the prerendered `.segments/*.rsc` (audit PR #106 H1). The
// second layer behind the proxy (plan M5 D2) is in each page, which starts with `await requireAdminPage()`, and in
// each admin read and action (ADR-0018 "Sửa theo audit PR #106"). requireAdminPage reads the request first, so the
// shell is dynamic whatever the build env (audit PR #105 M1). Inside the layout's <Suspense> a redirect is a meta
// tag, not a 307 (D5): the status comes from the proxy.
export const AdminGate = async ({ children, countErrors }: AdminGateProps) => {
  await requireAdminPage()
  return <AdminShell errorCount={await readErrorCount(countErrors)}>{children}</AdminShell>
}
