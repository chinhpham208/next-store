import type { Metadata } from "next";
import { Suspense } from "react";
import { Container } from "@/components/ui/container";
import { requireAdminPage } from "@/features/admin";
import { AdminProductTable, AdminProductTableSkeleton } from "@/features/products";

export const metadata: Metadata = { title: "Sản phẩm" };

// US-13 (plan M5 Task 10). The page checks the session itself, first: the (protected) layout does not keep it from
// rendering (audit PR #106 H1, src/admin-session-checks.test.ts). The rows are read inside <Suspense>, never cached.
export default async function AdminProductsPage() {
  await requireAdminPage();
  return (
    <Container className="flex flex-col gap-6 pt-10 pb-16 md:gap-8 md:pt-16 md:pb-24">
      <h1 id="admin-products-heading" className="text-4xl font-bold tracking-tight md:text-5xl">
        Sản phẩm
      </h1>
      <Suspense fallback={<AdminProductTableSkeleton />}>
        <AdminProductTable />
      </Suspense>
    </Container>
  );
}
