import { readFileSync } from 'node:fs'
import { inspect } from 'node:util'
import { fileURLToPath } from 'node:url'
import { inArray, sql } from 'drizzle-orm'
import { cacheLife, cacheTag } from 'next/cache'
import { connection } from 'next/server'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { categories, products } from '@/db'
import { db } from '@/db/client'
import { runMigrations } from '@/db/migrate'
import { seed } from '@/db/seed'
import { PRODUCT_SORTS, type ProductListing, type ProductQuery, type ProductSort } from '@/features/products'
import { escapeLikePattern, getCategories, listProducts } from '@/features/products/queries'

// cacheTag() throws outside a cacheComponents build and Vitest ignores 'use cache': these tests cover the
// queries and the branching; the directive's effect is checked by the build of the listing page (Task 13).
vi.mock('next/cache', () => ({ cacheTag: vi.fn(), cacheLife: vi.fn() }))
vi.mock('next/server', () => ({ connection: vi.fn() }))

const ALL: ProductQuery = { category: null, sort: 'newest', q: '', page: 1 }
const slugs = (listing: ProductListing) => listing.items.map((item) => item.slug)
// listProducts must stay safe when a caller skips parseProductQuery; Reflect.apply bypasses the static type
// without an `as` cast.
const listUnparsed = (raw: unknown): Promise<ProductListing> => Reflect.apply(listProducts, undefined, [raw])
const rejectionOf = (promise: Promise<unknown>): Promise<unknown> =>
  promise.then(
    () => null,
    (reason: unknown) => reason,
  )

beforeAll(async () => {
  await runMigrations()
  await seed()
})
beforeEach(() => vi.clearAllMocks())
afterEach(() => vi.restoreAllMocks())

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

describe('ordering (checked against an order computed outside the query)', () => {
  type Row = { id: number; slug: string; price: number; updatedAt: Date }
  // Primary key first, then id ascending: the order ADR-0008 promises for each sort.
  const PRIMARY: Record<ProductSort, (a: Row, b: Row) => number> = {
    newest: (a, b) => b.updatedAt.getTime() - a.updatedAt.getTime(),
    'price-asc': (a, b) => a.price - b.price,
    'price-desc': (a, b) => b.price - a.price,
  }
  let rows: Row[] = []

  beforeAll(async () => {
    rows = await db
      .select({ id: products.id, slug: products.slug, price: products.price, updatedAt: products.updatedAt })
      .from(products)
  })

  const expectSortedPages = async (sort: ProductSort) => {
    const expected = [...rows].sort((a, b) => PRIMARY[sort](a, b) || a.id - b.id).map((row) => row.slug)
    const actual = [...slugs(await listProducts({ ...ALL, sort })), ...slugs(await listProducts({ ...ALL, sort, page: 2 }))]
    expect(actual).toEqual(expected)
  }

  it('has ties to break for every sort, so the tie-breaker is actually exercised', () => {
    expect(rows).toHaveLength(24)
    expect(new Set(rows.map((row) => row.updatedAt.getTime())).size).toBeLessThan(24)
    expect(new Set(rows.map((row) => row.price)).size).toBeLessThan(24)
  })

  // Postgres returns ties in an order that depends on the physical order of rows, and which order exposes a
  // missing `id` key differs per sort (measured on PGlite: price-asc only with rows in insertion order). So every
  // sort is checked against both physical orders.
  describe('rows stored in insertion (id) order', () => {
    it.each(PRODUCT_SORTS)('pages 1 and 2 follow the primary key then id, each product once (sort=%s)', expectSortedPages)
  })
  describe('rows stored in reverse id order', () => {
    beforeAll(async () => {
      // A no-op UPDATE writes a new row version at the end of the heap; rewriting from the highest id down
      // reverses the physical order. Raw SQL so Drizzle's $onUpdate does not touch updated_at.
      for (const { id } of [...rows].sort((a, b) => b.id - a.id)) {
        await db.execute(sql`update products set stock = stock where id = ${id}`)
      }
    })
    it.each(PRODUCT_SORTS)('pages 1 and 2 follow the primary key then id, each product once (sort=%s)', expectSortedPages)
  })
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
it('stops after the count when a search matches nothing', async () => {
  const select = vi.spyOn(db, 'select')
  await listProducts({ ...ALL, q: 'khong-co-gi' })
  expect(select).toHaveBeenCalledOnce()
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
it('tags both cached listing queries with products and an hours lifetime', async () => {
  await listProducts(ALL)
  // category null: exactly countCatalog and getCatalogPage run, so each must tag and set its lifetime once.
  expect(cacheTag).toHaveBeenCalledTimes(2)
  expect(cacheLife).toHaveBeenCalledTimes(2)
  expect(vi.mocked(cacheTag).mock.calls).toEqual([['products'], ['products']])
  expect(vi.mocked(cacheLife).mock.calls).toEqual([['hours'], ['hours']])
  expect(connection).not.toHaveBeenCalled()
})
it('awaits connection() before an uncached search', async () => {
  await listProducts({ ...ALL, q: 'git' })
  expect(connection).toHaveBeenCalledOnce()
})
it('never tags a cache entry with the search text', async () => {
  // Only the category lookup is cached on the search path.
  await listProducts({ ...ALL, q: 'git', category: 'sach' })
  expect(vi.mocked(cacheTag).mock.calls).toEqual([['products']])
})

describe('search errors never carry the search text (audit M1)', () => {
  const SECRET_Q = 'NGUYEN-VAN-A-0909123456'

  it('rethrows a real query error with a fixed message and only the SQLSTATE', async () => {
    // A real failure from Postgres (undefined_column), which Drizzle wraps with the query, params and cause.
    await db.execute(sql`alter table products rename column name to name_renamed`)
    try {
      const error = await rejectionOf(listProducts({ ...ALL, q: SECRET_Q }))
      expect(error).toBeInstanceOf(Error)
      expect(error).toMatchObject({ message: 'database query failed: products.search-count (42703)', code: '42703' })
      expect(error).not.toHaveProperty('cause')
      expect(error).not.toHaveProperty('params')
      expect(error).not.toHaveProperty('query')
      // What Next prints: the inspected object with its own properties and cause chain.
      const printed = inspect(error, { depth: 10, showHidden: true })
      expect(printed).not.toContain(SECRET_Q)
      expect(printed).not.toContain('Failed query')
    } finally {
      await db.execute(sql`alter table products rename column name_renamed to name`)
    }
  })
  it('drops a code that is not a SQLSTATE', async () => {
    vi.spyOn(db, 'select').mockImplementation(() => {
      throw Object.assign(new Error(`boom ${SECRET_Q}`), { code: SECRET_Q })
    })
    const error = await rejectionOf(listProducts({ ...ALL, q: SECRET_Q }))
    expect(error).toBeInstanceOf(Error)
    expect(error).toMatchObject({ message: 'database query failed: products.search-count' })
    expect(error).not.toHaveProperty('code')
    expect(inspect(error, { depth: 10, showHidden: true })).not.toContain(SECRET_Q)
  })
})

// NS-55: the cached listing path used to throw Drizzle's own error ("Failed query: select … params: …").
describe('listing and category errors carry neither SQL nor user input (NS-55)', () => {
  const SECRET_CATEGORY = 'nguyen-van-b-0909765432'

  const expectFixed = (error: unknown, message: string) => {
    expect(error).toBeInstanceOf(Error)
    expect(error).toMatchObject({ message, code: '42703' })
    expect(error).not.toHaveProperty('cause')
    const printed = inspect(error, { depth: 10, showHidden: true })
    expect(printed).not.toMatch(/Failed query|select |from "|params/)
    expect(printed).not.toContain(SECRET_CATEGORY)
  }

  it('never puts q into the error of a failed listing or category query', async () => {
    // The count filters on category_id only when a category is chosen; the page query also reads it to join.
    await db.execute(sql`alter table products rename column category_id to category_id_renamed`)
    try {
      expectFixed(
        await rejectionOf(listProducts({ ...ALL, category: 'sach' })),
        'database query failed: products.count (42703)',
      )
    } finally {
      await db.execute(sql`alter table products rename column category_id_renamed to category_id`)
    }
    // image is read only by the page query, so the count succeeds and the page query is the one that fails.
    await db.execute(sql`alter table products rename column image to image_renamed`)
    try {
      expectFixed(await rejectionOf(listProducts(ALL)), 'database query failed: products.page (42703)')
    } finally {
      await db.execute(sql`alter table products rename column image_renamed to image`)
    }
    await db.execute(sql`alter table categories rename column slug to slug_renamed`)
    try {
      expectFixed(
        await rejectionOf(listProducts({ ...ALL, category: SECRET_CATEGORY })),
        'database query failed: products.categories (42703)',
      )
      expectFixed(await rejectionOf(getCategories()), 'database query failed: products.categories (42703)')
    } finally {
      await db.execute(sql`alter table categories rename column slug_renamed to slug`)
    }
  })
})

describe('unparsed input (callers that skip parseProductQuery)', () => {
  it.each([1.5, 0, -3, Number.NaN, Number.POSITIVE_INFINITY, null, 2 ** 60])('treats page=%j as a page in range', async (page) => {
    const listing = await listUnparsed({ ...ALL, page })
    expect([1, 2]).toContain(listing.query.page)
    expect(listing.items).toHaveLength(12)
  })
  it('reads a string page as page 1 (page must be a number, as parseProductQuery returns it)', async () => {
    expect((await listUnparsed({ ...ALL, page: '2' })).query.page).toBe(1)
  })
  it('ignores an inherited page', async () => {
    expect((await listUnparsed(Object.create({ ...ALL, page: 2 }))).query.page).toBe(1)
  })
  it('never throws for a page getter, a throwing Proxy or a revoked Proxy', async () => {
    const getter = Object.defineProperty({ ...ALL }, 'page', {
      get: () => {
        throw new Error('getter')
      },
    })
    const trap = () => {
      throw new Error('trap')
    }
    const hostile = new Proxy({ ...ALL, page: 2 }, { getOwnPropertyDescriptor: trap, has: trap, get: trap })
    const { proxy: revoked, revoke } = Proxy.revocable({ ...ALL, page: 2 }, {})
    revoke()
    for (const raw of [getter, hostile, revoked]) {
      expect((await listUnparsed(raw)).query).toEqual(ALL)
    }
  })
  it.each(['xyz', 'price; drop table products', '', 42, null, undefined, '__proto__', 'constructor'])(
    'falls back to newest for sort=%j',
    async (sort) => {
      const listing = await listUnparsed({ ...ALL, sort })
      expect(listing.query.sort).toBe('newest')
      expect(slugs(listing)[0]).toBe('ao-git-push-force')
    },
  )
  it.each([42, ['ao-thun'], { slug: 'ao-thun' }, 'AO-THUN', '__proto__'])('drops category=%j', async (category) => {
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
  const chunks = source.split(/\n(?=(?:\/\/[^\n]*\n|\/\*\*[\s\S]*?\*\/\n)*(?:export )?const )/)
  const cached = new Map(
    chunks
      .filter((chunk) => /^\s*'use cache'/m.test(chunk))
      .map((chunk) => [/(?:export )?const (\w+) =/.exec(chunk)?.[1] ?? '?', chunk]),
  )
  const PRODUCTS_TAGGED = ['getFeaturedProducts', 'getCategoryRows', 'countCatalog', 'getCatalogPage']

  it('has exactly the expected cached functions', () => {
    expect([...cached.keys()].sort()).toEqual([...PRODUCTS_TAGGED, 'getCachedProductBySlug'].sort())
  })
  it.each(PRODUCTS_TAGGED)('%s tags products and sets an hours lifetime', (name) => {
    const body = cached.get(name) ?? ''
    expect(body).toContain("cacheTag('products')")
    expect(body).toContain("cacheLife('hours')")
  })
  it('the detail query tags product:<slug> and sets an hours lifetime', () => {
    const body = cached.get('getCachedProductBySlug') ?? ''
    expect(body).toContain('cacheTag(`product:${slug}`)')
    expect(body).toContain("cacheLife('hours')")
  })
  it('never passes q or an unknown category to the cached query', () => {
    for (const body of cached.values()) {
      expect(body).not.toMatch(/ilike|escapeLikePattern|\bq\b|\.q\b/i)
      expect(body).not.toMatch(/\bquery\b|\btext\b/)
    }
  })
  it('never builds SQL from raw strings', () => {
    expect(source).not.toMatch(/sql\.raw|sql\.identifier/)
  })
})
