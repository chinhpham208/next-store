import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { carts, orders } from '@/db'
import { db } from '@/db/client'
import { runMigrations } from '@/db/migrate'
import { getOrderByRef } from '@/features/orders/queries'
import type { OrderItem } from '@/features/orders/types'

const calls = vi.hoisted(() => ({ names: [] as string[] }))
vi.mock('@/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/db')>()
  const dbQuery: typeof actual.dbQuery = (input) => {
    calls.names.push(input.name)
    return actual.dbQuery(input)
  }
  return { ...actual, dbQuery }
})

const CART_ID = '4f0c1c4e-2f43-4a0e-8d52-5d6a3b8a9c11'
const REF = 'fake_abcdef12'
const ITEMS: OrderItem[] = [
  { productId: 1, slug: 'ao-git-push-force', name: 'Áo thun', price: 199000, quantity: 2, lineTotal: 398000 },
]

const insertOrder = async (items: unknown = ITEMS, provider = 'fake') => {
  await db.insert(carts).values({ id: CART_ID })
  await db
    .insert(orders)
    .values({ items, total: 398000, status: 'pending', provider, paymentRef: REF, cartId: CART_ID })
}

beforeAll(async () => {
  await runMigrations()
})

beforeEach(async () => {
  await db.delete(orders)
  await db.delete(carts)
  calls.names = []
})

describe('getOrderByRef', () => {
  it('getOrderByRef returns null for a malformed ref without querying', async () => {
    for (const ref of ['short', "x'; drop table orders; --", 42, null, undefined, 'a'.repeat(65)]) {
      expect(await getOrderByRef(ref)).toBeNull()
    }
    expect(calls.names).toEqual([])
  })

  it('getOrderByRef returns the order with parsed items', async () => {
    await insertOrder()
    const order = await getOrderByRef(REF)
    expect(order).toMatchObject({
      status: 'pending',
      refundReason: null,
      total: 398000,
      items: ITEMS,
      provider: 'fake',
      cartId: CART_ID,
    })
    expect(typeof order?.id).toBe('number')
    expect(calls.names).toEqual(['orders.by-ref'])
  })

  it('returns null for a well-formed ref that names no order', async () => {
    expect(await getOrderByRef('fake_unknown1')).toBeNull()
  })

  it('throws a fixed message when the stored items are invalid', async () => {
    await insertOrder([{ productId: 'x' }])
    await expect(getOrderByRef(REF)).rejects.toThrow('orders: stored items are invalid')
  })

  it('throws a fixed message when the stored provider is unknown', async () => {
    await insertOrder(ITEMS, 'payos')
    await expect(getOrderByRef(REF)).rejects.toThrow('orders: stored provider is unknown')
  })
})
