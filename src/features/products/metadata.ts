import type { Metadata } from 'next'
import { getProductBySlug } from '@/features/products/queries'

// Same cached read as the detail section (product:<slug>), so metadata adds no query, and a malformed slug never
// reaches the database or the cache.
export const getProductMetadata = async (slug: string): Promise<Metadata> => {
  const product = await getProductBySlug(slug)
  if (!product) return { title: 'Không tìm thấy trang' }
  return { title: product.name, description: product.description }
}
