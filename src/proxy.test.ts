import { unstable_doesMiddlewareMatch } from 'next/experimental/testing/server'
import { NextRequest, type NextResponse } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { signSession } from '@/features/admin/session'
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
// Product and blog answers are synchronous (only the admin branch awaits Web Crypto): a Promise here is a failure.
const syncAnswer = (answer: ReturnType<typeof proxy>): NextResponse => {
  if (answer instanceof Promise) throw new Error('expected a synchronous answer')
  return answer
}
const call = (path: string) => syncAnswer(proxy(new NextRequest(`https://shop.test${path}`)))
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
    for (const path of [KNOWN_PRODUCT, '/products/khong-ton-tai', KNOWN_POST, '/blog/khong-ton-tai']) {
      expect(proxy(new NextRequest(`https://shop.test${path}`))).not.toBeInstanceOf(Promise)
    }
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
    syncAnswer(proxy(new NextRequest(`https://shop.test${path}`, { method, headers })))
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

// US-12 (ADR-0018, plan M5 Task 8): the admin branch runs first, before the Server Action shortcut, and never touches
// the database (beforeEach makes every query throw; afterEach checks none ran). An optimistic check of the cookie
// alone (D2): the layout and every admin action check again.
describe('proxy: admin', () => {
  // Fake values, test only.
  const PASSWORD = 'test-admin-password-0123'
  const SECRET = 'test-session-secret-0123456789abcdef'
  const COOKIE = '__Host-ns_admin'
  const LOGIN = 'https://shop.test/admin/login'
  const ACTION = { 'next-action': '7f3a9c' }

  const admin = async (path: string, init: { method?: string; headers?: Record<string, string> } = {}) =>
    proxy(new NextRequest(`https://shop.test${path}`, init))
  const withCookie = (cookie: string, init: { method?: string; headers?: Record<string, string> } = {}) => ({
    ...init,
    headers: { ...init.headers, cookie },
  })
  const freshToken = () => signSession({ secret: SECRET, now: new Date() })

  const isLoginRedirect = (response: Response) =>
    response.status === 307 && response.headers.get('location') === LOGIN
  // Every Set-Cookie of the response, one per entry.
  const setCookies = (response: Response) => response.headers.getSetCookie()
  const clears = (response: Response, name: string) =>
    setCookies(response).some(
      (line) => line.startsWith(`${name}=;`) && /Max-Age=0|Expires=Thu, 01 Jan 1970/i.test(line) && /Path=\//.test(line),
    )

  beforeEach(() => {
    vi.stubEnv('SITE_URL', 'https://shop.test')
    vi.stubEnv('ADMIN_PASSWORD', PASSWORD)
    vi.stubEnv('SESSION_SECRET', SECRET)
  })
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('redirects /admin/products without a cookie to /admin/login with 307', async () => {
    const response = await admin('/admin/products')
    expect(isLoginRedirect(response)).toBe(true)
    // Nothing to clear, and no next / returnTo parameter (no open redirect).
    expect(setCookies(response)).toEqual([])
    expect(new URL(response.headers.get('location') ?? '').search).toBe('')
    expect(catalogCheck).not.toHaveBeenCalled()
  })

  it.each([
    '/admin',
    '/admin/',
    '/admin/products',
    '/admin/products/ao-git-push-force',
    '/admin.rsc',
    '/admin/products.rsc',
    '/admin/products.segments/_tree.segment.rsc',
    '/admin/products.segments/_tree.segment',
    '/admin/products/ao-git-push-force.segments/!KHNyb3RlY3RlZCk/admin/products/$d$slug/__PAGE__.segment.rsc',
    '/admin.segments/_tree.segment.rsc',
  ])('redirects GET %s without a session to /admin/login', async (path) => {
    expect(isLoginRedirect(await admin(path))).toBe(true)
    expect(isLoginRedirect(await admin(path, { headers: { rsc: '1' } }))).toBe(true)
  })

  it('treats HEAD like GET', async () => {
    expect(isLoginRedirect(await admin('/admin/products', { method: 'HEAD' }))).toBe(true)
  })

  it('redirects with a tampered cookie and clears it', async () => {
    const token = await freshToken()
    const tampered = `${token.slice(0, -2)}${token.endsWith('AA') ? 'EA' : 'AA'}`
    for (const value of [tampered, 'junk', '']) {
      const response = await admin('/admin/products', withCookie(`${COOKIE}=${value}`))
      expect(isLoginRedirect(response)).toBe(true)
      expect(clears(response, COOKIE)).toBe(true)
    }
  })

  it('clears both cookie names when the request carries both', async () => {
    const response = await admin('/admin/products', withCookie(`${COOKIE}=junk; ns_admin=junk; ns_cart=keep`))
    expect(isLoginRedirect(response)).toBe(true)
    expect(clears(response, COOKIE)).toBe(true)
    expect(clears(response, 'ns_admin')).toBe(true)
    // The __Host- prefix needs Secure and Path=/ on the deleting Set-Cookie too, or the browser ignores it.
    const host = setCookies(response).find((line) => line.startsWith(`${COOKIE}=`)) ?? ''
    expect(host).toMatch(/; Secure/i)
    expect(host).not.toMatch(/Domain=/i)
    // Only admin cookies are touched.
    expect(setCookies(response).some((line) => line.startsWith('ns_cart='))).toBe(false)
  })

  it('redirects with an expired cookie', async () => {
    const nineHoursAgo = new Date(Date.now() - 9 * 60 * 60 * 1000)
    const expired = await signSession({ secret: SECRET, now: nineHoursAgo })
    const response = await admin('/admin/products', withCookie(`${COOKIE}=${expired}`))
    expect(isLoginRedirect(response)).toBe(true)
    expect(clears(response, COOKIE)).toBe(true)
  })

  it('redirects with a token signed by another secret', async () => {
    const foreign = await signSession({ secret: 'other-session-secret-0123456789abcdef', now: new Date() })
    expect(isLoginRedirect(await admin('/admin/products', withCookie(`${COOKIE}=${foreign}`)))).toBe(true)
  })

  it.each([
    '/admin/login',
    '/admin/login.rsc',
    '/admin/login.segments/_tree.segment',
    '/admin/login.segments/_tree.segment.rsc',
    '/admin/login.segments/__PAGE__.segment.rsc',
  ])('lets %s through without a cookie', async (path) => {
    expect(isPassThrough(await admin(path))).toBe(true)
    expect(isPassThrough(await admin(path, withCookie(`${COOKIE}=junk`)))).toBe(true)
  })

  it('lets /admin/login and its RSC forms through without a cookie, for the login action too', async () => {
    expect(isPassThrough(await admin('/admin/login', { method: 'POST', headers: ACTION }))).toBe(true)
    expect(isPassThrough(await admin('/admin/login.rsc', { headers: { rsc: '1' } }))).toBe(true)
  })

  it('lets a valid session through', async () => {
    const cookie = `${COOKIE}=${await freshToken()}`
    for (const path of ['/admin', '/admin/products', '/admin/products/ao-git-push-force', '/admin/products.rsc']) {
      const response = await admin(path, withCookie(cookie))
      expect(isPassThrough(response), path).toBe(true)
      expect(setCookies(response)).toEqual([])
    }
    expect(isPassThrough(await admin('/admin/products', withCookie(cookie, { method: 'POST', headers: ACTION })))).toBe(
      true,
    )
    expect(catalogCheck).not.toHaveBeenCalled()
  })

  it('checks the admin session before the Server Action shortcut', async () => {
    // Before Task 8 this request went straight on: POST + next-action skipped every check (NS-103).
    const response = await admin('/admin/products/x', { method: 'POST', headers: ACTION })
    expect(response.status).toBe(401)
    expect(isPassThrough(response)).toBe(false)
  })

  it('answers 401 to a Server Action on an admin page without a session', async () => {
    for (const path of ['/admin', '/admin/products', '/admin/products/ao-git-push-force', '/admin/products.rsc']) {
      for (const cookie of [undefined, `${COOKIE}=junk`]) {
        const init = { method: 'POST', headers: cookie === undefined ? ACTION : { ...ACTION, cookie } }
        const response = await admin(path, init)
        expect(response.status, path).toBe(401)
        expect(response.headers.get('location')).toBeNull()
        expect(response.headers.get('x-middleware-next')).toBeNull()
        expect(await response.text()).toBe('')
      }
    }
  })

  it.each(['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'])('answers 401 to %s without a session', async (method) => {
    const response = await admin('/admin/products', { method })
    expect(response.status).toBe(401)
    expect(response.headers.get('location')).toBeNull()
  })

  it('does not touch the database for /admin', async () => {
    const cookie = `${COOKIE}=${await freshToken()}`
    await admin('/admin/products')
    await admin('/admin/products', withCookie(cookie))
    await admin('/admin/products', { method: 'POST', headers: ACTION })
    await admin('/admin/login')
    expect(database.imported).toBe(false)
    expect(database.query).not.toHaveBeenCalled()
  })

  it('closes /admin when SESSION_SECRET is missing', async () => {
    const cookie = `${COOKIE}=${await freshToken()}`
    vi.stubEnv('SESSION_SECRET', '')
    const response = await admin('/admin/products', withCookie(cookie))
    expect(isLoginRedirect(response)).toBe(true)
    expect(clears(response, COOKIE)).toBe(true)
    expect((await admin('/admin/products', withCookie(cookie, { method: 'POST', headers: ACTION }))).status).toBe(401)
    // The login page stays reachable: it says the area is not configured.
    expect(isPassThrough(await admin('/admin/login'))).toBe(true)
  })

  it('closes /admin when ADMIN_PASSWORD is missing', async () => {
    const cookie = `${COOKIE}=${await freshToken()}`
    vi.stubEnv('ADMIN_PASSWORD', '')
    expect(isLoginRedirect(await admin('/admin/products', withCookie(cookie)))).toBe(true)
  })

  // Audit PR #104 L4: if a router ever decoded escapes or folded case, these would read as admin pages. The proxy
  // guards them like one, and never takes them for the login page.
  it.each([
    '/%61dmin/products',
    '/admin%2Fproducts',
    '/Admin/products',
    '/ADMIN',
    '/%61dmin/login',
    '/Admin/login',
    '/admin/%6Cogin',
    '/admin%2Flogin',
  ])('guards the non-canonical spelling %s like an admin page', async (path) => {
    expect(isLoginRedirect(await admin(path))).toBe(true)
    expect((await admin(path, { method: 'POST', headers: ACTION })).status).toBe(401)
    expect(catalogCheck).not.toHaveBeenCalled()
    expect(postCheck).not.toHaveBeenCalled()
  })

  it('never logs', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const plain = vi.spyOn(console, 'log').mockImplementation(() => {})
    await admin('/admin/products', withCookie(`${COOKIE}=junk`))
    await admin('/admin/products', { method: 'POST', headers: ACTION })
    await admin('/admin/products', withCookie(`${COOKIE}=${await freshToken()}`))
    for (const spy of [info, warn, plain]) expect(spy).not.toHaveBeenCalled()
  })

  it('leaves product and blog answers as they were', () => {
    expect(isPassThrough(call(KNOWN_PRODUCT))).toBe(true)
    expect(isNotFound(call('/products/khong-ton-tai'))).toBe(true)
    expect(isPassThrough(call(KNOWN_POST))).toBe(true)
  })
})

describe('config.matcher', () => {
  it('is a constant list, so Next.js can analyse it statically', () => {
    expect(config).toEqual({
      matcher: ['/admin', '/admin/:path*', '/products/:slug', '/products/:slug/:image', '/blog/:slug', '/blog/:slug/:image'],
    })
  })

  it.each([
    '/admin',
    '/admin/',
    '/admin.rsc',
    '/admin.segments/_tree.segment.rsc',
    '/admin/login',
    '/admin/login.rsc',
    '/admin/login.segments/_tree.segment.rsc',
    '/admin/products',
    '/admin/products.rsc',
    '/admin/products/ao-git-push-force',
    '/admin/products/ao-git-push-force.segments/_tree.segment.rsc',
  ])('runs the proxy for the admin path %s', (url) => {
    expect(unstable_doesMiddlewareMatch({ config, url })).toBe(true)
  })

  it.each(['/administrator', '/admins', '/admin-x', '/products/admin/x/y'])('leaves %s alone', (url) => {
    expect(unstable_doesMiddlewareMatch({ config, url })).toBe(false)
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
