import { Suspense } from "react";
import { AdminGate, AdminShellSkeleton } from "@/features/admin";

// Every signed-in admin page (US-12, ADR-0018): the session is checked again here, behind the proxy (plan M5 D2).
// Inside <Suspense> so the check reads the request at request time; the fallback shows nothing of the admin area.
export default function ProtectedAdminLayout({ children }: LayoutProps<"/admin">) {
  return (
    <Suspense fallback={<AdminShellSkeleton />}>
      <AdminGate>{children}</AdminGate>
    </Suspense>
  );
}
