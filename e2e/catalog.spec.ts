import { PRODUCT_SLUGS } from '@/features/products/catalog-slugs'
import { VIEWPORT_INDEPENDENT } from './catalog'
import { readSitemap } from './seo'
import { expect, test } from './test'

// ADR-0017 (b): the proxy answers product slugs from the static registry (catalog-slugs.ts), never from the database.
// A product in the database but not in the registry would 404; one in the registry but not in the database would get a
// soft 404 from its page. The sitemap lists the products of this environment's own database, so the two sets must be
// equal. Read-only: runs on CI, preview, Dev and Production (after every release), so a product added with the SQL
// Editor instead of a PR turns this red.
test.skip(({ isMobile }) => isMobile, VIEWPORT_INDEPENDENT)

test('catalog: sitemap và registry slug khớp nhau', async ({ request }) => {
  const response = await request.get('/sitemap.xml')
  expect(response.status()).toBe(200)
  const productSlugs = readSitemap(await response.text())
    .map((entry) => /^\/products\/([^/]+)$/.exec(new URL(entry.loc).pathname)?.[1])
    .filter((slug) => slug !== undefined)
  expect(productSlugs.length, 'sitemap không có trùng slug sản phẩm').toBe(new Set(productSlugs).size)
  expect([...productSlugs].sort()).toEqual([...PRODUCT_SLUGS].sort())
})
