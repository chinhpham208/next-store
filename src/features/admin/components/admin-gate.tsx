import type { ReactNode } from 'react'
import { AdminShell } from '@/features/admin/components/admin-shell'
import { requireAdminPage } from '@/features/admin/cookie'

export type AdminGateProps = { children: ReactNode }

// Keeps the signed-in bar (nav, "Đăng xuất") from a visitor without a session. It does NOT protect the page under
// it: Next.js renders a page alongside its layout, not inside it, so when this redirects the page has already run
// and its content still goes out in the flight payload and the prerendered `.segments/*.rsc` (audit PR #106 H1). The
// second layer behind the proxy (plan M5 D2) is in each page, which starts with `await requireAdminPage()`, and in
// each admin read and action (ADR-0018 "Sửa theo audit PR #106"). requireAdminPage reads the request first, so the
// shell is dynamic whatever the build env (audit PR #105 M1). Inside the layout's <Suspense> a redirect is a meta
// tag, not a 307 (D5): the status comes from the proxy.
export const AdminGate = async ({ children }: AdminGateProps) => {
  await requireAdminPage()
  return <AdminShell>{children}</AdminShell>
}
