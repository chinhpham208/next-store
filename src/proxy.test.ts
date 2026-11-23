import { unstable_doesMiddlewareMatch } from 'next/experimental/testing/server'
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { isPostSlug } from '@/features/blog/proxy-api'
import { isKnownProductSlug } from '@/features/products/proxy-api'
import { config, proxy } from './proxy'

// Only the database lookup is replaced; isProductSlug stays real, so the malformed-slug tests prove the proxy
// itself refuses them before any lookup.
vi.mock('@/features/products/proxy-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/products/proxy-api')>()),
  isKnownProductSlug: vi.fn(),
}))

// The real registry check, wrapped only to see that the blog branch asks it (and nothing else).
vi.mock('@/features/blog/proxy-api', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/features/blog/proxy-api')>()
  return { ...real, isPostSlug: vi.fn(real.isPostSlug) }
})

const known = vi.mocked(isKnownProductSlug)
const postCheck = vi.mocked(isPostSlug)
const KNOWN_POST = '/blog/chao-mung-den-next-store'
const KNOWN_PRODUCT = '/products/ao-git-push-force'
const call = (path: string) => proxy(new NextRequest(`https://shop.test${path}`))
const NOT_FOUND = 'https://shop.test/_khong-tim-thay'
// What the audit asked for (PR #20): well under the 10 s connect_timeout of the database client.
const LOOKUP_BOUND_MS = 500

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
  log = vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('proxy', () => {
  it('passes a known slug through', async () => {
    known.mockResolvedValue(true)
    const response = await call('/products/ao-git-push-force')
    expect(known).toHaveBeenCalledWith('ao-git-push-force')
    expect(isPassThrough(response)).toBe(true)
  })

  it('US-05: rewrites an unknown slug to the not-found path', async () => {
    known.mockResolvedValue(false)
    const response = await call('/products/khong-ton-tai')
    expect(known).toHaveBeenCalledWith('khong-ton-tai')
    expect(response.headers.get('x-middleware-rewrite')).toBe(NOT_FOUND)
  })

  it.each([
    '/products/Sai_Dang',
    '/products/KHONG-TON-TAI',
    '/products/AO-GIT-PUSH-FORCE',
    '/products/khong%2Dton%2Dtai',
    '/products/ao%2Dgit%2Dpush%2Dforce',
    '/products/khong-ton-tai%00',
    `/products/${'a'.repeat(81)}`,
  ])('rewrites the malformed %s to not-found without a lookup, even with the database down', async (path) => {
    known.mockRejectedValue(new Error('db down'))
    const response = await call(path)
    expect(response.headers.get('x-middleware-rewrite')).toBe(NOT_FOUND)
    expect(known).not.toHaveBeenCalled()
    expect(log).not.toHaveBeenCalled()
  })

  it.each(TRANSPORT_SUFFIXES)('passes a known slug in the %s transport form through', async (suffix) => {
    known.mockResolvedValue(true)
    const response = await call(`/products/ao-git-push-force${suffix}`)
    expect(known).toHaveBeenCalledWith('ao-git-push-force')
    expect(isPassThrough(response)).toBe(true)
  })

  it.each(TRANSPORT_SUFFIXES)('rewrites an unknown slug in the %s transport form to not-found', async (suffix) => {
    known.mockResolvedValue(false)
    const response = await call(`/products/khong-ton-tai${suffix}`)
    expect(known).toHaveBeenCalledWith('khong-ton-tai')
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
  ])('rewrites the malformed transport path %s to not-found without a lookup', async (path) => {
    known.mockRejectedValue(new Error('db down'))
    const response = await call(path)
    expect(response.headers.get('x-middleware-rewrite')).toBe(NOT_FOUND)
    expect(known).not.toHaveBeenCalled()
  })

  it('lets the request through when the lookup throws, logging one fixed line without the error', async () => {
    const cause = new Error('select "id" from "products" where "slug" = $1 — host ep-x.neon.tech')
    known.mockRejectedValue(new Error('connect ECONNREFUSED postgres://u:secret@h/db', { cause }))
    const response = await call('/products/sticker-git')
    expect(isPassThrough(response)).toBe(true)
    expect(log).toHaveBeenCalledTimes(1)
    expect(log.mock.calls[0]).toHaveLength(1)
    expect(typeof log.mock.calls[0]?.[0]).toBe('string')
    const logged = JSON.stringify(log.mock.calls)
    for (const leak of ['secret', 'postgres://', 'select', 'neon.tech', 'sticker-git']) expect(logged).not.toContain(leak)
  })

  it('lets the request through when the lookup throws synchronously', async () => {
    known.mockImplementation(() => {
      throw new Error('db down')
    })
    expect(isPassThrough(await call('/products/sticker-git'))).toBe(true)
    expect(log).toHaveBeenCalledTimes(1)
  })

  it(`lets the request through within ${LOOKUP_BOUND_MS} ms when the lookup never settles`, async () => {
    vi.useFakeTimers()
    known.mockReturnValue(new Promise<boolean>(() => {}))
    let settled: Response | undefined
    void call('/products/chua-ai-mo').then((response) => {
      settled = response
    })
    await vi.advanceTimersByTimeAsync(LOOKUP_BOUND_MS)
    expect(settled).toBeDefined()
    expect(settled && isPassThrough(settled)).toBe(true)
    expect(log).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(log.mock.calls)).not.toContain('chua-ai-mo')
  })

  it('does not wait for the timer once the lookup has answered', async () => {
    vi.useFakeTimers()
    known.mockResolvedValue(false)
    const response = await call('/products/khong-ton-tai')
    expect(response.headers.get('x-middleware-rewrite')).toBe(NOT_FOUND)
    expect(vi.getTimerCount()).toBe(0)
  })
})

// Blog (ADR-0012, Task 13 M3): the slug is checked against the static registry only. No database, no timer, no log,
// so the answer is the same with the database down and an unknown slug never reaches the page (K3: 200 + cache entry).
describe('proxy: blog', () => {
  beforeEach(() => {
    known.mockRejectedValue(new Error('db down'))
  })

  it('lets a known blog post through without touching the database', async () => {
    vi.useFakeTimers()
    const response = await call(KNOWN_POST)
    expect(isPassThrough(response)).toBe(true)
    expect(postCheck).toHaveBeenCalledWith('chao-mung-den-next-store')
    expect(known).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
    expect(log).not.toHaveBeenCalled()
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
  ])('rewrites an unknown blog slug to the not-found path without touching the database (%s)', async (path) => {
    vi.useFakeTimers()
    const response = await call(path)
    expect(isNotFound(response)).toBe(true)
    expect(known).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
    expect(log).not.toHaveBeenCalled()
  })

  it.each(TRANSPORT_SUFFIXES)('lets the %s transport form of a known post through', async (suffix) => {
    const response = await call(`${KNOWN_POST}${suffix}`)
    expect(isPassThrough(response)).toBe(true)
    expect(postCheck).toHaveBeenCalledWith('chao-mung-den-next-store')
    expect(known).not.toHaveBeenCalled()
  })

  it.each(TRANSPORT_SUFFIXES)('rewrites the %s transport form of an unknown post to not-found', async (suffix) => {
    const response = await call(`/blog/khong-ton-tai${suffix}`)
    expect(isNotFound(response)).toBe(true)
    expect(known).not.toHaveBeenCalled()
  })

  it('never treats a product slug as a post, or a post slug as a product', async () => {
    known.mockResolvedValue(true)
    expect(isNotFound(await call('/blog/ao-git-push-force'))).toBe(true)
    expect(known).not.toHaveBeenCalled()
    known.mockResolvedValue(false)
    expect(isNotFound(await call('/products/chao-mung-den-next-store'))).toBe(true)
    expect(known).toHaveBeenCalledWith('chao-mung-den-next-store')
  })
})

// Open Graph image routes (K10): inside a route group the file gets a hash suffix (`opengraph-image-16g1u1`); without
// the proxy an unknown slug answers a 200 image and leaves a new cache entry. The suffix-less form is covered too: it is
// the route's own name, and Vercel or a later Next.js may serve it.
describe('proxy: open graph image paths', () => {
  const IMAGE_SUFFIXES = ['/opengraph-image-16g1u1', '/opengraph-image-11vtts', '/opengraph-image']

  beforeEach(() => {
    known.mockImplementation(async (slug: string) => slug === 'ao-git-push-force')
  })

  it.each(IMAGE_SUFFIXES)('lets the image %s of a known post and a known product through', async (image) => {
    expect(isPassThrough(await call(`${KNOWN_POST}${image}`))).toBe(true)
    expect(isPassThrough(await call(`${KNOWN_PRODUCT}${image}`))).toBe(true)
    expect(known).toHaveBeenCalledTimes(1)
    expect(known).toHaveBeenCalledWith('ao-git-push-force')
  })

  it.each(IMAGE_SUFFIXES)('rewrites the open graph image %s of an unknown slug', async (image) => {
    expect(isNotFound(await call(`/blog/khong-ton-tai${image}`))).toBe(true)
    expect(known).not.toHaveBeenCalled()
    expect(isNotFound(await call(`/products/khong-ton-tai${image}`))).toBe(true)
    expect(known).toHaveBeenCalledWith('khong-ton-tai')
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
  ])('open graph image path %s → rewritten: %s', async (path, rewritten) => {
    const response = await call(path)
    expect(isNotFound(response)).toBe(rewritten)
    expect(isPassThrough(response)).toBe(!rewritten)
  })

  it('still fails open for a product image when the lookup throws', async () => {
    known.mockRejectedValue(new Error('db down'))
    expect(isPassThrough(await call(`${KNOWN_PRODUCT}/opengraph-image-16g1u1`))).toBe(true)
    expect(log).toHaveBeenCalledTimes(1)
  })

  it(`still fails open for a product image within ${LOOKUP_BOUND_MS} ms when the lookup never settles`, async () => {
    vi.useFakeTimers()
    known.mockReturnValue(new Promise<boolean>(() => {}))
    let settled: Response | undefined
    void call('/products/chua-ai-mo/opengraph-image-16g1u1').then((response) => {
      settled = response
    })
    await vi.advanceTimersByTimeAsync(LOOKUP_BOUND_MS)
    expect(settled && isPassThrough(settled)).toBe(true)
    expect(log).toHaveBeenCalledTimes(1)
  })
})

// M4 decision 11 (C3, NS-92), narrowed by NS-103: a Server Action is a POST to the page that renders it, carrying the
// `next-action` header (Next.js 16.4.6 client/components/app-router-headers.js ACTION_HEADER, read in
// server/lib/server-action-request-meta.js), and the matcher does not filter by method. Only that request goes
// straight on, so "add to cart" never waits for the slug lookup from the edge (up to 400 ms, NS-79). Any other method,
// and a POST without the header, is rendered by Next.js like a GET: it gets the same slug check, or an unknown slug
// would answer 200 and leave a new route cache entry (audit NS-96, ADR-0014 (e)).
describe('proxy: Server Actions and other methods', () => {
  const callWith = (method: string, path: string, headers?: Record<string, string>) =>
    proxy(new NextRequest(`https://shop.test${path}`, { method, headers }))
  const ACTION = { 'next-action': '7f3a9c' }

  beforeEach(() => {
    known.mockRejectedValue(new Error('db down'))
  })

  it.each([KNOWN_PRODUCT, '/products/khong-ton-tai', '/products/KHONG-TON-TAI', `${KNOWN_PRODUCT}.rsc`])(
    'lets a Server Action POST to a product path through without a lookup (%s)',
    async (path) => {
      vi.useFakeTimers()
      const response = await callWith('POST', path, ACTION)
      expect(isPassThrough(response)).toBe(true)
      expect(known).not.toHaveBeenCalled()
      expect(vi.getTimerCount()).toBe(0)
      expect(log).not.toHaveBeenCalled()
    },
  )

  it('lets a Server Action POST to a blog path or an open graph image path through without checking the slug', async () => {
    for (const path of ['/blog/khong-ton-tai', KNOWN_POST, '/products/khong-ton-tai/opengraph-image-16g1u1']) {
      expect(isPassThrough(await callWith('POST', path, ACTION))).toBe(true)
    }
    expect(postCheck).not.toHaveBeenCalled()
    expect(known).not.toHaveBeenCalled()
  })

  // Header names are case-insensitive on the wire; Headers.has matches them all, as Next.js's own headers.get does.
  // An empty value is still a fetch action to Next.js (typeof '' === 'string'), answered before render.
  it.each(['next-action', 'Next-Action', 'NEXT-ACTION', 'nExT-aCtIoN'])('recognises the %s header', async (name) => {
    expect(isPassThrough(await callWith('POST', '/products/khong-ton-tai', { [name]: '7f3a9c' }))).toBe(true)
    expect(known).not.toHaveBeenCalled()
  })

  it('recognises a next-action header with an empty value', async () => {
    expect(isPassThrough(await callWith('POST', '/blog/khong-ton-tai', { 'next-action': '' }))).toBe(true)
    expect(postCheck).not.toHaveBeenCalled()
  })

  it.each(['PUT', 'PATCH', 'DELETE', 'OPTIONS'])('does not take next-action on %s as a Server Action', async (method) => {
    expect(isNotFound(await callWith(method, '/products/KHONG-TON-TAI', ACTION))).toBe(true)
    expect(isNotFound(await callWith(method, '/blog/khong-ton-tai', ACTION))).toBe(true)
    expect(known).not.toHaveBeenCalled()
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
  ])('rewrites a %s %j to an unknown or malformed slug to not-found', async (method, headers) => {
    for (const path of [
      '/products/KHONG-TON-TAI',
      '/products/a..b',
      '/products/Ao%20X',
      '/blog/khong-ton-tai',
      '/blog/constructor',
      '/blog/khong-ton-tai/opengraph-image-11vtts',
    ]) {
      expect(isNotFound(await callWith(method, path, headers))).toBe(true)
    }
    expect(known).not.toHaveBeenCalled()
    known.mockResolvedValue(false)
    expect(isNotFound(await callWith(method, '/products/khong-ton-tai', headers))).toBe(true)
    expect(known).toHaveBeenCalledWith('khong-ton-tai')
  })

  it.each(['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'])('lets %s without next-action to a known slug through', async (method) => {
    known.mockResolvedValue(true)
    expect(isPassThrough(await callWith(method, KNOWN_PRODUCT))).toBe(true)
    expect(known).toHaveBeenCalledWith('ao-git-push-force')
    expect(isPassThrough(await callWith(method, KNOWN_POST))).toBe(true)
    expect(isPassThrough(await callWith(method, `${KNOWN_PRODUCT}/opengraph-image-16g1u1`))).toBe(true)
  })

  it('still fails open for a product POST without next-action when the lookup throws', async () => {
    expect(isPassThrough(await callWith('POST', '/products/sticker-git'))).toBe(true)
    expect(known).toHaveBeenCalledWith('sticker-git')
    expect(log).toHaveBeenCalledTimes(1)
  })

  it.each(['GET', 'HEAD'])('still checks the slug on %s, with or without next-action', async (method) => {
    known.mockResolvedValue(false)
    for (const headers of [{}, ACTION]) {
      expect(isNotFound(await callWith(method, '/products/khong-ton-tai', headers))).toBe(true)
      expect(isNotFound(await callWith(method, '/products/KHONG-TON-TAI', headers))).toBe(true)
      expect(isNotFound(await callWith(method, '/blog/khong-ton-tai', headers))).toBe(true)
    }
    expect(known).toHaveBeenCalledWith('khong-ton-tai')
    known.mockResolvedValue(true)
    expect(isPassThrough(await callWith(method, KNOWN_PRODUCT))).toBe(true)
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
