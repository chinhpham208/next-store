import { beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { runMigrations } from '@/db/migrate'
import { seed } from '@/db/seed'
import { PRODUCT_SEEDS } from '@/db/seed-data'
import robots from '@/app/robots'
import sitemap from '@/app/sitemap'

vi.mock('next/cache', () => ({ cacheTag: vi.fn(), cacheLife: vi.fn() }))
// Vitest does not compile MDX, and the blog index re-exports content.ts (ADR-0012): the registry is replaced by a
// fixture here; the real registry's URLs are checked by smoke against the build.
vi.mock('@/features/blog', () => ({
  getAllPosts: () => [
    { slug: 'bai-moi', title: 'Mới', description: 'm', publishedAt: '2026-11-16' },
    { slug: 'bai-cu', title: 'Cũ', description: 'c', publishedAt: '2026-10-26' },
  ],
}))

const SITE = 'https://shop.example.test'

beforeAll(async () => {
  await runMigrations()
  await seed()
})

beforeEach(() => {
  vi.stubEnv('SITE_URL', SITE)
  return () => vi.unstubAllEnvs()
})

it('US-11: lists home, /products, /blog, every product, then every post, all on the site origin', async () => {
  const urls = (await sitemap()).map((entry) => entry.url)
  expect(urls).toEqual([
    `${SITE}/`,
    `${SITE}/products`,
    `${SITE}/blog`,
    ...PRODUCT_SEEDS.map((product) => `${SITE}/products/${product.slug}`),
    `${SITE}/blog/bai-moi`,
    `${SITE}/blog/bai-cu`,
  ])
})

it('has no filtered, searched or paginated URL', async () => {
  expect((await sitemap()).filter((entry) => entry.url.includes('?'))).toEqual([])
})

it('dates a product by its updatedAt and a post by its publishedAt', async () => {
  const entries = await sitemap()
  const product = entries.find((entry) => entry.url.endsWith(`/products/${PRODUCT_SEEDS[0]?.slug}`))
  expect(product?.lastModified).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  expect(entries.find((entry) => entry.url.endsWith('/blog/bai-cu'))?.lastModified).toBe('2026-10-26')
})

// Listing pages change when any item in them does; no clock value, so the prerendered sitemap is reproducible.
it('dates each listing page by its newest item, and home by the newest of both', async () => {
  const entries = await sitemap()
  const at = (path: string) => entries.find((entry) => entry.url === `${SITE}${path}`)?.lastModified
  const productDates = entries
    .filter((entry) => entry.url.includes('/products/'))
    .map((entry) => String(entry.lastModified))
    .sort()
  const newestProduct = productDates.at(-1)
  expect(at('/products')).toBe(newestProduct)
  expect(at('/blog')).toBe('2026-11-16')
  expect(at('/')).toBe([newestProduct, '2026-11-16'].sort().at(-1))
})

it('robots allows everything and points to the sitemap on the site origin', () => {
  expect(robots()).toEqual({ rules: { userAgent: '*', allow: '/' }, sitemap: `${SITE}/sitemap.xml` })
})
