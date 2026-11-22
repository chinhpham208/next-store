import { notFound } from "next/navigation";
import { getPostMeta, POSTS } from "@/features/blog";
import { formatDate } from "@/lib/format-date";
import { OG_CONTENT_TYPE, OG_SIZE, renderOgImage } from "@/lib/og-image";

export const alt = "Ảnh giới thiệu bài viết trên blog next-store";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

// Posts change only with a build, so every image is prerendered. An unknown slug is answered with a 404 by
// src/proxy.ts (M3 Task 13); notFound() here is the safety net.
export function generateStaticParams() {
  return POSTS.map((post) => ({ slug: post.slug }));
}

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const post = getPostMeta(slug);
  if (!post) notFound();
  return renderOgImage({ eyebrow: "Blog", title: post.title, footer: formatDate(post.publishedAt) });
}
