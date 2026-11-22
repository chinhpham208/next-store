import type { Metadata } from 'next'
import { getProductBySlug } from '@/features/products/queries'

// Same cached read as the detail section (product:<slug>), so metadata adds no query, and a malformed slug never
// reaches the database or the cache. title + description only: og:title / og:description follow, and og:image,
// og:site_name and the twitter card stay inherited from the root (M3 K5).
export const getProductMetadata = async (slug: string): Promise<Metadata> => {
  const product = await getProductBySlug(slug)
  // The proxy answers unknown slugs with a 404 first; noindex covers a fail-open (ADR-0009) that renders this.
  if (!product) return { title: 'Không tìm thấy trang', robots: { index: false } }
  return { title: product.name, description: product.description }
}
