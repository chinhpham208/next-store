import { connection } from "next/server";
import { Suspense } from "react";
import { AdminGate, AdminShellSkeleton } from "@/features/admin";

// The signed-in shell of every protected admin page (US-12, ADR-0018). AdminGate checks the session for the shell
// only: a layout does not keep its page from rendering, so every page here starts with `await requireAdminPage()`
// itself (audit PR #106 H1, src/admin-session-checks.test.ts). Inside <Suspense> so the check reads the request at
// request time; the fallback shows nothing of the admin area.
//
// ADR-0020: every page here runs under the proxy's nonce CSP ('strict-dynamic'), and Next.js puts the nonce only on
// what it renders for the request (D3). With the <Suspense> below as the first boundary, the route had a prerendered
// shell (◐) whose scripts carry no nonce: the browser refuses them and the edit form never hydrates (audit PR #105 L3,
// e2e/ns-csp.spec.ts). Awaiting `connection` above it leaves no static shell; `instant = false` is what Cache
// Components requires for such a route (else the build stops with "blocking-prerender-dynamic"). It reads nothing.
export const instant = false;

export default async function ProtectedAdminLayout({ children }: LayoutProps<"/admin">) {
  await connection();
  return (
    <Suspense fallback={<AdminShellSkeleton />}>
      <AdminGate>{children}</AdminGate>
    </Suspense>
  );
}
