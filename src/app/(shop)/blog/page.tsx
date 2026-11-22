import type { Metadata } from "next";
import { BlogIndex, getAllPosts } from "@/features/blog";

// title + description only: an openGraph here would drop the inherited og:image, site name and twitter card (M3 K5).
export const metadata: Metadata = {
  title: "Blog",
  description: "Bài viết của next-store về đồ dùng và chuyện nghề của dân code.",
};

// Not async and no <Suspense>: the post list is a static registry, so the whole page prerenders at build time.
export default function BlogPage() {
  return <BlogIndex posts={getAllPosts()} />;
}
