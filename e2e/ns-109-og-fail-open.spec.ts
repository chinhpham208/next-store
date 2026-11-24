import { readFileSync } from 'node:fs'
import { FAR_DB_LOG, FAR_DB_URL } from '../playwright.config'
import { VIEWPORT_INDEPENDENT } from './catalog'
import { pngSize, readMeta } from './seo'
import { expect, test } from './test'

// NS-109: with the proxy's slug lookup failing open (NS-79, ADR-0009), a well-formed unknown slug reaches the Open
// Graph image route, which is prerendered for every product (generateStaticParams) and so renders an unknown slug as
// an ISR prerender. v0.4.0 answered it with a 500 (DYNAMIC_SERVER_USAGE): a cached read with expire 0 counts as
// dynamic there, and a route handler has no dynamic hole to resume. The far-database server (e2e/far-db.mjs) fails
// the lookup open on every unknown slug, like Production seen from a far edge. Local build only.
test.skip(Boolean(process.env.BASE_URL), 'Cần server local có DB ở xa (e2e/far-db.mjs)')
test.skip(({ isMobile }) => isMobile, VIEWPORT_INDEPENDENT)

const KNOWN_SLUG = 'ao-git-push-force'
const LOOKUP_TIMED_OUT = 'proxy: product slug lookup timed out; letting the request through'

// Never opened in this server's life, so neither the route cache nor a cached read can answer it.
const freshSlug = (label: string) => `ns109-${label}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`

const lookupTimeouts = () => readFileSync(FAR_DB_LOG, 'utf8').split(LOOKUP_TIMED_OUT).length - 1

test('NS-109: ảnh OG của slug sản phẩm lạ trả 404 cả khi proxy fail-open, từ lần đầu', async ({ request }) => {
  // Not fetchImage: it keeps only the path and would ask the main server, whose proxy answers the 404 itself.
  // The real og:image path of a product (hash suffix as built), with the slug swapped.
  const html = await (await request.get(`${FAR_DB_URL}/products/${KNOWN_SLUG}`)).text()
  const image = new URL(readMeta(html)['og:image'] ?? '')
  const suffix = image.pathname.slice(`/products/${KNOWN_SLUG}`.length)
  expect(suffix, image.pathname).toMatch(/^\/opengraph-image-[a-z0-9]+$/)

  const before = lookupTimeouts()
  const paths = ['a', 'b', 'c'].flatMap((label) => [
    `/products/${freshSlug(label)}${suffix}`,
    `/products/${freshSlug(`${label}-nohash`)}/opengraph-image`,
  ])
  for (const path of paths) {
    const response = await request.get(`${FAR_DB_URL}${path}`)
    expect(response.status(), path).toBe(404)
  }
  // Each request really reached the route: the proxy let it through, it did not answer the 404 itself.
  expect(lookupTimeouts() - before).toBeGreaterThanOrEqual(paths.length)

  const known = await request.get(`${FAR_DB_URL}${image.pathname}${image.search}`)
  expect(known.status()).toBe(200)
  expect(pngSize(await known.body()).width).toBeGreaterThan(0)
})

test('NS-109: trang sản phẩm lạ và trang danh sách lạ không 5xx khi proxy fail-open', async ({ request }) => {
  for (const path of [
    `/products/${freshSlug('page')}`,
    '/products?category=khong-co-danh-muc&page=999',
    '/products?page=999',
  ]) {
    const response = await request.get(`${FAR_DB_URL}${path}`)
    expect(response.status(), path).toBeLessThan(500)
  }
})
