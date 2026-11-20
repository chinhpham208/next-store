import { z } from 'zod'

export const PRODUCT_SORTS = ['newest', 'price-asc', 'price-desc'] as const
export type ProductSort = (typeof PRODUCT_SORTS)[number]

export const PAGE_SIZE = 12
export const MAX_QUERY_LENGTH = 60

export type ProductQuery = {
  category: string | null
  sort: ProductSort
  q: string
  page: number
}

// Frozen: it is shared, and a caller mutating it would silently change every later parse.
export const DEFAULT_PRODUCT_QUERY: Readonly<ProductQuery> = Object.freeze({
  category: null,
  sort: 'newest',
  q: '',
  page: 1,
})

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const MAX_CATEGORY_LENGTH = 40
const MAX_SLUG_LENGTH = 80
// Four digits keeps the page a small integer; anything past the last page is clamped by the listing query.
const PAGE_PATTERN = /^[1-9]\d{0,3}$/
const MAX_PAGE = 9999
// NUL makes Postgres reject the query; other control characters never belong in a product search.
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/
const QUERY_KEYS = ['category', 'sort', 'q', 'page'] as const

// Cut by code points so a long emoji query never ends in half a surrogate pair. The UTF-16 pre-slice keeps
// Array.from bounded on a huge q; 2 units per code point is enough to still yield MAX_QUERY_LENGTH of them.
const cutQuery = (value: string) =>
  Array.from(value.trim().slice(0, MAX_QUERY_LENGTH * 2))
    .slice(0, MAX_QUERY_LENGTH)
    .join('')
    .trimEnd()

// Arrays (repeated parameters) and non-strings fail the string check and fall back to each field's default.
const productQuerySchema = z
  .object({
    category: z.string().max(MAX_CATEGORY_LENGTH).regex(SLUG_PATTERN).nullable().catch(null),
    sort: z.enum(PRODUCT_SORTS).catch(DEFAULT_PRODUCT_QUERY.sort),
    q: z
      .string()
      .refine((value) => !CONTROL_CHARACTERS.test(value) && value.isWellFormed())
      .transform(cutQuery)
      .catch(DEFAULT_PRODUCT_QUERY.q),
    page: z.string().regex(PAGE_PATTERN).transform(Number).catch(DEFAULT_PRODUCT_QUERY.page),
  })
  .catch(() => ({ ...DEFAULT_PRODUCT_QUERY }))

type RawQuery = Partial<Record<(typeof QUERY_KEYS)[number], unknown>>

// Only own data properties are kept: inherited keys (a polluted prototype) and getters never reach the schema.
// Next.js wraps searchParams in a Proxy that adds the query string to the cache key only when a read goes through
// its get / has / ownKeys traps (vary-params.js), and it has no getOwnPropertyDescriptor trap. So every key goes
// through `in` (tracked even when absent) and a kept value is read with `raw[key]`, never from the descriptor.
const pickOwnValues = (raw: Record<string, unknown>): RawQuery => {
  // Null prototype: a polluted Object.prototype.page must not show up as picked.page inside the schema.
  const picked: RawQuery = Object.create(null)
  for (const key of QUERY_KEYS) {
    if (!(key in raw)) continue
    const descriptor = Object.getOwnPropertyDescriptor(raw, key)
    if (descriptor && 'value' in descriptor) picked[key] = raw[key]
  }
  return picked
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export const parseProductQuery = (raw: unknown): ProductQuery => {
  // Everything that touches raw sits inside try: a hostile or revoked Proxy throws even from Array.isArray,
  // and URL input must never turn into a 500.
  try {
    if (!isRecord(raw)) return { ...DEFAULT_PRODUCT_QUERY }
    const query: ProductQuery = productQuerySchema.parse(pickOwnValues(raw))
    return query
  } catch {
    return { ...DEFAULT_PRODUCT_QUERY }
  }
}

// unknown, not string: RegExp.test coerces its argument (['ao-x'] → 'ao-x'), and the proxy must never throw on input.
export const isProductSlug = (value: unknown): value is string =>
  typeof value === 'string' && value.length <= MAX_SLUG_LENGTH && SLUG_PATTERN.test(value)

const isNonDefaultSort = (sort: ProductSort | undefined): sort is ProductSort =>
  sort !== undefined && sort !== DEFAULT_PRODUCT_QUERY.sort && PRODUCT_SORTS.includes(sort)

const isNonDefaultPage = (page: number | undefined): page is number =>
  page !== undefined && Number.isInteger(page) && page > DEFAULT_PRODUCT_QUERY.page && page <= MAX_PAGE

export const buildProductsHref = (query: Partial<ProductQuery>) => {
  const params = new URLSearchParams()
  if (query.category) params.set('category', query.category)
  if (query.q) params.set('q', query.q)
  // Never write a sort or page that parseProductQuery would reject: the link would silently fall back to defaults.
  if (isNonDefaultSort(query.sort)) params.set('sort', query.sort)
  if (isNonDefaultPage(query.page)) params.set('page', String(query.page))
  const search = params.toString()
  return search ? `/products?${search}` : '/products'
}
