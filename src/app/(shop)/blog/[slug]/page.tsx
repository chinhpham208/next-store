import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createElement } from "react";
import { getPostContent, getPostMeta, getPostMetadata, isPostSlug, POSTS, PostView } from "@/features/blog";

// Every post is prerendered at build time. dynamicParams is not available under Cache Components, so an unknown slug
// still renders here at request time, and notFound() then answers 200 on the first hit (K3). This check is only the
// safety net: the real 404 comes from src/proxy.ts matching isPostSlug (M3 Task 13, ADR-0012).
export function generateStaticParams() {
  return POSTS.map((post) => ({ slug: post.slug }));
}

export async function generateMetadata({ params }: PageProps<"/blog/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  return getPostMetadata(slug);
}

export default async function PostPage({ params }: PageProps<"/blog/[slug]">) {
  const { slug } = await params;
  if (!isPostSlug(slug)) notFound();
  const post = getPostMeta(slug);
  if (!post) notFound();

  // createElement, not <Content />: the component is a static import picked from a fixed map (content.ts), not one
  // created during render, but react-hooks/static-components cannot tell a lookup from a definition.
  return <PostView post={post}>{createElement(getPostContent(slug))}</PostView>;
}
