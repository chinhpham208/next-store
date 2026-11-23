import { cacheLife, cacheTag } from 'next/cache'
import { eq } from 'drizzle-orm'
import { beforeAll, expect, it, vi } from 'vitest'
import { products } from '@/db'
import { db } from '@/db/client'
import { runMigrations } from '@/db/migrate'
import { seed } from '@/db/seed'
import { PRODUCT_SEEDS } from '@/db/seed-data'
import { getFeaturedProducts, getProductSitemapEntries } from '@/features/products'

// cacheTag() throws outside a cacheComponents build (K7); Vitest also ignores 'use cache', so
// these tests cover the query itself, and the directive's effect is checked by the build (Task 9).
vi.mock('next/cache', () => ({ cacheTag: vi.fn(), cacheLife: vi.fn() }))

beforeAll(async () => {
  await runMigrations()
})

it('returns an empty array when there are no featured products', async () => {
  expect(await getFeaturedProducts()).toEqual([])
})
it('returns the 6 featured products with category name and stock flag', async () => {
  await seed()
  const items = await getFeaturedProducts()
  expect(items).toHaveLength(6)
  expect(Object.keys(items[0] ?? {}).sort()).toEqual(['categoryName', 'image', 'inStock', 'name', 'price', 'slug'])
  expect(items.filter((item) => !item.inStock)).toHaveLength(1)
  expect(['Áo thun', 'Cốc', 'Sticker', 'Sách']).toContain(items[0]?.categoryName)
})
it('returns the same order on every call', async () => {
  expect(await getFeaturedProducts()).toEqual(await getFeaturedProducts())
})
it('respects the limit', async () => {
  expect(await getFeaturedProducts(3)).toHaveLength(3)
})
it('tags the cache entry with products and an hours lifetime', async () => {
  await getFeaturedProducts()
  expect(cacheTag).toHaveBeenCalledWith('products')
  expect(cacheLife).toHaveBeenCalledWith('hours')
})
it('orders by updatedAt newest first, then id', async () => {
  await seed()
  const featuredSlugs = PRODUCT_SEEDS.filter((product) => product.featured).map((product) => product.slug)
  expect((await getFeaturedProducts()).map((item) => item.slug)).toEqual(featuredSlugs)

  // Restore the original updatedAt afterwards so later tests in this file still see seed order.
  const lastSlug = featuredSlugs.at(-1)
  if (lastSlug === undefined) throw new Error('no featured products in PRODUCT_SEEDS')
  const [before] = await db.select({ at: products.updatedAt }).from(products).where(eq(products.slug, lastSlug))
  if (before === undefined) throw new Error(`seeded product not found: ${lastSlug}`)
  try {
    await db
      .update(products)
      .set({ updatedAt: new Date(Date.now() + 60_000) })
      .where(eq(products.slug, lastSlug))
    expect((await getFeaturedProducts())[0]?.slug).toBe(lastSlug)
  } finally {
    await db.update(products).set({ updatedAt: before.at }).where(eq(products.slug, lastSlug))
  }
})

it('US-11: getProductSitemapEntries returns all 24 slugs with an ISO updatedAt', async () => {
  await seed()
  const entries = await getProductSitemapEntries()
  expect(entries.map((entry) => entry.slug)).toEqual(PRODUCT_SEEDS.map((product) => product.slug))
  expect(entries).toHaveLength(24)
  for (const entry of entries) {
    expect(Object.keys(entry).sort()).toEqual(['slug', 'updatedAt'])
    // A string, not a Date: the value returned from a 'use cache' function must be serializable.
    expect(entry.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
  }
})
it('tags the sitemap entries with products and an hours lifetime', async () => {
  vi.mocked(cacheTag).mockClear()
  vi.mocked(cacheLife).mockClear()
  await getProductSitemapEntries()
  expect(cacheTag).toHaveBeenCalledWith('products')
  expect(cacheLife).toHaveBeenCalledWith('hours')
})
// The sitemap serializer writes <loc> as is, without escaping: a row whose slug is not a valid URL segment (one
// inserted by hand, or by the admin before validation existed) must not reach it; the proxy would 404 it anyway.
it('leaves out a row whose slug is not a valid product slug', async () => {
  await seed()
  const [first] = PRODUCT_SEEDS
  if (first === undefined) throw new Error('PRODUCT_SEEDS is empty')
  try {
    await db.update(products).set({ slug: 'Bad <slug>&' }).where(eq(products.slug, first.slug))
    const slugs = (await getProductSitemapEntries()).map((entry) => entry.slug)
    expect(slugs).toHaveLength(23)
    expect(slugs).not.toContain('Bad <slug>&')
  } finally {
    await db.update(products).set({ slug: first.slug }).where(eq(products.slug, 'Bad <slug>&'))
  }
})
