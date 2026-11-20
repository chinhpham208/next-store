import { unstable_doesMiddlewareMatch } from 'next/experimental/testing/server'
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { isKnownProductSlug } from '@/features/products'
import { config, proxy } from './proxy'

// Only the database lookup is replaced; isProductSlug stays real, so the malformed-slug tests prove the proxy
// itself refuses them before any lookup.
vi.mock('@/features/products', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/products')>()),
  isKnownProductSlug: vi.fn(),
}))

const known = vi.mocked(isKnownProductSlug)
const call = (path: string) => proxy(new NextRequest(`https://shop.test${path}`))
const NOT_FOUND = 'https://shop.test/_khong-tim-thay'
// What the audit asked for (PR #20): well under the 10 s connect_timeout of the database client.
const LOOKUP_BOUND_MS = 500

const isPassThrough = (response: Response) =>
  response.headers.get('x-middleware-next') === '1' && response.headers.get('x-middleware-rewrite') === null

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

describe('config.matcher', () => {
  it('is the constant /products/:slug, so Next.js can analyse it statically', () => {
    expect(config).toEqual({ matcher: '/products/:slug' })
  })

  it.each([
    '/products/ao-git-push-force',
    '/products/khong-ton-tai',
    '/products/khong-ton-tai.rsc',
    '/products/KHONG-TON-TAI',
    '/products/khong%2Dton%2Dtai',
  ])('runs the proxy for %s', (url) => {
    expect(unstable_doesMiddlewareMatch({ config, url })).toBe(true)
  })

  it.each([
    '/',
    '/products',
    '/products?category=ao-thun&page=2',
    '/products/a/b',
    '/khong-ton-tai',
    '/_next/static/chunks/main.js',
    '/_next/image?url=%2Fimages%2Fao-thun.svg&w=640&q=75',
    '/images/ao-thun.svg',
    '/favicon.ico',
  ])('leaves %s alone', (url) => {
    expect(unstable_doesMiddlewareMatch({ config, url })).toBe(false)
  })
})
