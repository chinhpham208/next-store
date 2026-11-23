import type { Metadata } from "next";
import { Suspense } from "react";
import { AddToCartForm } from "@/features/cart";
import {
  getAllProductSlugs,
  getProductMetadata,
  ProductDetailSection,
  ProductDetailSkeleton,
  type ProductPurchase,
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

// The stock here is the cached one (cacheLife hours): it only disables the button of a sold-out product. The action
// checks the real stock in its transaction (ADR-0014 5A).
const renderPurchase = (product: ProductPurchase) => <AddToCartForm slug={product.slug} stock={product.stock} />;

// Not async: the data read sits inside <Suspense> so the shell (header, footer) is static and a slow or dead
// database shows the skeleton, then the error page, instead of holding the response open (K8).
export default function ProductPage({ params }: PageProps<"/products/[slug]">) {
  return (
    <Suspense fallback={<ProductDetailSkeleton />}>
      <ProductDetailSection params={params} renderPurchase={renderPurchase} />
    </Suspense>
  );
}
