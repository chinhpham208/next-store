import 'server-only'
import { asc, desc, eq, sql } from 'drizzle-orm'
import { cacheLife, cacheTag } from 'next/cache'
import { categories, db, products } from '@/db'
import type { ProductSummary } from '@/features/products/types'

const FEATURED_LIMIT = 8

export const getFeaturedProducts = async (limit: number = FEATURED_LIMIT): Promise<ProductSummary[]> => {
  'use cache'
  // Tag 'products' is invalidated by admin edits (M5). Stock changes from the payment webhook invalidate only
  // product:<slug> (ADR-0003), so listings may show inStock up to the cache lifetime after a purchase.
  // 'hours' is the cache lifetime and the safety net if an invalidation is ever missed.
  cacheTag('products')
  cacheLife('hours')

  // Select only summary fields: the value returned from a 'use cache' function must be serializable.
  return db
    .select({
      slug: products.slug,
      name: products.name,
      price: products.price,
      image: products.image,
      categoryName: categories.name,
      // Expose only in/out of stock; the exact count is not part of the summary contract.
      inStock: sql`${products.stock} > 0`.mapWith(Boolean),
    })
    .from(products)
    .innerJoin(categories, eq(products.categoryId, categories.id))
    .where(eq(products.featured, true))
    // Seed inserts every row in one transaction (same updated_at); id breaks the tie so order is stable.
    .orderBy(desc(products.updatedAt), asc(products.id))
    .limit(limit)
}
