import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  cartCookieName,
  cartCookieOptions,
  clearCartId,
  isSecureSite,
  readCartId,
  writeCartId,
} from '@/features/cart/cookie'
import { getCart, getCartCount } from '@/features/cart/queries'
import { cartIdSchema } from '@/features/cart/schema'

// The cookie store of the current request: get() reads the incoming cookies, set() / delete() record what the
// response would send.
const jar = vi.hoisted(() => ({
  incoming: new Map<string, string>(),
  get: vi.fn(),
  set: vi.fn(),
  delete: vi.fn(),
}))

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({
    get: (name: string) => {
      jar.get(name)
      const value = jar.incoming.get(name)
      return value === undefined ? undefined : { name, value }
    },
    set: jar.set,
    delete: jar.delete,
  })),
}))

// Spy, not the real wrapper: a malformed cookie must be refused before any query is even attempted.
const dbQuery = vi.hoisted(() => vi.fn())
vi.mock('@/db', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/db')>()), dbQuery }))

const HTTPS_SITE = 'https://shop.example.vn'
const HTTP_SITE = 'http://localhost:3100'

beforeEach(() => {
  jar.incoming.clear()
  vi.stubEnv('SITE_URL', HTTP_SITE)
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.clearAllMocks()
})

describe('cookie options', () => {
  it('cartCookieOptions sets httpOnly, lax, path /, 30-day maxAge', () => {
    for (const secure of [true, false]) {
      const options = cartCookieOptions(secure)
      expect(options).toEqual({ httpOnly: true, sameSite: 'lax', path: '/', secure, maxAge: 2_592_000 })
      expect(options).not.toHaveProperty('domain')
    }
  })

  it('uses the __Host- name only on an https site', () => {
    expect(cartCookieName(true)).toBe('__Host-ns_cart')
    expect(cartCookieName(false)).toBe('ns_cart')

    vi.stubEnv('SITE_URL', HTTPS_SITE)
    expect(isSecureSite()).toBe(true)
    vi.stubEnv('SITE_URL', HTTP_SITE)
    expect(isSecureSite()).toBe(false)
  })
})

describe('readCartId', () => {
  it('reads a valid cart id', async () => {
    const id = crypto.randomUUID()
    jar.incoming.set('ns_cart', id)
    expect(await readCartId()).toBe(id)
  })

  it('returns null without a cookie', async () => {
    expect(await readCartId()).toBeNull()
  })

  it.each([
    ['x', 'x'],
    ['a UUID v1', 'c232ab00-9414-11ec-b3c8-9f6bdeced846'],
    ['an upper-case UUID with spaces', ' 3F2504E0-4F89-41D3-9A0C-0305E82C3301 '],
    ['a 10 KB string', 'a'.repeat(10 * 1024)],
    ['an empty string', ''],
  ])('readCartId ignores a malformed value without a query (%s)', async (_label, value) => {
    jar.incoming.set('ns_cart', value)
    expect(await readCartId()).toBeNull()
    expect(await getCartCount()).toBe(0)
    expect(await getCart()).toEqual({ lines: [], count: 0, total: 0 })
    expect(dbQuery).not.toHaveBeenCalled()
  })

  it('reads the cookie of the current scheme only', async () => {
    vi.stubEnv('SITE_URL', HTTPS_SITE)
    jar.incoming.set('ns_cart', crypto.randomUUID())
    expect(await readCartId()).toBeNull()

    vi.stubEnv('SITE_URL', HTTP_SITE)
    jar.incoming.clear()
    jar.incoming.set('__Host-ns_cart', crypto.randomUUID())
    expect(await readCartId()).toBeNull()
  })

  it('reads __Host-ns_cart on an https site', async () => {
    vi.stubEnv('SITE_URL', HTTPS_SITE)
    const id = crypto.randomUUID()
    jar.incoming.set('__Host-ns_cart', id)
    expect(await readCartId()).toBe(id)
  })
})

describe('queries without a cart', () => {
  it('reads an empty cart without a query when there is no cookie', async () => {
    expect(await getCart()).toEqual({ lines: [], count: 0, total: 0 })
    expect(await getCartCount()).toBe(0)
    expect(dbQuery).not.toHaveBeenCalled()
  })
})

describe('writeCartId and clearCartId', () => {
  it('sets the cookie with the cart options under the scheme name', async () => {
    const id = cartIdSchema.parse(crypto.randomUUID())
    vi.stubEnv('SITE_URL', HTTPS_SITE)
    await writeCartId(id)
    expect(jar.set).toHaveBeenCalledWith('__Host-ns_cart', id, cartCookieOptions(true))

    vi.stubEnv('SITE_URL', HTTP_SITE)
    await writeCartId(id)
    expect(jar.set).toHaveBeenLastCalledWith('ns_cart', id, cartCookieOptions(false))
  })

  it('clears the cookie with the same name, path and secure flag, and no maxAge', async () => {
    vi.stubEnv('SITE_URL', HTTPS_SITE)
    await clearCartId()
    // A __Host- cookie is only replaced by a Set-Cookie that is Secure with Path=/; a maxAge here would turn the
    // deletion (expires in 1970) back into a 30-day cookie.
    expect(jar.delete).toHaveBeenCalledWith({
      name: '__Host-ns_cart',
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      secure: true,
    })
  })
})
