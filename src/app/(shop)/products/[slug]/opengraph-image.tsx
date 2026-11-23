import { notFound } from "next/navigation";
import { getAllProductSlugs, getProductBySlug } from "@/features/products";
import { formatPrice } from "@/lib/format-price";
import { isOgIllustration, OG_CONTENT_TYPE, OG_SIZE, renderOgImage } from "@/lib/og-image";

// Fixed, not per product: a per-image alt needs the image-metadata generator, which stops the prerender (M3 K9).
export const alt = "Ảnh giới thiệu sản phẩm của next-store";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

// Every seeded product's image is prerendered at build time, like the page. An unknown slug is answered with a 404 by
// src/proxy.ts (M3 Task 13); notFound() here is the safety net.
export async function generateStaticParams() {
  const slugs = await getAllProductSlugs();
  return slugs.map((slug) => ({ slug }));
}

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  // Cached under product:<slug>, so the image is invalidated with the page when the product changes (ADR-0003).
  const product = await getProductBySlug(slug);
  if (!product) notFound();
  return renderOgImage({
    eyebrow: product.categoryName,
    title: product.name,
    footer: formatPrice(product.price),
    illustration: isOgIllustration(product.categorySlug) ? product.categorySlug : undefined,
  });
}
