import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getCart, getCartCount } from '@/features/cart/queries'

// NS-104 (audit NS-96): new Date() before the render has waited for a request logs blocking-prerender-current-time
// (as M2 K7). connection() is the wait. The mock moves the clock, so a `now` read before it shows up as the
// earlier time.
const BEFORE = new Date('2026-11-24T00:00:00.000Z')
const AFTER = new Date('2026-11-24T00:00:05.000Z')

const order = vi.hoisted(() => [] as string[])
vi.mock('next/server', () => ({
  connection: vi.fn(async () => {
    order.push('connection')
    vi.setSystemTime(AFTER)
  }),
}))

const CART_ID = '7d3c6f9e-1b2a-4c5d-8e9f-0a1b2c3d4e5f'
const cookie = vi.hoisted(() => ({ readCartId: vi.fn() }))
vi.mock('@/features/cart/cookie', () => cookie)

const store = vi.hoisted(() => ({ readCartLines: vi.fn(), countCartItems: vi.fn() }))
vi.mock('@/features/cart/store', () => store)

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(BEFORE)
  order.length = 0
  cookie.readCartId.mockResolvedValue(CART_ID)
  store.readCartLines.mockImplementation(async () => {
    order.push('query')
    return []
  })
  store.countCartItems.mockImplementation(async () => {
    order.push('query')
    return 0
  })
})
afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe('cart queries read the clock only at request time', () => {
  it('getCart waits for connection() before new Date()', async () => {
    await getCart()
    expect(order).toEqual(['connection', 'query'])
    expect(store.readCartLines).toHaveBeenCalledWith(CART_ID, AFTER)
  })

  it('getCartCount waits for connection() before new Date()', async () => {
    await getCartCount()
    expect(order).toEqual(['connection', 'query'])
    expect(store.countCartItems).toHaveBeenCalledWith(CART_ID, AFTER)
  })

  it('without a cart cookie reads neither the clock nor the database', async () => {
    cookie.readCartId.mockResolvedValue(null)
    expect(await getCart()).toEqual({ lines: [], count: 0, total: 0 })
    expect(await getCartCount()).toBe(0)
    expect(order).toEqual([])
  })
})
