import type { ReactNode } from 'react'
import { AdminShell } from '@/features/admin/components/admin-shell'
import { requireAdminPage } from '@/features/admin/cookie'

export type AdminGateProps = { children: ReactNode }

// The second layer behind the proxy (plan M5 D2, ADR-0018): checks the session again before any admin page renders.
// requireAdminPage reads the request first (cookies(), connection()), so every page under it is dynamic whatever the
// build env (audit PR #105 M1). Inside the layout's <Suspense> a redirect is a meta tag, not a 307 (D5): the status
// comes from the proxy; this keeps the page itself from rendering when the proxy is bypassed or wrong.
export const AdminGate = async ({ children }: AdminGateProps) => {
  await requireAdminPage()
  return <AdminShell>{children}</AdminShell>
}
