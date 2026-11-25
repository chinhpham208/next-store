import type { APIRequestContext } from '@playwright/test'
import { expect, test } from './test'
import { PRODUCT_SEEDS } from '@/db/seed-data'
import { POSTS } from '@/features/blog/posts'
import { POSTS_NEWEST_FIRST } from './blog'
import { VIEWPORT_INDEPENDENT } from './catalog'
import { isProductionUrl } from './production'
import { fetchImage, pngSize, readMeta, readSitemap } from './seo'

// Every expectation comes from the seed (src/db/seed-data.ts) and the post registry, never copied by hand. Only raw
// HTML / XML is read (request fixture): that is what a link preview or a crawler sees.

const seedProduct = (slug: string) => {
  const product = PRODUCT_SEEDS.find((seed) => seed.slug === slug)
  if (!product) throw new Error(`Seed không có sản phẩm ${slug}`)
  return product
}

// Code points, not UTF-16 units: the longest name is the one most likely to overflow the image's title block.
const longest = <T>(items: readonly T[], text: (item: T) => string): T =>
  [...items].sort((a, b) => [...text(b)].length - [...text(a)].length)[0]!

const SHARED_PRODUCT = seedProduct('ao-git-push-force')
const LONGEST_NAME_PRODUCT = longest(PRODUCT_SEEDS, (product) => product.name)
const SOLD_OUT_PRODUCT = PRODUCT_SEEDS.find((product) => product.stock === 0)!
const NEWEST_POST = POSTS_NEWEST_FIRST[0]!
const LONGEST_TITLE_POST = longest(POSTS, (post) => post.title)

const OG_WIDTH = 1200
const OG_HEIGHT = 630
const MAX_OG_BYTES = 300 * 1024

const readPage = async (request: APIRequestContext, path: string): Promise<Record<string, string>> => {
  const response = await request.get(path)
  expect(response.status(), path).toBe(200)
  return readMeta(await response.text())
}

const readSitemapOf = async (request: APIRequestContext) => {
  const response = await request.get('/sitemap.xml')
  expect(response.status()).toBe(200)
  return readSitemap(await response.text())
}

const readRobots = async (request: APIRequestContext): Promise<string[]> => {
  const response = await request.get('/robots.txt')
  expect(response.status()).toBe(200)
  return (await response.text()).split(/\r?\n/).map((line) => line.trim())
}

const sitemapLine = (lines: readonly string[]): string | undefined =>
  lines.find((line) => /^sitemap:/i.test(line))?.replace(/^sitemap:\s*/i, '')

test.describe('Metadata chia sẻ', () => {
  test.skip(({ isMobile }) => isMobile, VIEWPORT_INDEPENDENT)

  test('US-11: trang sản phẩm có og:title, og:description, og:image đúng nội dung', async ({ request }) => {
    const meta = await readPage(request, `/products/${SHARED_PRODUCT.slug}`)
    expect(meta['og:title']).toContain(SHARED_PRODUCT.name)
    expect(meta['og:description']).toBe(SHARED_PRODUCT.description)
    const image = new URL(meta['og:image'] ?? '')
    expect(image.protocol).toMatch(/^https?:$/)
    expect(image.pathname.startsWith(`/products/${SHARED_PRODUCT.slug}/opengraph-image`), image.pathname).toBe(true)
    expect(meta['og:image:width']).toBe(String(OG_WIDTH))
    expect(meta['og:image:height']).toBe(String(OG_HEIGHT))
    expect(meta['twitter:card']).toBe('summary_large_image')
  })

  test('US-11: bài blog có og:title, og:description, og:image đúng nội dung', async ({ request }) => {
    const meta = await readPage(request, `/blog/${NEWEST_POST.slug}`)
    expect(meta['og:title']).toBe(NEWEST_POST.title)
    expect(meta['og:description']).toBe(NEWEST_POST.description)
    expect(meta['og:type']).toBe('article')
    const image = new URL(meta['og:image'] ?? '')
    expect(image.pathname.startsWith(`/blog/${NEWEST_POST.slug}/opengraph-image`), image.pathname).toBe(true)
    expect(meta['og:image:width']).toBe(String(OG_WIDTH))
    expect(meta['og:image:height']).toBe(String(OG_HEIGHT))
    expect(meta['twitter:card']).toBe('summary_large_image')
  })

  for (const [label, path] of [
    ['trang chủ', '/'],
    [`sản phẩm tên dài nhất (${LONGEST_NAME_PRODUCT.slug})`, `/products/${LONGEST_NAME_PRODUCT.slug}`],
    [`sản phẩm hết hàng (${SOLD_OUT_PRODUCT.slug})`, `/products/${SOLD_OUT_PRODUCT.slug}`],
    [`bài tiêu đề dài nhất (${LONGEST_TITLE_POST.slug})`, `/blog/${LONGEST_TITLE_POST.slug}`],
  ] as const) {
    test(`US-11: ảnh og:image của ${label} tải được, là PNG 1200×630`, async ({ request }) => {
      const meta = await readPage(request, path)
      const response = await fetchImage(request, meta['og:image'] ?? '')
      expect(response.status()).toBe(200)
      expect(response.headers()['content-type']).toBe('image/png')
      const body = await response.body()
      expect(pngSize(body)).toEqual({ width: OG_WIDTH, height: OG_HEIGHT })
      expect(body.length).toBeLessThan(MAX_OG_BYTES)
    })
  }

  test('US-11: mọi trang công khai có title, description, og:title, og:description, og:image', async ({ request }) => {
    for (const path of [
      '/',
      '/products',
      '/products?category=ao-thun&sort=price-asc',
      `/products/${SHARED_PRODUCT.slug}`,
      '/blog',
      `/blog/${NEWEST_POST.slug}`,
    ]) {
      const meta = await readPage(request, path)
      for (const key of ['title', 'description', 'og:title', 'og:description', 'og:image']) {
        expect(meta[key]?.trim(), `${path}: ${key}`).toBeTruthy()
      }
      expect(meta['og:image'], `${path}: og:image`).toMatch(/^https?:\/\/[^/]+\//)
    }
  })
})

test.describe('Sitemap và robots', () => {
  test.skip(({ isMobile }) => isMobile, VIEWPORT_INDEPENDENT)

  test('US-11: og:image và sitemap dùng URL tuyệt đối cùng một origin', async ({ request }) => {
    const meta = await readPage(request, `/products/${SHARED_PRODUCT.slug}`)
    const imageOrigin = new URL(meta['og:image'] ?? '').origin
    const locOrigins = new Set((await readSitemapOf(request)).map((entry) => new URL(entry.loc).origin))
    const robotsSitemap = sitemapLine(await readRobots(request))
    expect(robotsSitemap, 'robots.txt: dòng Sitemap:').toBeDefined()

    expect([...locOrigins]).toEqual([imageOrigin])
    expect(new URL(robotsSitemap!).origin).toBe(imageOrigin)
    // Deployed: the build's site URL must be the deployment's https host, never the local fallback (K6).
    if (process.env.BASE_URL) {
      const origin = new URL(imageOrigin)
      expect(origin.protocol).toBe('https:')
      expect(origin.hostname).not.toMatch(/^(localhost|127\.0\.0\.1)$/)
    }
  })

  test('US-11: /sitemap.xml liệt kê mọi sản phẩm và bài blog', async ({ request }) => {
    const entries = await readSitemapOf(request)
    const paths = entries.map((entry) => new URL(entry.loc).pathname)
    const expected = [
      '/',
      '/products',
      '/blog',
      ...PRODUCT_SEEDS.map((product) => `/products/${product.slug}`),
      ...POSTS.map((post) => `/blog/${post.slug}`),
    ]
    expect(new Set(paths).size, 'không có URL trùng').toBe(paths.length)
    expect([...paths].sort()).toEqual([...expected].sort())
    expect(entries.filter((entry) => entry.loc.includes('?')).map((entry) => entry.loc)).toEqual([])
    for (const entry of entries) {
      if (/^\/(products|blog)\/[^/]+$/.test(new URL(entry.loc).pathname)) {
        expect(entry.lastmod, entry.loc).toMatch(/^\d{4}-\d{2}-\d{2}/)
      }
    }
  })

  test('US-11: mọi URL trong sitemap trả 200', async ({ request }) => {
    const failures: string[] = []
    for (const entry of await readSitemapOf(request)) {
      const path = new URL(entry.loc).pathname
      const status = (await request.get(path)).status()
      if (status !== 200) failures.push(`${path} → ${status}`)
    }
    expect(failures).toEqual([])
  })

  test('US-11: /robots.txt cho phép crawl và trỏ tới sitemap', async ({ request }) => {
    const lines = await readRobots(request)
    expect(lines).toContain('User-Agent: *')
    // Task 11: only a Vercel production build may be crawled; preview, Dev and a local build say Disallow: /.
    if (isProductionUrl(process.env.BASE_URL)) {
      expect(lines).toContain('Allow: /')
      expect(lines).not.toContain('Disallow: /')
    } else {
      expect(lines).toContain('Disallow: /')
      expect(lines).not.toContain('Allow: /')
    }
    const sitemap = sitemapLine(lines)
    expect(sitemap).toMatch(/^https?:\/\/[^/]+\/sitemap\.xml$/)
  })

  test('US-11: trang 404 có noindex và không nằm trong sitemap', async ({ request }) => {
    const sitemapPaths = new Set((await readSitemapOf(request)).map((entry) => new URL(entry.loc).pathname))
    // A random slug each run, so no cached answer from an earlier run can stand in for the 404.
    const unknownProduct = `/products/khong-co-${Date.now()}-${Math.floor(Math.random() * 1e6)}`
    for (const path of ['/khong-ton-tai', unknownProduct]) {
      const response = await request.get(path)
      expect(response.status(), path).toBe(404)
      expect(readMeta(await response.text()).robots, path).toMatch(/\bnoindex\b/)
      expect(sitemapPaths.has(path), path).toBe(false)
    }
  })

  test('US-11: ảnh og của slug lạ trả 404', async ({ request }) => {
    const unknown = `khong-co-${Date.now()}-${Math.floor(Math.random() * 1e6)}`
    for (const [page, segment] of [
      [`/products/${SHARED_PRODUCT.slug}`, `/products/${SHARED_PRODUCT.slug}/`],
      [`/blog/${NEWEST_POST.slug}`, `/blog/${NEWEST_POST.slug}/`],
    ] as const) {
      const image = new URL((await readPage(request, page))['og:image'] ?? '')
      expect(image.pathname.startsWith(segment), image.pathname).toBe(true)
      const domain = segment.split('/')[1]
      const swapped = new URL(image)
      swapped.pathname = image.pathname.replace(segment, `/${domain}/${unknown}/`)
      expect((await fetchImage(request, swapped.toString())).status(), swapped.pathname).toBe(404)
    }
  })
})
