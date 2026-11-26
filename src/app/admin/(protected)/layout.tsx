import { Suspense } from "react";
import { AdminGate, AdminShellSkeleton } from "@/features/admin";

// The signed-in shell of every protected admin page (US-12, ADR-0018). AdminGate checks the session for the shell
// only: a layout does not keep its page from rendering, so every page here starts with `await requireAdminPage()`
// itself (audit PR #106 H1, src/admin-session-checks.test.ts). Inside <Suspense> so the check reads the request at
// request time; the fallback shows nothing of the admin area.
export default function ProtectedAdminLayout({ children }: LayoutProps<"/admin">) {
  return (
    <Suspense fallback={<AdminShellSkeleton />}>
      <AdminGate>{children}</AdminGate>
    </Suspense>
  );
}
