import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { addToCartAction } from '@/features/cart/actions'
import { cartCookieOptions } from '@/features/cart/cookie'
import { cartIdSchema } from '@/features/cart/schema'
import type { AddLineResult } from '@/features/cart/store'

// The cookie store of the current request: `incoming` is what the browser sent, set() / delete() what the
// response would send.
const jar = vi.hoisted(() => ({ incoming: new Map<string, string>(), set: vi.fn(), delete: vi.fn() }))
vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({
    get: (name: string) => {
      const value = jar.incoming.get(name)
      return value === undefined ? undefined : { name, value }
    },
    set: jar.set,
    delete: jar.delete,
  })),
}))

const refresh = vi.hoisted(() => vi.fn())
vi.mock('next/cache', () => ({ refresh }))

// The store runs on PGlite in store.test.ts; here only what the action does with its answers matters.
const store = vi.hoisted(() => ({ addLine: vi.fn(), purgeExpiredCarts: vi.fn() }))
vi.mock('@/features/cart/store', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/cart/store')>()),
  addLine: store.addLine,
  purgeExpiredCarts: store.purgeExpiredCarts,
}))

const SLUG = 'ao-git-push-force'
const COOKIE = 'ns_cart'

const timedOut = () =>
  Object.assign(new Error('database query timed out: cart.add'), { code: 'DB_QUERY_TIMEOUT' })

beforeEach(() => {
  jar.incoming.clear()
  vi.stubEnv('SITE_URL', 'http://localhost:3100')
  store.addLine.mockResolvedValue({ ok: true, count: 1 } satisfies AddLineResult)
  store.purgeExpiredCarts.mockResolvedValue(undefined)
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.clearAllMocks()
  vi.restoreAllMocks()
})

describe('addToCartAction input', () => {
  it.each([
    ['null', null],
    ['an empty object', {}],
    ['quantity 0', { slug: SLUG, quantity: 0 }],
    ['quantity "1"', { slug: SLUG, quantity: '1' }],
    ['an extra key', { slug: SLUG, quantity: 1, extra: 1 }],
    ['a cart id from the client', { slug: SLUG, quantity: 1, cartId: crypto.randomUUID() }],
    ['quantity 11', { slug: SLUG, quantity: 11 }],
    ['a malformed slug', { slug: 'Ao', quantity: 1 }],
  ])('returns invalid without touching cookies or the database (%s)', async (_label, input) => {
    jar.incoming.set(COOKIE, crypto.randomUUID())
    expect(await addToCartAction(input)).toEqual({ ok: false, error: 'invalid' })
    expect(store.addLine).not.toHaveBeenCalled()
    expect(store.purgeExpiredCarts).not.toHaveBeenCalled()
    expect(jar.set).not.toHaveBeenCalled()
    expect(jar.delete).not.toHaveBeenCalled()
    expect(refresh).not.toHaveBeenCalled()
    const { cookies } = await import('next/headers')
    expect(cookies).not.toHaveBeenCalled()
  })
})

describe('addToCartAction with a cart', () => {
  it('adds to the cart of the cookie', async () => {
    const id = crypto.randomUUID()
    jar.incoming.set(COOKIE, id)
    store.addLine.mockResolvedValue({ ok: true, count: 4 })

    expect(await addToCartAction({ slug: SLUG, quantity: 2 })).toEqual({ ok: true, count: 4 })
    expect(store.addLine).toHaveBeenCalledTimes(1)
    expect(store.addLine).toHaveBeenCalledWith({
      cartId: id,
      slug: SLUG,
      quantity: 2,
      create: false,
      now: expect.any(Date),
    })
    expect(store.purgeExpiredCarts).not.toHaveBeenCalled()
  })

  it('sets the cookie with the cart options after a successful add', async () => {
    const id = crypto.randomUUID()
    jar.incoming.set(COOKIE, id)
    await addToCartAction({ slug: SLUG, quantity: 1 })
    // Set again on every add: Max-Age slides with carts.updated_at (ADR-0014 6A), and setting a cookie makes Next
    // render the page again in the same response (plan M4 D2, C4).
    expect(jar.set).toHaveBeenCalledTimes(1)
    expect(jar.set).toHaveBeenCalledWith(COOKIE, id, cartCookieOptions(false))
  })

  it('uses the __Host- cookie on an https site', async () => {
    vi.stubEnv('SITE_URL', 'https://shop.example.vn')
    const id = crypto.randomUUID()
    jar.incoming.set('__Host-ns_cart', id)
    await addToCartAction({ slug: SLUG, quantity: 1 })
    expect(store.addLine).toHaveBeenCalledWith(expect.objectContaining({ cartId: id, create: false }))
    expect(jar.set).toHaveBeenCalledWith('__Host-ns_cart', id, cartCookieOptions(true))
  })

  it.each<AddLineResult>([
    { ok: false, error: 'over-stock', available: 3 },
    { ok: false, error: 'out-of-stock' },
    { ok: false, error: 'line-limit' },
    { ok: false, error: 'cart-full' },
    { ok: false, error: 'not-found' },
  ])('does not set the cookie when the add is refused ($error)', async (refused) => {
    jar.incoming.set(COOKIE, crypto.randomUUID())
    store.addLine.mockResolvedValue(refused)
    expect(await addToCartAction({ slug: SLUG, quantity: 1 })).toEqual(refused)
    expect(jar.set).not.toHaveBeenCalled()
    expect(jar.delete).not.toHaveBeenCalled()
    // A refusal changes nothing, so the page needs no new render (C4: no cookie, no refresh, no RSC payload).
    expect(refresh).not.toHaveBeenCalled()
    expect(store.purgeExpiredCarts).not.toHaveBeenCalled()
  })
})

describe('addToCartAction without a live cart', () => {
  it('creates a cart with a new server id when there is no cookie', async () => {
    store.addLine.mockResolvedValue({ ok: true, count: 1 })
    expect(await addToCartAction({ slug: SLUG, quantity: 1 })).toEqual({ ok: true, count: 1 })
    expect(store.addLine).toHaveBeenCalledTimes(1)
    const [[call]] = store.addLine.mock.calls as [[{ cartId: string; create: boolean }]]
    expect(call.create).toBe(true)
    expect(cartIdSchema.safeParse(call.cartId).success).toBe(true)
    expect(jar.set).toHaveBeenCalledWith(COOKIE, call.cartId, cartCookieOptions(false))
  })

  it('treats a malformed cookie as no cart', async () => {
    jar.incoming.set(COOKIE, 'not-a-uuid')
    await addToCartAction({ slug: SLUG, quantity: 1 })
    expect(store.addLine).toHaveBeenCalledTimes(1)
    expect(store.addLine).toHaveBeenCalledWith(expect.objectContaining({ create: true }))
    expect(store.addLine.mock.calls[0]?.[0]).not.toMatchObject({ cartId: 'not-a-uuid' })
  })

  it('never inserts a cart with the id from the cookie', async () => {
    const stale = crypto.randomUUID()
    jar.incoming.set(COOKIE, stale)
    store.addLine
      .mockResolvedValueOnce({ ok: false, error: 'missing-cart' } satisfies AddLineResult)
      .mockResolvedValueOnce({ ok: true, count: 1 } satisfies AddLineResult)

    expect(await addToCartAction({ slug: SLUG, quantity: 1 })).toEqual({ ok: true, count: 1 })
    expect(store.addLine).toHaveBeenCalledTimes(2)
    const [first, second] = store.addLine.mock.calls.map(([input]) => input as { cartId: string; create: boolean })
    expect(first).toMatchObject({ cartId: stale, create: false })
    expect(second?.create).toBe(true)
    expect(second?.cartId).not.toBe(stale)
    expect(cartIdSchema.safeParse(second?.cartId).success).toBe(true)
    // Both attempts of one request use one clock, so the cutoff and updated_at agree.
    expect((second as unknown as { now: Date }).now).toBe((first as unknown as { now: Date }).now)
    expect(jar.set).toHaveBeenCalledWith(COOKIE, second?.cartId, cartCookieOptions(false))
  })

  it('creates no cart and sets no cookie when the first add is refused', async () => {
    store.addLine.mockResolvedValue({ ok: false, error: 'over-stock', available: 3 } satisfies AddLineResult)
    expect(await addToCartAction({ slug: SLUG, quantity: 4 })).toEqual({
      ok: false,
      error: 'over-stock',
      available: 3,
    })
    expect(jar.set).not.toHaveBeenCalled()
    expect(store.purgeExpiredCarts).not.toHaveBeenCalled()
  })

  it('purges expired carts only when a new cart was created', async () => {
    await addToCartAction({ slug: SLUG, quantity: 1 })
    expect(store.purgeExpiredCarts).toHaveBeenCalledTimes(1)
    const [[now]] = store.purgeExpiredCarts.mock.calls as [[Date]]
    expect(now).toBe((store.addLine.mock.calls[0]?.[0] as { now: Date }).now)

    vi.clearAllMocks()
    jar.incoming.set(COOKIE, crypto.randomUUID())
    await addToCartAction({ slug: SLUG, quantity: 1 })
    expect(store.purgeExpiredCarts).not.toHaveBeenCalled()
  })

  it('purges after the cookie of the new cart is set', async () => {
    const order: string[] = []
    jar.set.mockImplementation(() => order.push('set cookie'))
    store.purgeExpiredCarts.mockImplementation(async () => {
      order.push('purge')
    })
    await addToCartAction({ slug: SLUG, quantity: 1 })
    expect(order).toEqual(['set cookie', 'purge'])
  })

  it('ignores a purge failure', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    store.purgeExpiredCarts.mockRejectedValue(
      Object.assign(new Error('database query failed: cart.purge (57014)'), { code: '57014' }),
    )
    expect(await addToCartAction({ slug: SLUG, quantity: 1 })).toEqual({ ok: true, count: 1 })
    expect(jar.set).toHaveBeenCalledTimes(1)
    // The add succeeded: nothing to re-render beyond what the cookie already triggers.
    expect(refresh).not.toHaveBeenCalled()
    expect([...error.mock.calls, ...warn.mock.calls]).toEqual([['cart: purge of expired carts failed']])
  })
})

describe('addToCartAction when the database fails', () => {
  it('returns unavailable and refreshes on a timed-out write', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    jar.incoming.set(COOKIE, crypto.randomUUID())
    store.addLine.mockRejectedValue(timedOut())
    expect(await addToCartAction({ slug: SLUG, quantity: 1 })).toEqual({ ok: false, error: 'unavailable' })
    // Written or not is unknown (ADR-0011): a new render shows what the database holds.
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(jar.set).not.toHaveBeenCalled()
  })

  it('does not retry after DB_QUERY_TIMEOUT', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    jar.incoming.set(COOKIE, crypto.randomUUID())
    store.addLine.mockRejectedValue(timedOut())
    await addToCartAction({ slug: SLUG, quantity: 1 })
    expect(store.addLine).toHaveBeenCalledTimes(1)

    vi.clearAllMocks()
    jar.incoming.clear()
    store.addLine.mockRejectedValue(timedOut())
    await addToCartAction({ slug: SLUG, quantity: 1 })
    expect(store.addLine).toHaveBeenCalledTimes(1)
    expect(store.purgeExpiredCarts).not.toHaveBeenCalled()
  })

  it('returns unavailable when the retry with a new cart fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    jar.incoming.set(COOKIE, crypto.randomUUID())
    store.addLine
      .mockResolvedValueOnce({ ok: false, error: 'missing-cart' } satisfies AddLineResult)
      .mockRejectedValueOnce(new Error('database query failed: cart.add (CONNECTION_ENDED)'))
    expect(await addToCartAction({ slug: SLUG, quantity: 1 })).toEqual({ ok: false, error: 'unavailable' })
    expect(store.addLine).toHaveBeenCalledTimes(2)
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(jar.set).not.toHaveBeenCalled()
  })

  it('never throws a business error', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const outcomes: (() => Promise<AddLineResult>)[] = [
      async () => ({ ok: false, error: 'over-stock', available: 3 }),
      async () => ({ ok: false, error: 'out-of-stock' }),
      async () => ({ ok: false, error: 'line-limit' }),
      async () => ({ ok: false, error: 'cart-full' }),
      async () => ({ ok: false, error: 'not-found' }),
      // missing-cart from a cart just created cannot happen; if it did, it is not shown as is.
      async () => ({ ok: false, error: 'missing-cart' }),
      async () => Promise.reject(timedOut()),
      async () => Promise.reject(new Error('database query failed: cart.add')),
    ]
    for (const outcome of outcomes) {
      store.addLine.mockImplementation(outcome)
      const result = await addToCartAction({ slug: SLUG, quantity: 1 })
      expect(result.ok).toBe(false)
      expect(result).not.toHaveProperty('error', 'missing-cart')
    }
  })

  it('never logs the cart id or the cookie value', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) =>
      vi.spyOn(console, method).mockImplementation(() => {}),
    )
    const id = crypto.randomUUID()
    jar.incoming.set(COOKIE, id)
    store.addLine.mockResolvedValueOnce({ ok: false, error: 'missing-cart' }).mockRejectedValueOnce(timedOut())
    await addToCartAction({ slug: SLUG, quantity: 1 })
    store.addLine.mockResolvedValue({ ok: true, count: 1 })
    store.purgeExpiredCarts.mockRejectedValue(new Error('database query failed: cart.purge'))
    jar.incoming.clear()
    await addToCartAction({ slug: SLUG, quantity: 1 })

    const newIds = store.addLine.mock.calls.map(([input]) => (input as { cartId: string }).cartId)
    const printed = spies.flatMap((spy) => spy.mock.calls.flat())
    expect(printed.length).toBeGreaterThan(0)
    for (const argument of printed) {
      // Fixed strings only: no Error object, no id, no cookie value.
      expect(typeof argument).toBe('string')
      for (const secret of [id, ...newIds]) expect(argument).not.toContain(secret)
    }
  })
})
