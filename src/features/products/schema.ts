import { z } from 'zod'
import { isProductSlug, SLUG_PATTERN } from '@/features/products/slug'

export { isProductSlug } from '@/features/products/slug'

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

const MAX_CATEGORY_LENGTH = 40
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

// Admin edit (M5 Task 9, ADR-0019 3A): name, price, description and stock only. Prices are whole đồng.
export const PRODUCT_EDIT_LIMITS = Object.freeze({
  nameMax: 120,
  descriptionMax: 2000,
  priceMax: 100_000_000,
  stockMax: 10_000,
})

export type ProductEditField = 'name' | 'price' | 'description' | 'stock'

// What each field can get wrong; the message for each pair is in edit-messages.ts.
export type ProductEditErrors = {
  name: 'empty' | 'too-long'
  price: 'negative' | 'not-integer' | 'too-large'
  description: 'empty' | 'too-long'
  stock: 'negative' | 'not-integer' | 'too-large'
}

export type ProductEditFieldErrors = { [Field in ProductEditField]?: ProductEditErrors[Field] }

export type ProductEdit = {
  slug: string
  // updated_at when the form loaded, UTC to the microsecond (getProductForAdmin): the save is refused when it moved.
  expectedUpdatedAt: string
  name: string
  price: number
  description: string
  stock: number
}

export type ProductEditParse =
  | { ok: true; value: ProductEdit }
  | { ok: false; fieldErrors: ProductEditFieldErrors; formError?: 'invalid' }

const FORM_INVALID: ProductEditParse = Object.freeze({ ok: false, fieldErrors: {}, formError: 'invalid' })
const EDIT_KEYS = ['slug', 'expectedUpdatedAt', 'name', 'price', 'description', 'stock'] as const
// More digits than this can only be too large: Number() stays exact and cheap below it.
const MAX_AMOUNT_DIGITS = 15

// Every key a string without NUL (Postgres refuses it in text; FormData values are already well-formed USV
// strings). A file, a missing key or a NUL is not something the form sends: a form error, not a field error.
const editText = z.string().refine((value) => !value.includes('\u0000'))
const editFormSchema = z.object({
  slug: editText,
  expectedUpdatedAt: editText,
  name: editText,
  price: editText,
  description: editText,
  stock: editText,
})
// updated_at exactly as UPDATED_AT_TEXT writes it (getProductForAdmin, the save's RETURNING): UTC, six fraction digits,
// a real calendar day, from 1970 on. Anything else is not this form's value, and some of it (the year 0000) passed
// z.iso.datetime() and made Postgres throw, which read as `unavailable` (audit PR #107 L-1).
const UPDATED_AT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/
const FIRST_YEAR = '1970'
const isUpdatedAtText = (value: string): boolean => {
  if (!UPDATED_AT_PATTERN.test(value) || value.slice(0, 4) < FIRST_YEAR) return false
  // Date keeps milliseconds: the same text back up to them means the day and time exist (no 30 February, no 24:00).
  const date = new Date(value)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 23) === value.slice(0, 23)
}
const formFieldsSchema = z.object({
  slug: z.string().refine(isProductSlug),
  expectedUpdatedAt: z.iso.datetime({ precision: 6 }).refine(isUpdatedAtText),
})

const characters = (value: string): number => Array.from(value).length

// trim() keeps format characters, so a name of U+200B alone was saved and the shop showed an empty name (audit PR
// #107 L-2); a zero-width joiner inside an emoji stays.
// What counts as text (audit PR #108 L-3). A name or description needs one visible letter, digit, symbol (emoji)
// or punctuation mark. Spaces, format characters (\p{Cf}: ZWSP, ZWJ, BOM), marks with no base (\p{M}: a lone
// U+0301 or U+FE0F) and the fillers that are letters by category but draw nothing (Hangul U+115F, U+1160, U+3164,
// U+FFA0; braille blank U+2800) do not count, and are cut at either end. Marks are kept at the end: they belong to
// the letter before them (an accent, the U+FE0F of an emoji). Bidi controls reorder the text around them on the
// shop, so they are a form error, like \p{Cc}. Input is stored in NFC.
const FILLERS = '\\u115f\\u1160\\u3164\\uffa0\\u2800'
const FILLER = new RegExp(`[${FILLERS}]`, 'gu')
const VISIBLE = /[\p{L}\p{N}\p{S}\p{P}]/u
const EDGES = new RegExp(`^[\\s\\p{Z}\\p{Cf}\\p{M}${FILLERS}]+|[\\s\\p{Z}\\p{Cf}${FILLERS}]+$`, 'gu')
const BIDI_CONTROL = /[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/u
const SEPARATORS = /[\u2028\u2029]/g
const isBlank = (value: string): boolean => !VISIBLE.test(value.replace(FILLER, ''))
const cleanText = (value: string): string => value.normalize('NFC').replace(SEPARATORS, '\n')
const trimEdges = (value: string): string => value.replace(EDGES, '')

const textError = (value: string, max: number): 'empty' | 'too-long' | undefined => {
  if (isBlank(value)) return 'empty'
  return characters(value) > max ? 'too-long' : undefined
}

// A name is one line: a line break, a tab or U+2028 / U+2029 (pasted, or a forged POST) becomes one space. Any other
// control character cannot be typed in the form: a form error, like a NUL. A description keeps \t, \n and \r, and
// turns U+2028 / U+2029 into \n.
const LINE_BREAKS = /\s*[\t\n\v\f\r]+\s*/g
const CONTROL = /\p{Cc}/u
const DESCRIPTION_CONTROL = /[^\P{Cc}\t\n\r]/u
const oneLine = (value: string): string => trimEdges(cleanText(value).replace(LINE_BREAKS, ' '))

// ASCII digits only: "1.5", "1e3", "1.000", "0x10", "+5" and non-ASCII digits are not a whole number of đồng.
// Leading zeros are dropped before the length check: "0000000000000001" is 1, not too large (audit PR #107 nit).
const amount = (raw: string, max: number): { value: number } | { error: 'negative' | 'not-integer' | 'too-large' } => {
  const value = raw.trim().replace(/^(-?)0+(?=\d)/, '$1')
  if (/^-\d+$/.test(value)) return { error: 'negative' }
  if (!/^\d+$/.test(value)) return { error: 'not-integer' }
  if (value.length > MAX_AMOUNT_DIGITS || Number(value) > max) return { error: 'too-large' }
  return { value: Number(value) }
}

/** The edit form, or what is wrong with it: field errors for what the admin typed, a form error for the rest. */
export const parseProductEdit = (formData: unknown): ProductEditParse => {
  if (!(formData instanceof FormData)) return FORM_INVALID
  const raw = editFormSchema.safeParse(Object.fromEntries(EDIT_KEYS.map((key) => [key, formData.get(key)])))
  if (!raw.success) return FORM_INVALID
  const form = formFieldsSchema.safeParse(raw.data)
  if (!form.success) return FORM_INVALID

  const name = oneLine(raw.data.name)
  const description = trimEdges(cleanText(raw.data.description))
  if (CONTROL.test(name) || DESCRIPTION_CONTROL.test(description)) return FORM_INVALID
  // On the raw input: trimEdges would drop one at either end, and the admin should learn it was there.
  if (BIDI_CONTROL.test(raw.data.name) || BIDI_CONTROL.test(raw.data.description)) return FORM_INVALID
  const price = amount(raw.data.price, PRODUCT_EDIT_LIMITS.priceMax)
  const stock = amount(raw.data.stock, PRODUCT_EDIT_LIMITS.stockMax)
  const fieldErrors: ProductEditFieldErrors = {}
  const nameError = textError(name, PRODUCT_EDIT_LIMITS.nameMax)
  if (nameError !== undefined) fieldErrors.name = nameError
  if ('error' in price) fieldErrors.price = price.error
  const descriptionError = textError(description, PRODUCT_EDIT_LIMITS.descriptionMax)
  if (descriptionError !== undefined) fieldErrors.description = descriptionError
  if ('error' in stock) fieldErrors.stock = stock.error
  if ('error' in price || 'error' in stock || Object.keys(fieldErrors).length > 0) return { ok: false, fieldErrors }

  return {
    ok: true,
    value: {
      slug: form.data.slug,
      expectedUpdatedAt: form.data.expectedUpdatedAt,
      name,
      price: price.value,
      description,
      stock: stock.value,
    },
  }
}
