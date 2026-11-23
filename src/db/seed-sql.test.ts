import { asc, eq, sql } from 'drizzle-orm'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { categories, products, type Product } from '@/db'
import { connection, db } from '@/db/client'
import { runMigrations } from '@/db/migrate'
import { seed } from '@/db/seed'
import { CATEGORY_SEEDS, PRODUCT_SEEDS } from '@/db/seed-data'
import { buildSeedSql, buildSeedStatements, quoteSqlLiteral, type SeedSqlInput } from '@/db/seed-sql'

// The full script is what gets pasted into the Neon SQL Editor, so it must run as one multi-statement text,
// exactly like the editor does, not statement by statement.
const execScript = async (script: string) => {
  if (connection.kind !== 'pglite') throw new Error('seed-sql tests must run on PGlite')
  await connection.db.$client.exec(script)
}

const applyStatements = async (statements: string[]) => {
  for (const statement of statements) await db.execute(sql.raw(statement))
}

// cart_items references products (NS-88): truncated together, named rather than CASCADE so a new reference fails here.
const resetTables = () => db.execute(sql`truncate table cart_items, carts, products, categories restart identity`)

const omit = (row: Product, keys: readonly (keyof Product)[]) =>
  Object.fromEntries(Object.entries(row).filter(([key]) => !keys.some((omitted) => omitted === key)))

// updated_at is the time of insert, so it can never match between two runs.
const withoutUpdatedAt = (row: Product) => omit(row, ['updatedAt'])

// Every column except updated_at; ids included, since both paths insert in the same order.
const snapshot = async () => ({
  categories: await db.select().from(categories).orderBy(asc(categories.id)),
  products: (await db.select().from(products).orderBy(asc(products.id))).map(withoutUpdatedAt),
})

beforeAll(async () => {
  // vitest.config.mts blanks DATABASE_URL; if that ever regresses, stop before touching a real database.
  expect(connection.target).toEqual({ kind: 'pglite', dataDir: 'memory://' })
  await runMigrations()
})

describe('quoteSqlLiteral', () => {
  it('doubles single quotes and refuses NUL', () => {
    expect(quoteSqlLiteral("Cốc 'It works on my machine'")).toBe("'Cốc ''It works on my machine'''")
    expect(() => quoteSqlLiteral('a\u0000b')).toThrow()
    expect(() => quoteSqlLiteral(1.5)).toThrow()
  })
  it('doubles backslashes in an escape string and keeps unicode verbatim', () => {
    expect(quoteSqlLiteral('C:\\path\\')).toBe("E'C:\\\\path\\\\'")
    expect(quoteSqlLiteral("\\'")).toBe("E'\\\\'''")
    expect(quoteSqlLiteral('Sách 📚 tiếng Việt')).toBe("'Sách 📚 tiếng Việt'")
  })
  it('writes integers and booleans as bare SQL literals', () => {
    expect(quoteSqlLiteral(199000)).toBe('199000')
    expect(quoteSqlLiteral(0)).toBe('0')
    expect(quoteSqlLiteral(-3)).toBe('-3')
    expect(quoteSqlLiteral(true)).toBe('true')
    expect(quoteSqlLiteral(false)).toBe('false')
  })
  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 2 ** 53])(
    'refuses the non-integer or unsafe number %s',
    (value) => {
      expect(() => quoteSqlLiteral(value)).toThrow()
    },
  )
  it.each([
    ['NUL', '\u0000', 'U+0000'],
    ['tab', '\t', 'U+0009'],
    ['line feed', '\n', 'U+000A'],
    ['carriage return', '\r', 'U+000D'],
    ['escape', '\u001B', 'U+001B'],
    ['DEL', '\u007F', 'U+007F'],
    ['C1 NEL', '\u0085', 'U+0085'],
    ['line separator', '\u2028', 'U+2028'],
    ['paragraph separator', '\u2029', 'U+2029'],
    ['left-to-right embedding', '\u202A', 'U+202A'],
    ['right-to-left override', '\u202E', 'U+202E'],
    ['left-to-right isolate', '\u2066', 'U+2066'],
    ['pop directional isolate', '\u2069', 'U+2069'],
  ])('refuses the control character %s and names its code point', (_label, character, code) => {
    expect(() => quoteSqlLiteral(`a${character}b`)).toThrow(new RegExp(`ký tự điều khiển ${code.replace('+', '\\+')}$`))
  })
  it('allows combining marks, ZWJ emoji and right-to-left letters', () => {
    expect(() => quoteSqlLiteral('Tie\u0302\u0301ng 🧑\u200D💻 עברית')).not.toThrow()
  })
  it('refuses a lone UTF-16 surrogate, which would not survive UTF-8 encoding', () => {
    expect(() => quoteSqlLiteral('a\uD800b')).toThrow()
  })
})

describe('buildSeedSql', () => {
  it('produces exactly two statements wrapped in one transaction', () => {
    expect(buildSeedStatements()).toHaveLength(2)
    expect(buildSeedSql()).toMatch(/^begin;\n[\s\S]+\ncommit;\n$/)
  })
  it('skips existing slugs in both statements', () => {
    const [categoryInsert, productInsert] = buildSeedStatements()
    expect(categoryInsert).toMatch(/^insert into public\.categories \(slug, name\) values[\s\S]+on conflict \(slug\) do nothing$/)
    expect(productInsert).toMatch(
      /^insert into public\.products \(slug, name, description, price, image, category_id, stock, featured\)\nselect [\s\S]+ from \(values[\s\S]+\) as v\([^)]+\)\njoin public\.categories c on c\.slug = v\.category_slug\norder by v\.ord\non conflict \(slug\) do nothing$/,
    )
  })
  it('names every table with its schema, so a changed search_path cannot redirect the inserts', () => {
    const tables = buildSeedSql().match(/\b(?:into|join)\s+\S+/g)
    expect(tables).toEqual(['into public.categories', 'into public.products', 'join public.categories'])
  })
  it('refuses a control character anywhere in the seed data', () => {
    const input: SeedSqlInput = {
      categories: CATEGORY_SEEDS,
      products: [{ ...PRODUCT_SEEDS[0]!, description: 'dòng 1\ndòng 2' }],
    }
    expect(() => buildSeedStatements(input)).toThrow(/U\+000A/)
  })
  it('is deterministic', () => {
    expect(buildSeedSql()).toBe(buildSeedSql())
  })
  it('refuses a product whose category is not in the input, which the join would silently drop', () => {
    const input: SeedSqlInput = {
      categories: CATEGORY_SEEDS,
      products: [{ ...PRODUCT_SEEDS[0]!, categorySlug: 'khong-co' }],
    }
    expect(() => buildSeedStatements(input)).toThrow(/khong-co/)
  })
  it('refuses duplicate slugs, which on conflict do nothing would silently drop', () => {
    expect(() => buildSeedStatements({ categories: [...CATEGORY_SEEDS, CATEGORY_SEEDS[0]!], products: PRODUCT_SEEDS })).toThrow()
    expect(() => buildSeedStatements({ categories: CATEGORY_SEEDS, products: [...PRODUCT_SEEDS, PRODUCT_SEEDS[0]!] })).toThrow()
  })
  it('refuses empty input, which would be invalid SQL', () => {
    expect(() => buildSeedStatements({ categories: [], products: PRODUCT_SEEDS })).toThrow()
    expect(() => buildSeedStatements({ categories: CATEGORY_SEEDS, products: [] })).toThrow()
  })
})

describe('applied to a migrated PGlite', () => {
  beforeEach(resetTables)

  it('inserts the same rows as seed()', async () => {
    await applyStatements(buildSeedStatements())
    const fromSql = await db.select().from(products).orderBy(products.slug)
    expect(fromSql).toHaveLength(24)
    expect(await db.$count(categories)).toBe(4)
    const bySlug = new Map(fromSql.map((row) => [row.slug, row]))
    for (const { categorySlug, ...expected } of PRODUCT_SEEDS) {
      expect(bySlug.get(expected.slug)).toMatchObject({ ...expected, image: `/images/${categorySlug}.svg` })
    }

    const afterSql = await snapshot()
    await resetTables()
    await seed()
    expect(afterSql).toEqual(await snapshot())
  })
  it('runs as one pasted script with the M1 production invariants', async () => {
    await execScript(buildSeedSql())
    expect(await db.$count(categories)).toBe(4)
    expect(await db.$count(products)).toBe(24)
    expect(await db.$count(products, eq(products.featured, true))).toBe(6)
    expect(await db.$count(products, eq(products.stock, 0))).toBe(2)
  })
  it('is idempotent and leaves edited rows untouched', async () => {
    await execScript(buildSeedSql())
    await db.update(products).set({ price: 1 }).where(eq(products.slug, 'sticker-git'))
    const before = await snapshot()
    await execScript(buildSeedSql())
    expect(await db.$count(products)).toBe(24)
    const [row] = await db.select({ price: products.price }).from(products).where(eq(products.slug, 'sticker-git'))
    expect(row?.price).toBe(1)
    expect(await snapshot()).toEqual(before)
  })
  it('seed() after the SQL adds nothing', async () => {
    await execScript(buildSeedSql())
    const before = await snapshot()
    await seed()
    expect(await db.$count(products)).toBe(24)
    expect(await snapshot()).toEqual(before)
  })
  it('fills a missing stock / featured with the same defaults seed() gets from the columns', async () => {
    const { categorySlug, name, description, price } = PRODUCT_SEEDS[0]!
    const bare = { categorySlug, name, description, price }
    await execScript(buildSeedSql({ categories: CATEGORY_SEEDS, products: [{ ...bare, slug: 'qua-sql' }] }))
    // seed() inserts through Drizzle with the fields omitted, so Postgres column defaults apply.
    const [category] = await db.select({ id: categories.id }).from(categories).where(eq(categories.slug, categorySlug))
    await db
      .insert(products)
      .values({ name, description, price, slug: 'qua-drizzle', categoryId: category!.id, image: `/images/${categorySlug}.svg` })

    const rows = await db.select().from(products).orderBy(asc(products.id))
    const [viaSql, viaDrizzle] = rows.map((row) => omit(row, ['id', 'slug', 'updatedAt']))
    expect(viaSql).toMatchObject({ stock: 0, featured: false })
    expect(viaSql).toEqual(viaDrizzle)
  })
  it('adds only the missing rows to a partially seeded database', async () => {
    await execScript(buildSeedSql())
    await db.delete(products).where(eq(products.slug, 'sticker-git'))
    await execScript(buildSeedSql())
    expect(await db.$count(products)).toBe(24)
    expect(await db.$count(categories)).toBe(4)
  })
})

describe('escaping', () => {
  const HOSTILE = [
    "'",
    "''",
    "it's",
    '\\',
    "\\'",
    "\\'); drop table products; --",
    "'); drop table products; --",
    '$$ $tag$ "double" `back`',
    'Tiếng Việt tổ hợp: Tie\u0302\u0301ng, emoji 🧑‍💻, CJK 漢字, RTL עברית',
  ]
  const hostileInput: SeedSqlInput = {
    categories: [{ slug: "cat-'\\", name: HOSTILE.join(' | ') }],
    products: HOSTILE.map((text, index) => ({
      categorySlug: "cat-'\\",
      slug: `p-${index}-${text}`,
      name: text,
      description: `${text}${text}`,
      price: index * 1000,
      stock: index,
      featured: index % 2 === 0,
    })),
  }

  const expectRoundTrip = async () => {
    const [category] = await db.select().from(categories)
    expect(category).toMatchObject(hostileInput.categories[0]!)
    const rows = await db.select().from(products).orderBy(asc(products.id))
    expect(rows).toHaveLength(HOSTILE.length)
    rows.forEach((row, index) => {
      const { categorySlug, ...expected } = hostileInput.products[index]!
      expect(row).toMatchObject({ ...expected, image: `/images/${categorySlug}.svg`, categoryId: category?.id })
    })
  }

  beforeEach(resetTables)

  it('round-trips quotes, backslashes and unicode exactly', async () => {
    await execScript(buildSeedSql(hostileInput))
    await expectRoundTrip()
  })
  it('stays safe when the session has standard_conforming_strings off', async () => {
    // With the setting off, a backslash would escape the closing quote of a plain literal.
    await execScript('set standard_conforming_strings = off')
    try {
      await execScript(buildSeedSql(hostileInput))
      await expectRoundTrip()
    } finally {
      await execScript('reset standard_conforming_strings')
    }
  })
})
