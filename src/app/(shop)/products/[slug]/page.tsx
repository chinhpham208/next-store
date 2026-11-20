import type { Metadata } from "next";
import { Suspense } from "react";
import {
  getAllProductSlugs,
  getProductMetadata,
  ProductDetailSection,
  ProductDetailSkeleton,
} from "@/features/products";

// Every seeded product is prerendered at build time. dynamicParams is not available under Cache Components (K4),
// so an unknown slug still renders here at request time; src/proxy.ts (M2 Task 12) answers it with a real 404
// before it reaches this page.
export async function generateStaticParams() {
  const slugs = await getAllProductSlugs();
  return slugs.map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: PageProps<"/products/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  return getProductMetadata(slug);
}

// Not async: the data read sits inside <Suspense> so the shell (header, footer) is static and a slow or dead
// database shows the skeleton, then the error page, instead of holding the response open (K8).
export default function ProductPage({ params }: PageProps<"/products/[slug]">) {
  return (
    <Suspense fallback={<ProductDetailSkeleton />}>
      <ProductDetailSection params={params} />
    </Suspense>
  );
}
