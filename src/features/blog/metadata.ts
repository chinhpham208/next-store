import type { Metadata } from 'next'
import { getPostMeta } from '@/features/blog/posts'

// The one openGraph below the root layout (M3 K5): allowed because /blog/[slug] has its own opengraph-image, so the
// page keeps an og:image. A child openGraph replaces the root one instead of merging, hence siteName and locale again.
export const getPostMetadata = (slug: string): Metadata => {
  const post = getPostMeta(slug)
  if (!post) return { title: 'Không tìm thấy trang' }
  return {
    title: post.title,
    description: post.description,
    openGraph: {
      type: 'article',
      title: post.title,
      description: post.description,
      publishedTime: post.publishedAt,
      siteName: 'next-store',
      locale: 'vi_VN',
      url: `/blog/${post.slug}`,
    },
  }
}
