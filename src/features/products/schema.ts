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
export const DEFAULT_PRODUCT_QUERY: ProductQuery = Object.freeze({
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
// NUL makes Postgres reject the query; other control characters never belong in a product search.
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/
const QUERY_KEYS = ['category', 'sort', 'q', 'page'] as const

// Cut by code points so a long emoji query never ends in half a surrogate pair.
const cutQuery = (value: string) => Array.from(value.trim()).slice(0, MAX_QUERY_LENGTH).join('').trimEnd()

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

// Only own data properties are read: inherited keys (a polluted prototype) and getters never reach the schema.
const pickOwnValues = (raw: object) => {
  const picked: Partial<Record<(typeof QUERY_KEYS)[number], unknown>> = {}
  for (const key of QUERY_KEYS) {
    const descriptor = Object.getOwnPropertyDescriptor(raw, key)
    if (descriptor && 'value' in descriptor) picked[key] = descriptor.value
  }
  return picked
}

const isRecord = (value: unknown): value is object =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export const parseProductQuery = (raw: unknown): ProductQuery => {
  if (!isRecord(raw)) return { ...DEFAULT_PRODUCT_QUERY }
  try {
    const query: ProductQuery = productQuerySchema.parse(pickOwnValues(raw))
    return query
  } catch {
    // A hostile Proxy can throw from its traps; URL input must never turn into a 500.
    return { ...DEFAULT_PRODUCT_QUERY }
  }
}

export const isProductSlug = (value: string) => value.length <= MAX_SLUG_LENGTH && SLUG_PATTERN.test(value)

export const buildProductsHref = (query: Partial<ProductQuery>) => {
  const params = new URLSearchParams()
  if (query.category) params.set('category', query.category)
  if (query.q) params.set('q', query.q)
  if (query.sort && query.sort !== DEFAULT_PRODUCT_QUERY.sort) params.set('sort', query.sort)
  if (query.page !== undefined && query.page !== DEFAULT_PRODUCT_QUERY.page) params.set('page', String(query.page))
  const search = params.toString()
  return search ? `/products?${search}` : '/products'
}
