import 'server-only'
import { eq } from 'drizzle-orm'
import { db, products } from '@/db'
import { isProductSlug } from '@/features/products/schema'

// Slugs already seen to exist in this process. Only positive results are remembered: real slugs are a finite set,
// so the Set stays bounded by the catalogue. Remembering misses would let anyone fill memory with random slugs, and
// a product created later (M5 admin) would keep answering 404 until the process restarts.
// A product deleted after it was seen stays "known" here; the detail page still calls notFound() for it.
const knownProductSlugs = new Set<string>()

// Lookups still waiting for the database, so a burst of requests for one slug costs one query (audit PR #20 L3).
// An entry lives only until its query settles, so the Map is bounded by concurrent lookups, never by history.
const pendingLookups = new Map<string, Promise<boolean>>()

const queryProductSlug = async (slug: string) => {
  const rows = await db.select({ id: products.id }).from(products).where(eq(products.slug, slug)).limit(1)
  if (rows.length === 0) return false
  knownProductSlugs.add(slug)
  return true
}

/**
 * Whether a product with this slug exists. Used by src/proxy.ts before render, so it is deliberately not
 * 'use cache' (cacheTag throws outside a cache scope — K6). A database error is thrown to the caller, which must
 * fail open (K8). The lookup hits the unique index on products.slug.
 */
export const isKnownProductSlug = async (slug: string): Promise<boolean> => {
  if (!isProductSlug(slug)) return false
  if (knownProductSlugs.has(slug)) return true

  const pending = pendingLookups.get(slug)
  if (pending) return pending
  const lookup = queryProductSlug(slug).finally(() => pendingLookups.delete(slug))
  pendingLookups.set(slug, lookup)
  return lookup
}

/** Test-only: forget every remembered slug. Not exported from index.ts. */
export const resetKnownProductSlugs = () => {
  knownProductSlugs.clear()
  pendingLookups.clear()
}
