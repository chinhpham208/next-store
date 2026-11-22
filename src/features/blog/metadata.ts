import type { Metadata } from 'next'
import { getPostMeta } from '@/features/blog/posts'

// title + description only: Next.js derives og:title / og:description from them and keeps the inherited og:image,
// site name and twitter card (M3 K5). Task 12 adds openGraph here together with the segment's own opengraph-image.
export const getPostMetadata = (slug: string): Metadata => {
  const post = getPostMeta(slug)
  if (!post) return { title: 'Không tìm thấy trang' }
  return { title: post.title, description: post.description }
}
