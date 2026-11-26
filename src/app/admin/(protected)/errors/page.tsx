import type { Metadata } from "next";
import { Suspense } from "react";
import { Container } from "@/components/ui/container";
import { requireAdminPage } from "@/features/admin";
import { ErrorEventsTable, ErrorEventsTableSkeleton } from "@/features/monitoring/admin";

export const metadata: Metadata = { title: "Lỗi" };

// ADR-0022: the groups of server errors, newest first (plan M6 Task 12). The page checks the session itself, first:
// the (protected) layout does not keep it from rendering (audit PR #106 H1, src/admin-session-checks.test.ts). The
// rows are read inside <Suspense>, never cached.
export default async function AdminErrorsPage() {
  await requireAdminPage();
  return (
    <Container className="flex flex-col gap-6 pt-10 pb-16 md:gap-8 md:pt-16 md:pb-24">
      <h1 id="admin-errors-heading" className="text-4xl font-bold tracking-tight md:text-5xl">
        Lỗi
      </h1>
      <Suspense fallback={<ErrorEventsTableSkeleton />}>
        <ErrorEventsTable />
      </Suspense>
    </Container>
  );
}
