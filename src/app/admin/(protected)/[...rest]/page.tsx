import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireAdminPage } from "@/features/admin";

export const metadata: Metadata = { title: "Không tìm thấy trang" };

// NS-133 (audit M5 L1). With a session, an /admin URL no route matched fell through to the static /_not-found (○):
// its scripts carry no nonce, so under the proxy's nonce CSP (ADR-0020) the browser refused every one and the page
// never hydrated. This catch-all answers those URLs instead. It sits under the (protected) layout, which awaits
// `connection` first, so it has no static shell and Next.js puts the nonce on every script (D3); the more specific
// routes (/admin/login, /admin/products…) still win. It checks the session first like every page here (audit PR #106
// H1, src/admin-session-checks.test.ts); without one the proxy has already answered 307.
//
// The status is 200, not 404: notFound() runs after the shell is sent, as on /admin/products/<unknown slug> (audit
// M5 L2, accepted). Only a signed-in admin sees it, and the page is noindex.
export default async function AdminUnknownPage() {
  await requireAdminPage();
  notFound();
}
