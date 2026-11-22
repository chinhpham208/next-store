import type { Metadata } from "next";
import { Suspense } from "react";
import { Container } from "@/components/ui/container";
import { ProductCatalog, ProductCatalogSkeleton } from "@/features/products";

export const metadata: Metadata = {
  title: "Sản phẩm",
  description: "Áo thun, cốc, sticker và sách cho dân code: lọc theo danh mục, sắp xếp theo giá, tìm theo tên.",
};

// Not async, and searchParams is only passed down: the h1 and the layout are the prerendered shell, and the
// request-time part (filters, results) streams in from behind <Suspense> with the skeleton as fallback. No
// loading.tsx (owner decision 7): the boundary sits right where the data is read.
export default function ProductsPage({ searchParams }: PageProps<"/products">) {
  return (
    <Container className="flex flex-col gap-6 pt-10 pb-16 md:gap-8 md:pt-16 md:pb-24">
      <h1 className="text-4xl font-bold tracking-tight md:text-5xl">Sản phẩm</h1>
      <Suspense fallback={<ProductCatalogSkeleton />}>
        <ProductCatalog searchParams={searchParams} />
      </Suspense>
    </Container>
  );
}
