import { eq, inArray } from 'drizzle-orm'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { products } from '@/db'
import { db } from '@/db/client'
import { runMigrations } from '@/db/migrate'
import { seed } from '@/db/seed'
import { PRODUCT_SEEDS } from '@/db/seed-data'
import { decrementStockForOrder, type StockLine } from '@/features/products/stock'
import { UPDATED_AT_TEXT } from '@/features/products/updated-at-text'

// PGlite runs one transaction at a time (plan M6 C7), so these tests prove the logic of the decrement (what is
// written, what is not), not the row locks: that is Postgres's job and the order of the lock query is checked below.

const SEEDED_AT = new Date('2020-01-01T00:00:00.000Z')

const [FIRST, SECOND] = PRODUCT_SEEDS
if (FIRST === undefined || SECOND === undefined) throw new Error('seed has fewer than two products')

const rowBySlug = async (slug: string) => {
  const [row] = await db.select().from(products).where(eq(products.slug, slug))
  if (row === undefined) throw new Error(`no product ${slug}`)
  return row
}

const updatedAtText = async (id: number, client: Pick<typeof db, 'select'> = db): Promise<string | undefined> => {
  const [row] = await client.select({ at: UPDATED_AT_TEXT }).from(products).where(eq(products.id, id))
  return row?.at
}

const run = (lines: readonly StockLine[]) => db.transaction((tx) => decrementStockForOrder(tx, lines))

beforeAll(async () => {
  await runMigrations()
})

beforeEach(async () => {
  await seed()
  // Fixed stock and an old updated_at, so "moved" and "not moved" are unambiguous.
  await db
    .update(products)
    .set({ stock: 10, updatedAt: SEEDED_AT })
    .where(
      inArray(
        products.slug,
        PRODUCT_SEEDS.map((product) => product.slug),
      ),
    )
})

describe('decrementStockForOrder (ADR-0019, plan M6 Task 5)', () => {
  it('decrements every line and returns the slugs', async () => {
    const first = await rowBySlug(FIRST.slug)
    const second = await rowBySlug(SECOND.slug)
    const result = await run([
      { productId: first.id, quantity: 3 },
      { productId: second.id, quantity: 10 },
    ])
    // Slugs come back in lock (id) order.
    const expected = first.id < second.id ? [FIRST.slug, SECOND.slug] : [SECOND.slug, FIRST.slug]
    expect(result).toEqual({ ok: true, slugs: expected })
    expect((await rowBySlug(FIRST.slug)).stock).toBe(7)
    expect((await rowBySlug(SECOND.slug)).stock).toBe(0)
  })

  it('a checkout stock decrement moves updated_at', async () => {
    const before = await rowBySlug(FIRST.slug)
    expect(before.updatedAt.getTime()).toBe(SEEDED_AT.getTime())
    await run([{ productId: before.id, quantity: 1 }])
    const after = await rowBySlug(FIRST.slug)
    expect(after.updatedAt.getTime()).toBeGreaterThan(before.updatedAt.getTime())
  })

  it('moves updated_at forward even when the clock has not passed it', async () => {
    // audit PR #125 L1: now() is the transaction's start, so two writes in one transaction (or one microsecond)
    // would share a value and a form opened between them would still save. greatest(clock_timestamp(), old + 1µs)
    // always differs: a stored value ahead of the clock still moves by exactly one microsecond.
    const ahead = new Date(Math.floor((Date.now() + 86_400_000) / 1000) * 1000)
    await db.update(products).set({ updatedAt: ahead }).where(eq(products.slug, FIRST.slug))
    const before = await rowBySlug(FIRST.slug)
    await run([{ productId: before.id, quantity: 1 }])
    // Whole seconds ahead, so + 1µs only changes the last digit.
    expect(await updatedAtText(before.id)).toBe(ahead.toISOString().replace('.000Z', '.000001Z'))
  })

  it('two decrements in one transaction leave two different updated_at values', async () => {
    const before = await rowBySlug(FIRST.slug)
    const seen = await db.transaction(async (tx) => {
      await decrementStockForOrder(tx, [{ productId: before.id, quantity: 1 }])
      const first = await updatedAtText(before.id, tx)
      await decrementStockForOrder(tx, [{ productId: before.id, quantity: 1 }])
      return [first, await updatedAtText(before.id, tx)]
    })
    expect(seen[0]).toBeDefined()
    expect(seen[1]).not.toBe(seen[0])
  })

  it('writes nothing when one line is short', async () => {
    const first = await rowBySlug(FIRST.slug)
    const second = await rowBySlug(SECOND.slug)
    const result = await run([
      { productId: first.id, quantity: 2 },
      { productId: second.id, quantity: 11 },
    ])
    expect(result).toEqual({ ok: false, shortProductIds: [second.id] })
    expect(await rowBySlug(FIRST.slug)).toEqual(first)
    expect(await rowBySlug(SECOND.slug)).toEqual(second)
  })

  it('reports a product that no longer exists as short', async () => {
    const first = await rowBySlug(FIRST.slug)
    const result = await run([
      { productId: first.id, quantity: 1 },
      { productId: 999_999, quantity: 1 },
    ])
    expect(result).toEqual({ ok: false, shortProductIds: [999_999] })
    expect(await rowBySlug(FIRST.slug)).toEqual(first)
  })

  it('locks product rows in id order', async () => {
    const first = await rowBySlug(FIRST.slug)
    const second = await rowBySlug(SECOND.slug)
    const built: { toSQL: () => { sql: string } }[] = []
    // Follows every call of the builder chain (select → from → where → orderBy → for) and keeps each step that can
    // print its SQL; the last one is the statement that ran.
    const watch = <T extends object>(target: T): T =>
      new Proxy(target, {
        get: (object, property) => {
          const value: unknown = Reflect.get(object, property, object)
          if (typeof value !== 'function') return value
          return (...args: unknown[]): unknown => {
            const result: unknown = Reflect.apply(value, object, args)
            if (typeof result !== 'object' || result === null || result instanceof Promise) return result
            if ('toSQL' in result && typeof result.toSQL === 'function') built.push(result as (typeof built)[number])
            return watch(result)
          }
        },
      })
    await db.transaction(async (tx) => {
      // Lines in descending id order: the lock order must not follow the caller's order.
      await decrementStockForOrder(watch(tx), [
        { productId: Math.max(first.id, second.id), quantity: 1 },
        { productId: Math.min(first.id, second.id), quantity: 1 },
      ])
    })
    const statements = built.map((builder) => builder.toSQL().sql)
    expect(statements.some((statement) => /order by "products"\."id"[\s\S]*for update/i.test(statement))).toBe(true)
  })

  it('refuses duplicate product ids', async () => {
    const first = await rowBySlug(FIRST.slug)
    await expect(
      run([
        { productId: first.id, quantity: 1 },
        { productId: first.id, quantity: 1 },
      ]),
    ).rejects.toThrow('products: invalid stock lines')
    expect(await rowBySlug(FIRST.slug)).toEqual(first)
  })

  it('refuses an empty list of lines', async () => {
    await expect(run([])).rejects.toThrow('products: invalid stock lines')
  })
})
