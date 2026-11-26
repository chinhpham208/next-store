import { eq, sql } from 'drizzle-orm'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { cartItems, carts, dbQuery as realDbQuery, products } from '@/db'
import { db } from '@/db/client'
import { runMigrations } from '@/db/migrate'
import { seed } from '@/db/seed'
import { PRODUCT_SEEDS } from '@/db/seed-data'
import { updateProductAction } from '@/features/products/actions'
import { PRODUCT_SLUGS_TAG, tagsForProductWrite } from '@/features/products/cache-tags'
import { decrementStockForOrder } from '@/features/products/stock'
import type { ProductEditState } from '@/features/products/types'

const updateTag = vi.hoisted(() => vi.fn())
vi.mock('next/cache', () => ({ updateTag }))

const session = vi.hoisted(() => ({ hasAdminSession: vi.fn<() => Promise<boolean>>() }))
vi.mock('@/features/admin', () => ({ hasAdminSession: session.hasAdminSession }))

// The real dbQuery on PGlite, wrapped to see each call and, from call number `failFrom` on, to answer as a timed-out
// write would: the statement may or may not have run (ADR-0011).
const calls = vi.hoisted(() => ({ names: [] as string[], failFrom: undefined as number | undefined }))
vi.mock('@/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/db')>()
  const dbQuery: typeof actual.dbQuery = (input) => {
    calls.names.push(input.name)
    if (calls.failFrom !== undefined && calls.names.length >= calls.failFrom) {
      return Promise.reject(Object.assign(new Error(`database query timed out: ${input.name}`), { code: 'DB_QUERY_TIMEOUT' }))
    }
    return actual.dbQuery(input)
  }
  return { ...actual, dbQuery }
})

const SLUG = 'ao-git-push-force'
const OTHER = PRODUCT_SEEDS.find((product) => product.slug !== SLUG)?.slug ?? ''
const IDLE: ProductEditState = { status: 'idle' }

// updated_at as the form carries it: UTC, to the microsecond.
const updatedAtOf = async (slug: string): Promise<string> => {
  const [row] = await db
    .select({ at: sql<string>`to_char(${products.updatedAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')` })
    .from(products)
    .where(eq(products.slug, slug))
  if (row === undefined) throw new Error(`no product ${slug}`)
  return row.at
}

const rowOf = async (slug: string) => {
  const [row] = await db.select().from(products).where(eq(products.slug, slug))
  if (row === undefined) throw new Error(`no product ${slug}`)
  return row
}

const edit = async (fields: Record<string, string> = {}, slug = SLUG) => {
  const data = new FormData()
  const values: Record<string, string> = {
    slug,
    expectedUpdatedAt: await updatedAtOf(slug),
    name: 'Áo git push --force (bản mới)',
    price: '250000',
    description: 'Mô tả mới.',
    stock: '7',
    ...fields,
  }
  for (const [key, value] of Object.entries(values)) data.set(key, value)
  return data
}

beforeAll(async () => {
  await runMigrations()
})

beforeEach(async () => {
  // Every test starts from the seed: put each seeded product back as it was.
  await db.delete(carts)
  for (const product of PRODUCT_SEEDS) {
    await db
      .update(products)
      .set({ name: product.name, price: product.price, description: product.description, stock: product.stock })
      .where(eq(products.slug, product.slug))
  }
  await seed()
  calls.names = []
  calls.failFrom = undefined
  session.hasAdminSession.mockResolvedValue(true)
})

afterEach(() => {
  vi.clearAllMocks()
  vi.restoreAllMocks()
})

describe('updateProductAction (US-13, ADR-0019)', () => {
  it('US-13: saves a new price', async () => {
    const state = await updateProductAction(IDLE, await edit({ price: '210000' }))
    expect(state).toEqual({ status: 'saved', updatedAt: await updatedAtOf(SLUG) })
    const row = await rowOf(SLUG)
    expect(row).toMatchObject({ price: 210000, name: 'Áo git push --force (bản mới)', description: 'Mô tả mới.', stock: 7 })
    expect(calls.names).toEqual(['products.admin-update'])
  })

  it('returns an updatedAt that the next save of the same form accepts', async () => {
    const first = await updateProductAction(IDLE, await edit({ price: '210000' }))
    if (first.status !== 'saved') throw new Error('first save failed')
    const data = await edit({ price: '220000' })
    data.set('expectedUpdatedAt', first.updatedAt)
    expect(await updateProductAction(first, data)).toMatchObject({ status: 'saved' })
    expect((await rowOf(SLUG)).price).toBe(220000)
  })

  it('moves updated_at forward, explicitly', async () => {
    const before = await rowOf(SLUG)
    await updateProductAction(IDLE, await edit())
    expect((await rowOf(SLUG)).updatedAt.getTime()).toBeGreaterThanOrEqual(before.updatedAt.getTime())
    expect(await updatedAtOf(SLUG)).not.toBe(before.updatedAt.toISOString())
  })

  it('an admin form opened before a checkout gets conflict', async () => {
    // The form is open: it carries the updated_at of this moment.
    const form = await edit({ stock: '50' })
    const opened = await rowOf(SLUG)
    // A checkout decrements the stock while the form is open.
    const result = await realDbQuery({
      name: 'products.stock-decrement-test',
      transaction: (tx) => decrementStockForOrder(tx, [{ productId: opened.id, quantity: 2 }]),
    })
    expect(result).toEqual({ ok: true, slugs: [SLUG] })
    const afterCheckout = await rowOf(SLUG)
    expect(afterCheckout.stock).toBe(opened.stock - 2)

    expect(await updateProductAction(IDLE, form)).toEqual({ status: 'error', error: 'conflict' })
    // The stock after the checkout stands: the stale form did not write its 50 over it.
    expect((await rowOf(SLUG)).stock).toBe(opened.stock - 2)
    expect(updateTag).not.toHaveBeenCalled()
  })

  it('US-13: refuses a negative price with a field error and writes nothing', async () => {
    const before = await rowOf(SLUG)
    expect(await updateProductAction(IDLE, await edit({ price: '-1' }))).toEqual({
      status: 'invalid',
      fieldErrors: { price: 'negative' },
    })
    expect(await rowOf(SLUG)).toEqual(before)
    expect(calls.names).toEqual([])
    expect(updateTag).not.toHaveBeenCalled()
  })

  it('US-13: refuses an empty name with a field error and writes nothing', async () => {
    const before = await rowOf(SLUG)
    expect(await updateProductAction(IDLE, await edit({ name: '   ' }))).toEqual({
      status: 'invalid',
      fieldErrors: { name: 'empty' },
    })
    expect(await rowOf(SLUG)).toEqual(before)
    expect(calls.names).toEqual([])
  })

  it('refuses a stale or forged form as a form error, writing nothing', async () => {
    expect(await updateProductAction(IDLE, await edit({ expectedUpdatedAt: 'hôm qua' }))).toEqual({
      status: 'invalid',
      fieldErrors: {},
      formError: 'invalid',
    })
    // Called with anything but FormData (the action is a public POST).
    expect(await updateProductAction(IDLE, { slug: SLUG } as unknown as FormData)).toEqual({
      status: 'invalid',
      fieldErrors: {},
      formError: 'invalid',
    })
    expect(calls.names).toEqual([])
  })

  // Audit PR #107 L-1: measured, the year 0 reached Postgres, which threw: unavailable, two updateTag and a log line.
  it('refuses the year 0000 as a form error without the database, updateTag or a log', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await updateProductAction(IDLE, await edit({ expectedUpdatedAt: '0000-01-01T00:00:00.000000Z' }))).toEqual({
      status: 'invalid',
      fieldErrors: {},
      formError: 'invalid',
    })
    expect(calls.names).toEqual([])
    expect(updateTag).not.toHaveBeenCalled()
    expect(log).not.toHaveBeenCalled()
  })

  it('refuses without a session before parsing or touching the database', async () => {
    session.hasAdminSession.mockResolvedValue(false)
    const data = await edit({ price: '1' })
    const get = vi.spyOn(data, 'get')
    expect(await updateProductAction(IDLE, data)).toEqual({ status: 'error', error: 'unauthorized' })
    expect(get).not.toHaveBeenCalled()
    expect(calls.names).toEqual([])
    expect(updateTag).not.toHaveBeenCalled()
    expect((await rowOf(SLUG)).price).not.toBe(1)
  })

  it('updates only the edited product', async () => {
    const other = await rowOf(OTHER)
    await updateProductAction(IDLE, await edit())
    expect(await rowOf(OTHER)).toEqual(other)
  })

  it('invalidates product:<slug> and products, never product-slugs', async () => {
    await updateProductAction(IDLE, await edit())
    expect(updateTag.mock.calls.map(([tag]) => tag)).toEqual([...tagsForProductWrite({ slug: SLUG, change: 'fields' })])
    expect(updateTag.mock.calls.map(([tag]) => tag)).toEqual([`product:${SLUG}`, 'products'])
    expect(updateTag).not.toHaveBeenCalledWith(PRODUCT_SLUGS_TAG)
  })

  it('reports a conflict when the product changed since the form loaded', async () => {
    const stale = await edit({ price: '111000' })
    // Another tab saves first.
    expect(await updateProductAction(IDLE, await edit({ price: '222000' }))).toMatchObject({ status: 'saved' })
    updateTag.mockClear()
    calls.names = []
    expect(await updateProductAction(IDLE, stale)).toEqual({ status: 'error', error: 'conflict' })
    expect((await rowOf(SLUG)).price).toBe(222000)
    expect(calls.names).toEqual(['products.admin-update', 'products.admin-exists'])
    expect(updateTag).not.toHaveBeenCalled()
  })

  it('reports a conflict for a timestamp one microsecond off', async () => {
    const data = await edit()
    const at = await updatedAtOf(SLUG)
    const micro = Number(at.slice(20, 26))
    data.set('expectedUpdatedAt', `${at.slice(0, 20)}${String((micro + 1) % 1_000_000).padStart(6, '0')}Z`)
    expect(await updateProductAction(IDLE, data)).toEqual({ status: 'error', error: 'conflict' })
  })

  it('reports not-found for an unknown slug', async () => {
    const data = await edit()
    data.set('slug', 'khong-co-san-pham-nay')
    expect(await updateProductAction(IDLE, data)).toEqual({ status: 'error', error: 'not-found' })
    expect(calls.names).toEqual(['products.admin-update', 'products.admin-exists'])
    expect(updateTag).not.toHaveBeenCalled()
  })

  it('does not change the slug, image, category or featured', async () => {
    const before = await rowOf(SLUG)
    const data = await edit()
    data.set('image', '/evil.png')
    data.set('categoryId', '999')
    data.set('featured', 'false')
    data.set('newSlug', 'doi-slug')
    await updateProductAction(IDLE, data)
    const after = await rowOf(SLUG)
    expect({ id: after.id, slug: after.slug, image: after.image, categoryId: after.categoryId, featured: after.featured }).toEqual({
      id: before.id,
      slug: before.slug,
      image: before.image,
      categoryId: before.categoryId,
      featured: before.featured,
    })
    expect(after.createdAt).toEqual(before.createdAt)
  })

  it('still invalidates after a timed-out write', async () => {
    calls.failFrom = 1
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await updateProductAction(IDLE, await edit())).toEqual({ status: 'error', error: 'unavailable' })
    expect(calls.names).toEqual(['products.admin-update'])
    expect(updateTag).toHaveBeenCalledTimes(2)
    expect(updateTag.mock.calls.map(([tag]) => tag)).toEqual([`product:${SLUG}`, 'products'])
    expect(error.mock.calls).toEqual([['products: admin product update failed']])
  })

  it('answers unavailable when the existence check fails, without retrying', async () => {
    const data = await edit({ expectedUpdatedAt: '2000-01-01T00:00:00.000000Z' })
    calls.failFrom = 2
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await updateProductAction(IDLE, data)).toEqual({ status: 'error', error: 'unavailable' })
    expect(calls.names).toEqual(['products.admin-update', 'products.admin-exists'])
  })

  it('stock edit leaves cart lines untouched', async () => {
    const cartId = crypto.randomUUID()
    const product = await rowOf(SLUG)
    await db.insert(carts).values({ id: cartId })
    await db.insert(cartItems).values({ cartId, productId: product.id, quantity: 5 })
    await updateProductAction(IDLE, await edit({ stock: '0' }))
    expect(await db.select().from(cartItems).where(eq(cartItems.cartId, cartId))).toEqual([
      expect.objectContaining({ productId: product.id, quantity: 5 }),
    ])
    expect((await rowOf(SLUG)).stock).toBe(0)
  })

  it('never logs the input', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) =>
      vi.spyOn(console, method).mockImplementation(() => {}),
    )
    const secret = 'TEN-BI-MAT-9f3a'
    await updateProductAction(IDLE, await edit({ name: secret }))
    await updateProductAction(IDLE, await edit({ name: secret, price: '-1' }))
    const failing = await edit({ name: secret, description: secret })
    calls.failFrom = calls.names.length + 1
    await updateProductAction(IDLE, failing)
    const logged = JSON.stringify(spies.flatMap((spy) => spy.mock.calls))
    expect(logged).not.toContain(secret)
    expect(logged).not.toContain(SLUG)
  })

  it('the DB check constraint is the last line for a negative price', async () => {
    await expect(
      realDbQuery({
        name: 'products.test-negative-price',
        run: (client) => client.update(products).set({ price: -1 }).where(eq(products.slug, SLUG)),
      }),
    ).rejects.toThrow(/database query failed: products.test-negative-price \(23514\)/)
    expect((await rowOf(SLUG)).price).toBeGreaterThanOrEqual(0)
  })
})
