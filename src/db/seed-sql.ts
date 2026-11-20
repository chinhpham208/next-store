// Pure text generation: no `server-only`, no `@/db`. The output is pasted into the Neon SQL Editor on
// production, so nothing here may open a connection or depend on the shell environment.
import { CATEGORY_SEEDS, PRODUCT_SEEDS } from '@/db/seed-data'

type CategorySeed = (typeof CATEGORY_SEEDS)[number]
type ProductSeed = (typeof PRODUCT_SEEDS)[number]

export type SeedSqlInput = { categories: readonly CategorySeed[]; products: readonly ProductSeed[] }

const DEFAULT_INPUT: SeedSqlInput = { categories: CATEGORY_SEEDS, products: PRODUCT_SEEDS }

/**
 * A SQL literal for a value from the repo's seed data: `'…'` with quotes doubled, or `E'…'` with backslashes
 * doubled too when the string has one. Both forms parse the same whatever standard_conforming_strings is.
 */
export const quoteSqlLiteral = (value: string | number | boolean): string => {
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'number') {
    // Safe integers only: anything else would print as `1.5`, `NaN` or `1e+21` and change type or meaning.
    if (!Number.isSafeInteger(value)) throw new Error(`quoteSqlLiteral: ${value} không phải số nguyên an toàn`)
    return String(value)
  }
  // Postgres rejects NUL in text, and a lone surrogate would be replaced by U+FFFD on UTF-8 encoding.
  if (value.includes('\u0000')) throw new Error('quoteSqlLiteral: chuỗi chứa ký tự NUL')
  if (!value.isWellFormed()) throw new Error('quoteSqlLiteral: chuỗi chứa UTF-16 surrogate lẻ')
  const quoted = value.replaceAll("'", "''")
  // A plain literal with a backslash changes meaning when standard_conforming_strings is off (the backslash
  // would escape the closing quote). A `SET` in the same script cannot help: the whole pasted text is parsed
  // before any statement runs. An escape string is read the same way under either setting.
  if (!value.includes('\\')) return `'${quoted}'`
  return `E'${quoted.replaceAll('\\', '\\\\')}'`
}

// `on conflict do nothing` silently skips a repeated slug, so a duplicate would be a row that never appears.
const assertUniqueSlugs = (label: string, slugs: readonly string[]): void => {
  if (slugs.length === 0) throw new Error(`Seed SQL: danh sách ${label} rỗng`)
  const seen = new Set<string>()
  for (const slug of slugs) {
    if (seen.has(slug)) throw new Error(`Seed SQL: slug ${label} bị trùng "${slug}"`)
    seen.add(slug)
  }
}

type SqlValue = string | number | boolean

const valuesRows = (rows: readonly (readonly SqlValue[])[]): string =>
  rows.map((row) => `  (${row.map(quoteSqlLiteral).join(', ')})`).join(',\n')

/** The two statements of the production seed; same rows as `seed()`, existing slugs left untouched. */
export const buildSeedStatements = (input: SeedSqlInput = DEFAULT_INPUT): string[] => {
  assertUniqueSlugs('danh mục', input.categories.map((category) => category.slug))
  assertUniqueSlugs('sản phẩm', input.products.map((product) => product.slug))
  const categorySlugs = new Set(input.categories.map((category) => category.slug))
  // seed() throws on an unknown category; the join below would instead drop the product without a word.
  const missing = input.products.find((product) => !categorySlugs.has(product.categorySlug))
  if (missing) throw new Error(`Seed SQL: không tìm thấy danh mục "${missing.categorySlug}"`)

  const categoryInsert =
    'insert into categories (slug, name) values\n' +
    valuesRows(input.categories.map(({ slug, name }) => [slug, name])) +
    '\non conflict (slug) do nothing'

  // Category ids differ per database, so they are resolved by slug inside the statement, not baked in.
  // Defaults for stock / featured mirror the column defaults that seed() relies on. `ord` keeps the seed-data
  // order through the join (a hash join reorders rows), so serial ids come out as they do from seed().
  const productInsert =
    'insert into products (slug, name, description, price, image, category_id, stock, featured)\n' +
    'select v.slug, v.name, v.description, v.price, v.image, c.id, v.stock, v.featured from (values\n' +
    valuesRows(
      input.products.map((product, index): SqlValue[] => [
        index + 1,
        product.slug,
        product.name,
        product.description,
        product.price,
        `/images/${product.categorySlug}.svg`,
        product.categorySlug,
        product.stock ?? 0,
        product.featured ?? false,
      ]),
    ) +
    '\n) as v(ord, slug, name, description, price, image, category_slug, stock, featured)\n' +
    'join categories c on c.slug = v.category_slug\n' +
    'order by v.ord\n' +
    'on conflict (slug) do nothing'

  return [categoryInsert, productInsert]
}

/** The whole script for the SQL Editor: one transaction, so a failure leaves production unchanged. */
export const buildSeedSql = (input: SeedSqlInput = DEFAULT_INPUT): string =>
  [
    'begin;',
    ...buildSeedStatements(input).map((statement) => `${statement};`),
    'commit;',
    '',
  ].join('\n')
