import { unstable_doesMiddlewareMatch } from 'next/experimental/testing/server'
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { isPostSlug } from '@/features/blog/proxy-api'
import { isCatalogSlug } from '@/features/products/proxy-api'
import { config, proxy } from './proxy'

// The proxy answers product slugs from the static registry (ADR-0017, NS-79): on Vercel it runs at the edge nearest
// the visitor, far from the database. If anything in its graph imported @/db, this factory would run and every
// query would throw; both are checked below. dependency-cruiser `proxy-no-db` checks the same statically.
const database = vi.hoisted(() => ({ imported: false, query: vi.fn() }))
vi.mock('@/db', () => {
  database.imported = true
  return { dbQuery: database.query }
})

// The real registry checks, wrapped only to see which branch asks which (and nothing else). isProductSlug stays real,
// so the malformed-slug tests prove the proxy refuses them before the registry is asked.
vi.mock('@/features/products/proxy-api', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/features/products/proxy-api')>()
  return { ...real, isCatalogSlug: vi.fn(real.isCatalogSlug) }
})
vi.mock('@/features/blog/proxy-api', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/features/blog/proxy-api')>()
  return { ...real, isPostSlug: vi.fn(real.isPostSlug) }
})

const catalogCheck = vi.mocked(isCatalogSlug)
const postCheck = vi.mocked(isPostSlug)
const KNOWN_POST = '/blog/chao-mung-den-next-store'
const KNOWN_PRODUCT = '/products/ao-git-push-force'
const call = (path: string) => proxy(new NextRequest(`https://shop.test${path}`))
const NOT_FOUND = 'https://shop.test/_khong-tim-thay'

const isPassThrough = (response: Response) =>
  response.headers.get('x-middleware-next') === '1' && response.headers.get('x-middleware-rewrite') === null
const isNotFound = (response: Response) => response.headers.get('x-middleware-rewrite') === NOT_FOUND

// Next.js 16.4.6 transport forms (build/analysis/get-page-static-info.js; shapes from .next/server/app/products/):
// Vercel hands the proxy the full path (audit M1), `next start` strips only the final `.rsc` (measured).
const TRANSPORT_SUFFIXES = [
  '.rsc',
  '.segments/_tree.segment.rsc',
  '.segments/_tree.segment',
  '.segments/!KHNob3Ap/products/$d$slug/__PAGE__.segment',
  '.segments/_full.segment.rsc',
  '.segments/!KHNob3Ap.segment.rsc',
  '.segments/!KHNob3Ap/products/$d$slug/__PAGE__.segment.rsc',
]

let log: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  vi.clearAllMocks()
  // The database is down for every test: no answer may depend on it.
  database.query.mockImplementation(() => {
    throw new Error('db down')
  })
  log = vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.useFakeTimers()
})
afterEach(() => {
  // No answer may wait on a timer, log, or touch the database.
  expect(vi.getTimerCount()).toBe(0)
  expect(log).not.toHaveBeenCalled()
  expect(database.query).not.toHaveBeenCalled()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('proxy', () => {
  it('passes a known slug through', () => {
    const response = call(KNOWN_PRODUCT)
    expect(catalogCheck).toHaveBeenCalledWith('ao-git-push-force')
    expect(isPassThrough(response)).toBe(true)
  })

  it('answers synchronously: nothing to wait for', () => {
    expect(call(KNOWN_PRODUCT)).not.toBeInstanceOf(Promise)
    expect(call('/products/khong-ton-tai')).not.toBeInstanceOf(Promise)
  })

  it('passes every registry slug through', async () => {
    const { PRODUCT_SLUGS } = await import('@/features/products/catalog-slugs')
    for (const slug of PRODUCT_SLUGS) expect(isPassThrough(call(`/products/${slug}`))).toBe(true)
  })

  it('US-05: rewrites an unknown slug to the not-found path', () => {
    const response = call('/products/khong-ton-tai')
    expect(catalogCheck).toHaveBeenCalledWith('khong-ton-tai')
    expect(response.headers.get('x-middleware-rewrite')).toBe(NOT_FOUND)
  })

  it('proxy answers an unknown product slug without the database', () => {
    expect(isNotFound(call('/products/khong-ton-tai'))).toBe(true)
    expect(isPassThrough(call(KNOWN_PRODUCT))).toBe(true)
    expect(database.imported).toBe(false)
  })

  it('answers the same with the database down', () => {
    // beforeEach makes every query throw; the answers are those of a healthy database.
    expect(isNotFound(call('/products/chua-ai-mo'))).toBe(true)
    expect(isNotFound(call('/products/chua-ai-mo/opengraph-image-16g1u1'))).toBe(true)
    expect(isPassThrough(call('/products/sticker-git'))).toBe(true)
    expect(isPassThrough(call('/products/sticker-git/opengraph-image-16g1u1'))).toBe(true)
  })

  it.each([
    '/products/Sai_Dang',
    '/products/KHONG-TON-TAI',
    '/products/AO-GIT-PUSH-FORCE',
    '/products/khong%2Dton%2Dtai',
    '/products/ao%2Dgit%2Dpush%2Dforce',
    '/products/khong-ton-tai%00',
    `/products/${'a'.repeat(81)}`,
  ])('rewrites the malformed %s to not-found without asking the registry', (path) => {
    const response = call(path)
    expect(response.headers.get('x-middleware-rewrite')).toBe(NOT_FOUND)
    expect(catalogCheck).not.toHaveBeenCalled()
  })

  it.each(TRANSPORT_SUFFIXES)('passes a known slug in the %s transport form through', (suffix) => {
    const response = call(`/products/ao-git-push-force${suffix}`)
    expect(catalogCheck).toHaveBeenCalledWith('ao-git-push-force')
    expect(isPassThrough(response)).toBe(true)
  })

  it.each(TRANSPORT_SUFFIXES)('rewrites an unknown slug in the %s transport form to not-found', (suffix) => {
    const response = call(`/products/khong-ton-tai${suffix}`)
    expect(catalogCheck).toHaveBeenCalledWith('khong-ton-tai')
    expect(response.headers.get('x-middleware-rewrite')).toBe(NOT_FOUND)
  })

  it.each([
    '/products/Sai_Dang.segments/_tree.segment.rsc',
    '/products/KHONG-TON-TAI.rsc',
    '/products/khong%2Dton%2Dtai.segments/_full.segment.rsc',
    '/products/ao-git-push-force.rsc.rsc',
    '/products/ao-git-push-force.segments/_tree',
    '/products/ao-git-push-force.segments/_tree.rsc',
    '/products/ao-git-push-force.segment.rsc',
    '/products/ao-git-push-force.segments/.segment.rsc',
    '/products/ao-git-push-force.json',
  ])('rewrites the malformed transport path %s to not-found without asking the registry', (path) => {
    const response = call(path)
    expect(response.headers.get('x-middleware-rewrite')).toBe(NOT_FOUND)
    expect(catalogCheck).not.toHaveBeenCalled()
  })
})

// Blog (ADR-0012, Task 13 M3): the slug is checked against the static registry only, like products since ADR-0017.
// An unknown slug never reaches the page (K3: 200 + cache entry).
describe('proxy: blog', () => {
  it('lets a known blog post through', () => {
    const response = call(KNOWN_POST)
    expect(isPassThrough(response)).toBe(true)
    expect(postCheck).toHaveBeenCalledWith('chao-mung-den-next-store')
    expect(catalogCheck).not.toHaveBeenCalled()
  })

  it.each([
    '/blog/khong-ton-tai',
    '/blog/Chao-Mung-Den-Next-Store',
    '/blog/CHAO-MUNG-DEN-NEXT-STORE',
    '/blog/chao%2Dmung-den-next-store',
    '/blog/chao%2Dmung%2Dden%2Dnext%2Dstore',
    '/blog/chao-mung-den-next-store%00',
    '/blog/chao_mung',
    '/blog/constructor',
    '/blog/__proto__',
    '/blog/toString',
    '/blog/hasOwnProperty',
    '/blog/chao-mung-den-next-store.json',
    '/blog/chao-mung-den-next-store.rsc.rsc',
    '/blog/chao-mung-den-next-store.segment.rsc',
    '/blog/chao-mung-den-next-store.segments/_tree',
    `/blog/${'a'.repeat(81)}`,
  ])('rewrites an unknown blog slug to the not-found path (%s)', (path) => {
    expect(isNotFound(call(path))).toBe(true)
    expect(catalogCheck).not.toHaveBeenCalled()
  })

  it.each(TRANSPORT_SUFFIXES)('lets the %s transport form of a known post through', (suffix) => {
    const response = call(`${KNOWN_POST}${suffix}`)
    expect(isPassThrough(response)).toBe(true)
    expect(postCheck).toHaveBeenCalledWith('chao-mung-den-next-store')
    expect(catalogCheck).not.toHaveBeenCalled()
  })

  it.each(TRANSPORT_SUFFIXES)('rewrites the %s transport form of an unknown post to not-found', (suffix) => {
    expect(isNotFound(call(`/blog/khong-ton-tai${suffix}`))).toBe(true)
    expect(catalogCheck).not.toHaveBeenCalled()
  })

  it('never treats a product slug as a post, or a post slug as a product', () => {
    expect(isNotFound(call('/blog/ao-git-push-force'))).toBe(true)
    expect(catalogCheck).not.toHaveBeenCalled()
    expect(isNotFound(call('/products/chao-mung-den-next-store'))).toBe(true)
    expect(catalogCheck).toHaveBeenCalledWith('chao-mung-den-next-store')
  })
})

// Open Graph image routes (K10): inside a route group the file gets a hash suffix (`opengraph-image-16g1u1`); without
// the proxy an unknown slug answers a 200 image and leaves a new cache entry. The suffix-less form is covered too: it is
// the route's own name, and Vercel or a later Next.js may serve it. Since ADR-0017 an unknown product's image is a
// 404 here even with the database down, so the route handler never runs for it (NS-109: it answered 500).
describe('proxy: open graph image paths', () => {
  const IMAGE_SUFFIXES = ['/opengraph-image-16g1u1', '/opengraph-image-11vtts', '/opengraph-image']

  it.each(IMAGE_SUFFIXES)('lets the image %s of a known post and a known product through', (image) => {
    expect(isPassThrough(call(`${KNOWN_POST}${image}`))).toBe(true)
    expect(isPassThrough(call(`${KNOWN_PRODUCT}${image}`))).toBe(true)
    expect(catalogCheck).toHaveBeenCalledTimes(1)
    expect(catalogCheck).toHaveBeenCalledWith('ao-git-push-force')
  })

  it.each(IMAGE_SUFFIXES)('rewrites the open graph image %s of an unknown slug', (image) => {
    expect(isNotFound(call(`/blog/khong-ton-tai${image}`))).toBe(true)
    expect(catalogCheck).not.toHaveBeenCalled()
    expect(isNotFound(call(`/products/khong-ton-tai${image}`))).toBe(true)
    expect(catalogCheck).toHaveBeenCalledWith('khong-ton-tai')
  })

  it.each([
    [`${KNOWN_POST}/opengraph-image-11vtts`, false],
    ['/blog/khong-ton-tai/opengraph-image-11vtts', true],
    ['/blog/Chao-Mung-Den-Next-Store/opengraph-image-11vtts', true],
    ['/blog/constructor/opengraph-image-11vtts', true],
    [`${KNOWN_PRODUCT}/opengraph-image-16g1u1`, false],
    [`${KNOWN_PRODUCT}/opengraph-image`, false],
    ['/products/khong-ton-tai/opengraph-image-16g1u1', true],
    ['/products/AO-GIT-PUSH-FORCE/opengraph-image-16g1u1', true],
    ['/products/ao%2Dgit%2Dpush%2Dforce/opengraph-image-16g1u1', true],
    [`${KNOWN_PRODUCT}/khac`, true],
    [`${KNOWN_PRODUCT}/opengraph-image-`, true],
    [`${KNOWN_PRODUCT}/opengraph-image-16G1U1`, true],
    [`${KNOWN_PRODUCT}/opengraph-image.png`, true],
    [`${KNOWN_PRODUCT}/twitter-image-16g1u1`, true],
    [`${KNOWN_POST}/opengraph-image-11vtts/them`, true],
  ])('open graph image path %s → rewritten: %s', (path, rewritten) => {
    const response = call(path)
    expect(isNotFound(response)).toBe(rewritten)
    expect(isPassThrough(response)).toBe(!rewritten)
  })
})

// M4 decision 11 (C3, NS-92), narrowed by NS-103: a Server Action is a POST to the page that renders it, carrying the
// `next-action` header (Next.js 16.4.6 client/components/app-router-headers.js ACTION_HEADER, read in
// server/lib/server-action-request-meta.js), and the matcher does not filter by method. Only that request goes
// straight on; the action checks the product itself. Any other method, and a POST without the header, is rendered by
// Next.js like a GET: it gets the same slug check, or an unknown slug would answer 200 and leave a new route cache
// entry (audit NS-96, ADR-0014 (e)).
describe('proxy: Server Actions and other methods', () => {
  const callWith = (method: string, path: string, headers?: Record<string, string>) =>
    proxy(new NextRequest(`https://shop.test${path}`, { method, headers }))
  const ACTION = { 'next-action': '7f3a9c' }

  it.each([KNOWN_PRODUCT, '/products/khong-ton-tai', '/products/KHONG-TON-TAI', `${KNOWN_PRODUCT}.rsc`])(
    'lets a Server Action POST to a product path through without checking the slug (%s)',
    (path) => {
      expect(isPassThrough(callWith('POST', path, ACTION))).toBe(true)
      expect(catalogCheck).not.toHaveBeenCalled()
    },
  )

  it('lets a Server Action POST to a blog path or an open graph image path through without checking the slug', () => {
    for (const path of ['/blog/khong-ton-tai', KNOWN_POST, '/products/khong-ton-tai/opengraph-image-16g1u1']) {
      expect(isPassThrough(callWith('POST', path, ACTION))).toBe(true)
    }
    expect(postCheck).not.toHaveBeenCalled()
    expect(catalogCheck).not.toHaveBeenCalled()
  })

  // Header names are case-insensitive on the wire; Headers.has matches them all, as Next.js's own headers.get does.
  // An empty value is still a fetch action to Next.js (typeof '' === 'string'), answered before render.
  it.each(['next-action', 'Next-Action', 'NEXT-ACTION', 'nExT-aCtIoN'])('recognises the %s header', (name) => {
    expect(isPassThrough(callWith('POST', '/products/khong-ton-tai', { [name]: '7f3a9c' }))).toBe(true)
    expect(catalogCheck).not.toHaveBeenCalled()
  })

  it('recognises a next-action header with an empty value', () => {
    expect(isPassThrough(callWith('POST', '/blog/khong-ton-tai', { 'next-action': '' }))).toBe(true)
    expect(postCheck).not.toHaveBeenCalled()
  })

  it.each(['PUT', 'PATCH', 'DELETE', 'OPTIONS'])('does not take next-action on %s as a Server Action', (method) => {
    expect(isNotFound(callWith(method, '/products/KHONG-TON-TAI', ACTION))).toBe(true)
    expect(isNotFound(callWith(method, '/blog/khong-ton-tai', ACTION))).toBe(true)
    expect(isNotFound(callWith(method, '/products/khong-ton-tai', ACTION))).toBe(true)
    expect(catalogCheck).toHaveBeenCalledWith('khong-ton-tai')
  })

  it.each([
    ['POST', {}],
    ['POST', { 'content-type': 'application/x-www-form-urlencoded' }],
    ['POST', { 'content-type': 'multipart/form-data; boundary=x' }],
    ['POST', { 'next-router-state-tree': 'x', 'x-action': '7f3a9c' }],
    ['PUT', {}],
    ['PATCH', {}],
    ['DELETE', {}],
    ['OPTIONS', {}],
  ])('rewrites a %s %j to an unknown or malformed slug to not-found', (method, headers) => {
    for (const path of [
      '/products/KHONG-TON-TAI',
      '/products/a..b',
      '/products/Ao%20X',
      '/blog/khong-ton-tai',
      '/blog/constructor',
      '/blog/khong-ton-tai/opengraph-image-11vtts',
    ]) {
      expect(isNotFound(callWith(method, path, headers))).toBe(true)
    }
    expect(catalogCheck).not.toHaveBeenCalled()
    expect(isNotFound(callWith(method, '/products/khong-ton-tai', headers))).toBe(true)
    expect(isNotFound(callWith(method, '/products/khong-ton-tai/opengraph-image-16g1u1', headers))).toBe(true)
    expect(catalogCheck).toHaveBeenCalledWith('khong-ton-tai')
  })

  it.each(['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'])('lets %s without next-action to a known slug through', (method) => {
    expect(isPassThrough(callWith(method, KNOWN_PRODUCT))).toBe(true)
    expect(catalogCheck).toHaveBeenCalledWith('ao-git-push-force')
    expect(isPassThrough(callWith(method, KNOWN_POST))).toBe(true)
    expect(isPassThrough(callWith(method, `${KNOWN_PRODUCT}/opengraph-image-16g1u1`))).toBe(true)
  })

  it.each(['GET', 'HEAD'])('still checks the slug on %s, with or without next-action', (method) => {
    for (const headers of [{}, ACTION]) {
      expect(isNotFound(callWith(method, '/products/khong-ton-tai', headers))).toBe(true)
      expect(isNotFound(callWith(method, '/products/KHONG-TON-TAI', headers))).toBe(true)
      expect(isNotFound(callWith(method, '/blog/khong-ton-tai', headers))).toBe(true)
    }
    expect(catalogCheck).toHaveBeenCalledWith('khong-ton-tai')
    expect(isPassThrough(callWith(method, KNOWN_PRODUCT))).toBe(true)
  })
})

describe('config.matcher', () => {
  it('is a constant list, so Next.js can analyse it statically', () => {
    expect(config).toEqual({
      matcher: ['/products/:slug', '/products/:slug/:image', '/blog/:slug', '/blog/:slug/:image'],
    })
  })

  it.each([
    '/products/ao-git-push-force',
    '/products/khong-ton-tai',
    '/products/khong-ton-tai.rsc',
    '/products/ao-git-push-force.segments/_tree.segment.rsc',
    '/products/ao-git-push-force.segments/!KHNob3Ap/products/$d$slug/__PAGE__.segment.rsc',
    '/products/KHONG-TON-TAI',
    '/products/khong%2Dton%2Dtai',
    '/products/x/opengraph-image-16g1u1',
    '/products/x/opengraph-image',
    '/products/a/b',
    '/blog/x',
    '/blog/x.rsc',
    '/blog/x.segments/_tree.segment.rsc',
    '/blog/x/opengraph-image-11vtts',
    '/blog/x/opengraph-image-11vtts?a7b8c9',
    '/blog/KHONG-TON-TAI',
    '/blog/constructor',
  ])('runs the proxy for %s', (url) => {
    expect(unstable_doesMiddlewareMatch({ config, url })).toBe(true)
  })

  it.each([
    '/',
    '/products',
    '/products?category=ao-thun&page=2',
    '/products.rsc',
    '/blog',
    '/blog.rsc',
    '/opengraph-image',
    '/opengraph-image?a1b2c3',
    '/sitemap.xml',
    '/robots.txt',
    '/khong-ton-tai',
    '/_next/static/x.js',
    '/_next/static/chunks/main.js',
    '/_next/image?url=%2Fimages%2Fao-thun.svg&w=640&q=75',
    '/images/ao-thun.svg',
    '/favicon.ico',
  ])('leaves %s alone', (url) => {
    expect(unstable_doesMiddlewareMatch({ config, url })).toBe(false)
  })
})
