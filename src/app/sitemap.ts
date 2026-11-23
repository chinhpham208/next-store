import type { MetadataRoute } from "next";
import { getAllPosts } from "@/features/blog";
import { getProductSitemapEntries } from "@/features/products";
import { absoluteUrl } from "@/lib/site-url";

// ISO dates and YYYY-MM-DD both start with the calendar date, so code-unit order is time order. No clock value
// (new Date()): the sitemap is prerendered and must not change from one build to the next without a data change.
const newest = (dates: readonly (string | undefined)[]): string | undefined =>
  dates.reduce<string | undefined>((latest, date) => (date !== undefined && (latest === undefined || date > latest) ? date : latest), undefined);

// Canonical pages only: no filter, search or page parameters (each is the same catalogue, and would multiply URLs).
// Product slugs are filtered in getProductSitemapEntries and post slugs come from the registry, so every <loc> is a
// URL the proxy lets through.
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const products = await getProductSitemapEntries();
  const posts = getAllPosts();
  const productsModified = newest(products.map((product) => product.updatedAt));
  const blogModified = newest(posts.map((post) => post.publishedAt));

  return [
    { url: absoluteUrl("/"), lastModified: newest([productsModified, blogModified]) },
    { url: absoluteUrl("/products"), lastModified: productsModified },
    { url: absoluteUrl("/blog"), lastModified: blogModified },
    ...products.map((product) => ({ url: absoluteUrl(`/products/${product.slug}`), lastModified: product.updatedAt })),
    ...posts.map((post) => ({ url: absoluteUrl(`/blog/${post.slug}`), lastModified: post.publishedAt })),
  ];
}
