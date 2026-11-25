import { FAR_DB_URL } from '../playwright.config'
import { VIEWPORT_INDEPENDENT } from './catalog'
import { pngSize, readMeta } from './seo'
import { expect, test } from './test'

// NS-109: when the proxy's database lookup failed open (NS-79, ADR-0009), a well-formed unknown slug reached the Open
// Graph image route, prerendered for every product (generateStaticParams), which answered it with a 500 on v0.4.0.
// Since ADR-0017 the proxy answers product slugs from the static registry and never asks the database. The
// far-database server (e2e/far-db.mjs: every query waits 600 ms, like Neon seen from a far edge) shows it: an unknown
// slug's image gets the proxy's 404 (the not-found page, not the image route's own empty 404) on the first hit, well
// before a single query could have answered. Local build only.
test.skip(Boolean(process.env.BASE_URL), 'Cần server local có DB ở xa (e2e/far-db.mjs)')
test.skip(({ isMobile }) => isMobile, VIEWPORT_INDEPENDENT)

const KNOWN_SLUG = 'ao-git-push-force'
// e2e/far-db.mjs: every query waits this long before it runs.
const FAR_DB_LATENCY_MS = 600

// Never opened in this server's life, so neither the route cache nor a cached read can answer it.
const freshSlug = (label: string) => `ns109-${label}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`

test('NS-109: ảnh OG của slug sản phẩm lạ nhận 404 của proxy ngay lần đầu, cả khi DB ở xa', async ({ request }) => {
  // Not fetchImage: it keeps only the path and would ask the main server.
  // The real og:image path of a product (hash suffix as built), with the slug swapped.
  const html = await (await request.get(`${FAR_DB_URL}/products/${KNOWN_SLUG}`)).text()
  const image = new URL(readMeta(html)['og:image'] ?? '')
  const suffix = image.pathname.slice(`/products/${KNOWN_SLUG}`.length)
  expect(suffix, image.pathname).toMatch(/^\/opengraph-image-[a-z0-9]+$/)

  const paths = ['a', 'b', 'c'].flatMap((label) => [
    `/products/${freshSlug(label)}${suffix}`,
    `/products/${freshSlug(`${label}-nohash`)}/opengraph-image`,
  ])
  for (const path of paths) {
    const started = performance.now()
    const response = await request.get(`${FAR_DB_URL}${path}`)
    const elapsed = Math.round(performance.now() - started)
    expect(response.status(), path).toBe(404)
    // The proxy's rewrite renders the not-found page; the image route would answer an empty 404 of its own.
    expect(await response.text(), path).toContain('Không tìm thấy trang')
    expect(elapsed, `${path}: ${elapsed} ms, không được chờ DB`).toBeLessThan(FAR_DB_LATENCY_MS)
  }

  const known = await request.get(`${FAR_DB_URL}${image.pathname}${image.search}`)
  expect(known.status()).toBe(200)
  expect(pngSize(await known.body()).width).toBeGreaterThan(0)
})

test('NS-109: trang sản phẩm lạ và trang danh sách lạ không 5xx khi DB ở xa', async ({ request }) => {
  for (const path of [
    `/products/${freshSlug('page')}`,
    '/products?category=khong-co-danh-muc&page=999',
    '/products?page=999',
  ]) {
    const response = await request.get(`${FAR_DB_URL}${path}`)
    expect(response.status(), path).toBeLessThan(500)
  }
})
