import { readFileSync } from 'node:fs'
import { asc, eq } from 'drizzle-orm'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { products } from '@/db'
import { db } from '@/db/client'
import { runMigrations } from '@/db/migrate'
import { seed } from '@/db/seed'
import { getProductForAdmin, listProductsForAdmin } from '@/features/products/admin-queries'

const session = vi.hoisted(() => ({ hasAdminSession: vi.fn<() => Promise<boolean>>() }))
vi.mock('@/features/admin', () => ({ hasAdminSession: session.hasAdminSession }))

// The real dbQuery on PGlite, wrapped only to see which queries run.
const calls = vi.hoisted(() => ({ names: [] as string[] }))
vi.mock('@/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/db')>()
  const dbQuery: typeof actual.dbQuery = (input) => {
    calls.names.push(input.name)
    return actual.dbQuery(input)
  }
  return { ...actual, dbQuery }
})

const SLUG = 'ao-git-push-force'
// What getProductForAdmin returns for updatedAt: UTC with microseconds, the precision of timestamptz.
const MICRO_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/

beforeAll(async () => {
  await runMigrations()
  await seed()
})

beforeEach(() => {
  calls.names = []
  session.hasAdminSession.mockResolvedValue(true)
})

describe('listProductsForAdmin', () => {
  it('lists every product by id with price and stock', async () => {
    const rows = await db
      .select({ slug: products.slug, name: products.name, price: products.price, stock: products.stock })
      .from(products)
      .orderBy(asc(products.id))
    expect(rows.length).toBeGreaterThan(1)
    expect(await listProductsForAdmin()).toEqual(rows)
    expect(calls.names).toEqual(['products.admin-list'])
  })
})

describe('getProductForAdmin', () => {
  it('returns the form fields with updated_at to the microsecond', async () => {
    const product = await getProductForAdmin(SLUG)
    const [row] = await db.select().from(products).where(eq(products.slug, SLUG))
    expect(product).toEqual({
      slug: SLUG,
      name: row?.name,
      description: row?.description,
      price: row?.price,
      stock: row?.stock,
      updatedAt: expect.stringMatching(MICRO_ISO),
    })
    // Same instant as the row, to the millisecond a Date can hold.
    expect(new Date(product?.updatedAt ?? '').getTime()).toBe(row?.updatedAt.getTime())
    expect(calls.names).toEqual(['products.admin-get'])
  })

  it('returns null for an unknown slug', async () => {
    expect(await getProductForAdmin('khong-co-san-pham-nay')).toBeNull()
  })

  it.each(['Ao Git', '', '../etc', 'a'.repeat(81)])('returns null for a malformed slug without a query (%j)', async (slug) => {
    expect(await getProductForAdmin(slug)).toBeNull()
    expect(calls.names).toEqual([])
  })
})

describe('admin reads check the session first (audit PR #106 H1)', () => {
  it.each([
    ['listProductsForAdmin', () => listProductsForAdmin()],
    ['getProductForAdmin', () => getProductForAdmin(SLUG)],
    ['getProductForAdmin with a malformed slug', () => getProductForAdmin('Ao Git')],
  ])('%s refuses without a session before querying', async (_, read) => {
    session.hasAdminSession.mockResolvedValue(false)
    await expect(read()).rejects.toThrow('admin: no session')
    expect(calls.names).toEqual([])
  })
})

describe('admin reads are never cached (ADR-0019)', () => {
  it('is not cached', () => {
    const source = readFileSync('src/features/products/admin-queries.ts', 'utf8')
    expect(source).not.toMatch(/['"]use cache/)
    expect(source).not.toMatch(/\bcacheTag\b|\bcacheLife\b|unstable_cache|from 'react'/)
    expect(source).toMatch(/^import 'server-only'/)
  })
})
