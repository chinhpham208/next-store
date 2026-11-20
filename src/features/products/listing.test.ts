import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { inArray } from 'drizzle-orm'
import { cacheLife, cacheTag } from 'next/cache'
import { connection } from 'next/server'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { categories, db, products } from '@/db'
import { runMigrations } from '@/db/migrate'
import { seed } from '@/db/seed'
import { PRODUCT_SORTS, type ProductListing, type ProductQuery } from '@/features/products'
import { escapeLikePattern, getCategories, listProducts } from '@/features/products/queries'

// cacheTag() throws outside a cacheComponents build and Vitest ignores 'use cache': these tests cover the
// queries and the branching; the directive's effect is checked by the build of the listing page (Task 13).
vi.mock('next/cache', () => ({ cacheTag: vi.fn(), cacheLife: vi.fn() }))
vi.mock('next/server', () => ({ connection: vi.fn() }))

const ALL: ProductQuery = { category: null, sort: 'newest', q: '', page: 1 }
const slugs = (listing: ProductListing) => listing.items.map((item) => item.slug)
// listProducts must stay safe when a caller skips parseProductQuery; Reflect.apply bypasses the static type
// without an `as` cast.
const listUnparsed = (raw: unknown): Promise<ProductListing> =>
  Reflect.apply(listProducts, undefined, [raw])

beforeAll(async () => {
  await runMigrations()
  await seed()
})
beforeEach(() => vi.clearAllMocks())

it('getCategories returns the 4 categories in seed order', async () => {
  expect(await getCategories()).toEqual([
    { slug: 'ao-thun', name: 'Áo thun' },
    { slug: 'coc', name: 'Cốc' },
    { slug: 'sticker', name: 'Sticker' },
    { slug: 'sach', name: 'Sách' },
  ])
})
it('US-02: returns the first 12 of 24 products, newest first', async () => {
  const listing = await listProducts(ALL)
  expect(listing.items).toHaveLength(12)
  expect(listing).toMatchObject({ total: 24, pageCount: 2, query: ALL })
  expect(slugs(listing)[0]).toBe('ao-git-push-force')
  expect(Object.keys(listing.items[0] ?? {}).sort()).toEqual(['categoryName', 'image', 'inStock', 'name', 'price', 'slug'])
})
it('US-02: page 2 returns the next 12', async () => {
  const listing = await listProducts({ ...ALL, page: 2 })
  expect(listing.items).toHaveLength(12)
  expect(slugs(listing)[0]).toBe('sticker-hello-world')
})
it.each(PRODUCT_SORTS)('pages 1 and 2 together contain all 24 products exactly once (sort=%s)', async (sort) => {
  const all = [...slugs(await listProducts({ ...ALL, sort })), ...slugs(await listProducts({ ...ALL, sort, page: 2 }))]
  expect(all).toHaveLength(24)
  expect(new Set(all).size).toBe(24)
})
it('US-02: category=ao-thun returns only the 6 t-shirts', async () => {
  const listing = await listProducts({ ...ALL, category: 'ao-thun' })
  expect(listing.total).toBe(6)
  expect(listing.pageCount).toBe(1)
  expect(listing.items.every((item) => item.categoryName === 'Áo thun')).toBe(true)
})
it('US-02: category=ao-thun&sort=price-asc orders by ascending price', async () => {
  const listing = await listProducts({ ...ALL, category: 'ao-thun', sort: 'price-asc' })
  expect(listing.items.map((item) => item.price)).toEqual([179000, 189000, 199000, 209000, 219000, 229000])
  expect(slugs(listing)[0]).toBe('ao-dark-mode')
})
it('orders by descending price for price-desc', async () => {
  const prices = (await listProducts({ ...ALL, category: 'ao-thun', sort: 'price-desc' })).items.map((item) => item.price)
  expect(prices).toEqual([229000, 219000, 209000, 199000, 189000, 179000])
})
it('breaks price ties by id', async () => {
  expect(slugs(await listProducts({ ...ALL, sort: 'price-asc' })).slice(0, 2)).toEqual(['sticker-not-a-bug', 'sticker-dau-cham-phay'])
  expect(slugs(await listProducts({ ...ALL, sort: 'price-desc' }))[0]).toBe('sach-typescript-thuc-chien')
})
it('US-02: q=git matches names case-insensitively', async () => {
  const expected = ['ao-git-push-force', 'sticker-git', 'sach-git-co-ban']
  expect(slugs(await listProducts({ ...ALL, q: 'git' }))).toEqual(expected)
  expect(slugs(await listProducts({ ...ALL, q: 'GIT' }))).toEqual(expected)
})
it('matches Vietnamese letters case-insensitively', async () => {
  expect((await listProducts({ ...ALL, q: 'ÁO' })).total).toBe(6)
  expect((await listProducts({ ...ALL, q: 'sách' })).total).toBe(6)
})
it('combines q with category', async () => {
  expect(slugs(await listProducts({ ...ALL, q: 'git', category: 'sach' }))).toEqual(['sach-git-co-ban'])
})
it('treats % and _ as literal characters', async () => {
  expect((await listProducts({ ...ALL, q: '%' })).total).toBe(0)
  expect((await listProducts({ ...ALL, q: '_' })).total).toBe(0)
  expect((await listProducts({ ...ALL, q: "'" })).total).toBe(3)
})
it('sends q as a bound value, never as SQL', async () => {
  expect((await listProducts({ ...ALL, q: "'); drop table products; --" })).total).toBe(0)
  expect((await listProducts(ALL)).total).toBe(24)
})
it('returns an empty first page when nothing matches', async () => {
  expect(await listProducts({ ...ALL, q: 'khong-co-gi' })).toMatchObject({ items: [], total: 0, pageCount: 1 })
  expect((await listProducts({ ...ALL, q: 'khong-co-gi', page: 5 })).query.page).toBe(1)
})
it('clamps the page before it reaches the cached query', async () => {
  const listing = await listProducts({ ...ALL, page: 9999 })
  expect(listing.query.page).toBe(2)
  expect(listing.items).toHaveLength(12)
  expect(slugs(listing)[0]).toBe('sticker-hello-world')
})
it('clamps the page of a search to its own last page', async () => {
  const listing = await listProducts({ ...ALL, q: 'git', page: 3 })
  expect(listing.query.page).toBe(1)
  expect(listing.items).toHaveLength(3)
})
it('treats an unknown category as no filter', async () => {
  const listing = await listProducts({ ...ALL, category: 'khong-co' })
  expect(listing.query.category).toBeNull()
  expect(listing.total).toBe(24)
})
it('tags the cached listing with products and an hours lifetime', async () => {
  await listProducts(ALL)
  expect(cacheTag).toHaveBeenCalledWith('products')
  expect(cacheLife).toHaveBeenCalledWith('hours')
  expect(connection).not.toHaveBeenCalled()
})
it('awaits connection() before an uncached search', async () => {
  await listProducts({ ...ALL, q: 'git' })
  expect(connection).toHaveBeenCalledOnce()
})
it('never tags a cache entry with the search text', async () => {
  await listProducts({ ...ALL, q: 'git' })
  const tags = vi.mocked(cacheTag).mock.calls.flat()
  expect(tags.every((tag) => tag === 'products')).toBe(true)
})

describe('unparsed input (callers that skip parseProductQuery)', () => {
  it.each([1.5, 0, -3, Number.NaN, Number.POSITIVE_INFINITY, '2', null, 2 ** 60])('treats page=%j as a page in range', async (page) => {
    const listing = await listUnparsed({ ...ALL, page })
    expect([1, 2]).toContain(listing.query.page)
    expect(listing.items).toHaveLength(12)
  })
  it.each(['xyz', 'price; drop table products', '', 42, null, undefined])('falls back to newest for sort=%j', async (sort) => {
    const listing = await listUnparsed({ ...ALL, sort })
    expect(listing.query.sort).toBe('newest')
    expect(slugs(listing)[0]).toBe('ao-git-push-force')
  })
  it.each([42, ['ao-thun'], { slug: 'ao-thun' }, 'AO-THUN'])('drops category=%j', async (category) => {
    expect((await listUnparsed({ ...ALL, category })).query.category).toBeNull()
  })
  it.each([42, ['git'], null, undefined])('treats q=%j as no search', async (q) => {
    const listing = await listUnparsed({ ...ALL, q })
    expect(listing.query.q).toBe('')
    expect(listing.total).toBe(24)
    expect(connection).not.toHaveBeenCalled()
  })
  it('drops a q containing NUL instead of sending it to Postgres', async () => {
    expect((await listUnparsed({ ...ALL, q: 'git\u0000' })).query.q).toBe('')
  })
  it('returns defaults when the query is not an object', async () => {
    expect((await listUnparsed(Object.create(null))).query).toEqual(ALL)
    expect((await listUnparsed(null)).query).toEqual(ALL)
    expect((await listUnparsed('page=2')).query).toEqual(ALL)
  })
})

describe('escapeLikePattern', () => {
  it.each([
    ['%', '\\%'],
    ['_', '\\_'],
    ['\\', '\\\\'],
    ['\\%', '\\\\\\%'],
    ['a\\', 'a\\\\'],
    ['50%_\\', '50\\%\\_\\\\'],
    ['git', 'git'],
  ])('escapes %j as %j', (input, expected) => {
    expect(escapeLikePattern(input)).toBe(expected)
  })
})

// PGlite only: CI has no Neon, so the same patterns on Neon are covered by the preview E2E (Task 14).
describe('LIKE metacharacters match literally on PGlite', () => {
  const PERCENT = 'ky-tu-dac-biet-phan-tram'
  const MIXED = 'ky-tu-dac-biet-hon-hop'

  beforeAll(async () => {
    const [category] = await db.select({ id: categories.id }).from(categories).limit(1)
    if (category === undefined) throw new Error('seed has no category')
    await db.insert(products).values([
      { slug: PERCENT, name: 'Thử ký tự 50% giảm', description: 'x', price: 1000, image: '/x.svg', categoryId: category.id },
      { slug: MIXED, name: 'Thử ký tự a_b \\% a\\', description: 'x', price: 1000, image: '/x.svg', categoryId: category.id },
    ])
  })
  afterAll(async () => {
    await db.delete(products).where(inArray(products.slug, [PERCENT, MIXED]))
  })

  it.each([
    ['%', [PERCENT, MIXED]],
    ['_', [MIXED]],
    ['\\', [MIXED]],
    ['\\%', [MIXED]],
    ['a\\', [MIXED]],
    ['50%', [PERCENT]],
    ['a%b', []],
    ['a_', [MIXED]],
  ])('q=%j matches only names containing it literally', async (q, expected) => {
    expect(slugs(await listProducts({ ...ALL, q })).sort()).toEqual([...expected].sort())
  })
})

describe('cache key rules (structural: Vitest does not run the directive)', () => {
  const source = readFileSync(fileURLToPath(new URL('./queries.ts', import.meta.url)), 'utf8')
  // Each top-level const up to the next one; a comment block above a const stays with that const.
  const cachedBodies = source
    .split(/\n(?=(?:\/\/[^\n]*\n)*(?:export )?const )/)
    .filter((chunk) => /^\s*'use cache'/m.test(chunk))

  it('has cached functions to check', () => {
    expect(cachedBodies.length).toBeGreaterThanOrEqual(3)
  })
  it('never passes q or an unknown category to the cached query', () => {
    for (const body of cachedBodies) {
      expect(body).not.toMatch(/ilike|escapeLikePattern|\bq\b|\.q\b/i)
      expect(body).not.toMatch(/\bquery\b/)
    }
  })
  it('never builds SQL from raw strings', () => {
    expect(source).not.toMatch(/sql\.raw|sql\.identifier/)
  })
})
