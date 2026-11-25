import 'server-only'
import { and, asc, count, desc, eq, ilike, sql, type SQL } from 'drizzle-orm'
import { cacheLife, cacheTag } from 'next/cache'
import { connection } from 'next/server'
import { categories, dbQuery, products, type DbQueryName } from '@/db'
import { PRODUCT_SLUGS_TAG, PRODUCTS_TAG, productTag } from '@/features/products/cache-tags'
import {
  isProductSlug,
  PAGE_SIZE,
  parseProductQuery,
  PRODUCT_SORTS,
  type ProductQuery,
  type ProductSort,
} from '@/features/products/schema'
import type { CategoryOption, ProductDetail, ProductListing, ProductSummary } from '@/features/products/types'
import { isCacheCount, rejectCacheArguments, SKIP_CACHE_ENTRY } from '@/lib/cache-args'

const FEATURED_LIMIT = 8

// Listing cards only; the detail page selects its own fields (description, stock, categorySlug).
// Select only summary fields: the value returned from a 'use cache' function must be serializable.
const SUMMARY_FIELDS = {
  slug: products.slug,
  name: products.name,
  price: products.price,
  image: products.image,
  categoryName: categories.name,
  // Expose only in/out of stock; the exact count is not part of the summary contract.
  inStock: sql`${products.stock} > 0`.mapWith(Boolean),
}

// Exhaustive by type: adding a sort to PRODUCT_SORTS fails typecheck until it has an ORDER BY here.
// id is the last key everywhere: seed rows share created_at and some prices, and without a unique tie-breaker
// Postgres may return ties in any order, so a product could appear on two pages or on none.
const ORDER_BY: Record<ProductSort, readonly SQL[]> = {
  // created_at, not updated_at (ADR-0019 11A): an admin edit must not move a product to the top.
  newest: [desc(products.createdAt), asc(products.id)],
  'price-asc': [asc(products.price), asc(products.id)],
  'price-desc': [desc(products.price), asc(products.id)],
}

// Every 'use cache' function below is also a Server Function that anyone can call with arguments of their choice
// (NS-105, src/lib/cache-args.ts): each one with parameters checks them before it tags or reads anything.
export const getFeaturedProducts = async (limit: number = FEATURED_LIMIT): Promise<ProductSummary[]> => {
  'use cache'
  // The limit is part of the cache key: 1..FEATURED_LIMIT only, so at most that many entries plus the default.
  if (!isCacheCount(limit, FEATURED_LIMIT)) return rejectCacheArguments('products.featured')
  // Tag 'products' is invalidated by admin edits (M5). Stock changes from the payment webhook invalidate only
  // product:<slug> (ADR-0003), so listings may show inStock up to the cache lifetime after a purchase.
  // 'hours' is the cache lifetime and the safety net if an invalidation is ever missed.
  cacheTag(PRODUCTS_TAG)
  cacheLife('hours')

  return dbQuery({
    name: 'products.featured',
    run: (db) =>
      db
        .select(SUMMARY_FIELDS)
        .from(products)
        .innerJoin(categories, eq(products.categoryId, categories.id))
        .where(eq(products.featured, true))
        // Same order as "Mới nhất" (ADR-0019 11A). Seed inserts every row in one transaction (same created_at);
        // id breaks the tie so order is stable.
        .orderBy(...ORDER_BY.newest)
        .limit(limit),
  })
}

// The slug is the cache key. getProductBySlug checks it first, but this function is a Server Function of its own
// (NS-105), so it checks again: a malformed slug throws before the database, and an unknown one is not stored.
// Exported for tests only; outside the feature, index.ts does not export it.
export const getCachedProductBySlug = async (slug: string): Promise<ProductDetail | null> => {
  'use cache'
  if (!isProductSlug(slug)) return rejectCacheArguments('products.detail')
  // product:<slug> is invalidated by admin edits (M5, updateTag) and by the payment webhook after a stock
  // decrement (M4, revalidateTag) — ADR-0003. 'hours' is the safety net if an invalidation is ever missed.
  cacheTag(productTag(slug))
  cacheLife('hours')

  const [row] = await dbQuery({
    name: 'products.detail',
    run: (db) =>
      db
        .select({
          slug: products.slug,
          name: products.name,
          description: products.description,
          price: products.price,
          image: products.image,
          categorySlug: categories.slug,
          categoryName: categories.name,
          stock: products.stock,
        })
        .from(products)
        .innerJoin(categories, eq(products.categoryId, categories.id))
        .where(eq(products.slug, slug))
        .limit(1),
  })
  // Not stored: otherwise every made-up slug sent straight to this function would leave an entry behind. Render
  // paths never reach this branch for a made-up slug: getProductBySlug answers it from the slug list (NS-109). Only
  // a direct Server Function call does (a request, never a prerender), or a product deleted while the list still
  // names it, which lasts until 'product-slugs' is invalidated.
  if (row === undefined) {
    cacheLife(SKIP_CACHE_ENTRY)
    return null
  }
  return row
}

// The catalogue's slugs under one fixed key: no parameters, so a Server Function call cannot add entries (NS-105).
// Every detail page, its metadata and its Open Graph image read this list, so its tag rides up to every
// /products/<slug> entry. Its own tag, not the listings' one (ADR-0019): an admin field edit invalidates products and
// must not re-render every product page. M5 only edits fields (decision 3A) and the slug set changes only through a
// deploy (ADR-0017). A later write that creates, deletes, hides or renames a product uses
// tagsForProductWrite({ change: 'slug-set' }); until then a new product reads as unknown for up to the cache lifetime.
const getCatalogSlugs = async (): Promise<string[]> => {
  'use cache'
  cacheTag(PRODUCT_SLUGS_TAG)
  cacheLife('hours')

  const rows = await dbQuery({
    name: 'products.catalog-slugs',
    run: (db) => db.select({ slug: products.slug }).from(products).orderBy(asc(products.id)),
  })
  return rows.map((row) => row.slug)
}

export const getProductBySlug = async (slug: string): Promise<ProductDetail | null> => {
  // Guard outside the cached function: a slug that fails here never reaches the cache or the database.
  if (!isProductSlug(slug)) return null
  // NS-109: an unknown slug never opens its own cached read. Its expire-0 lifetime (getCachedProductBySlug) inside
  // the ISR prerender of the Open Graph image route marks the route dynamic, and a route handler has no dynamic hole
  // to resume, so a fail-open request (ADR-0009) answered 500 before notFound() ran. The list is one entry, whatever
  // the slug.
  if (!(await getCatalogSlugs()).includes(slug)) return null
  return getCachedProductBySlug(slug)
}

// Not cached: it runs at build time in generateStaticParams, never per request.
export const getAllProductSlugs = async (): Promise<string[]> => {
  const rows = await dbQuery({
    name: 'products.slugs',
    run: (db) => db.select({ slug: products.slug }).from(products).orderBy(asc(products.id)),
  })
  return rows.map((row) => row.slug)
}

export type ProductSitemapEntry = { slug: string; updatedAt: string }

// Cached, unlike getAllProductSlugs: /sitemap.xml is served at request time once its entry expires, and an uncached
// query would make it dynamic and hit the database on every crawl (K12). Same tag as the listings, so an admin edit
// (M5) refreshes it. A stock change invalidates only product:<slug> (ADR-0003); lastmod then lags by up to the
// cache lifetime, which a crawler tolerates.
export const getProductSitemapEntries = async (): Promise<ProductSitemapEntry[]> => {
  'use cache'
  cacheTag(PRODUCTS_TAG)
  cacheLife('hours')

  const rows = await dbQuery({
    name: 'products.sitemap',
    run: (db) =>
      db.select({ slug: products.slug, updatedAt: products.updatedAt }).from(products).orderBy(asc(products.id)),
  })
  // The sitemap writes <loc> without escaping; a slug that is not a valid URL segment would also 404 in the proxy.
  // ISO string, not Date: the value returned from a 'use cache' function must be serializable.
  return rows
    .filter((row) => isProductSlug(row.slug))
    .map((row) => ({ slug: row.slug, updatedAt: row.updatedAt.toISOString() }))
}

type CategoryRow = CategoryOption & { id: number }

// id lets the listing filter on products.category_id (indexed) instead of joining categories to count.
const getCategoryRows = async (): Promise<CategoryRow[]> => {
  'use cache'
  cacheTag(PRODUCTS_TAG)
  cacheLife('hours')

  return dbQuery({
    name: 'products.categories',
    run: (db) =>
      db
        .select({ id: categories.id, slug: categories.slug, name: categories.name })
        .from(categories)
        .orderBy(asc(categories.id)),
  })
}

export const getCategories = async (): Promise<CategoryOption[]> =>
  (await getCategoryRows()).map(({ slug, name }) => ({ slug, name }))

// Escapes every LIKE metacharacter in one pass, so an escape added for one character is never re-escaped.
// Backslash is Postgres's LIKE escape character unless a query names another with ESCAPE; none here does.
export const escapeLikePattern = (value: string) => value.replace(/[\\%_]/g, '\\$&')

// category_id is NOT NULL with a foreign key, so filtering it equals joining categories and comparing slugs.
const inCategory = (categoryId: number | null) =>
  categoryId === null ? undefined : eq(products.categoryId, categoryId)

const nameContains = (text: string) => ilike(products.name, `%${escapeLikePattern(text)}%`)

// No join: every product has exactly one category (see inCategory), so the count is the same without it.
// The name tells the cached listing (products.count) from the uncached search (products.search-count) in logs.
type CountSelection = { name: DbQueryName; where: SQL | undefined }

const countWhere = async ({ name, where }: CountSelection) => {
  const [row] = await dbQuery({ name, run: (db) => db.select({ total: count() }).from(products).where(where) })
  return row?.total ?? 0
}

type PageSelection = { name: DbQueryName; where: SQL | undefined; sort: ProductSort; page: number }

const selectPage = ({ name, where, sort, page }: PageSelection): Promise<ProductSummary[]> =>
  dbQuery({
    name,
    run: (db) =>
      db
        .select(SUMMARY_FIELDS)
        .from(products)
        .innerJoin(categories, eq(products.categoryId, categories.id))
        .where(where)
        .orderBy(...ORDER_BY[sort])
        .limit(PAGE_SIZE)
        .offset((page - 1) * PAGE_SIZE),
  })

const toPageCount = (total: number) => Math.max(1, Math.ceil(total / PAGE_SIZE))

const isCategoryIdShape = (value: unknown): value is number | null =>
  value === null || isCacheCount(value, Number.MAX_SAFE_INTEGER)

// getCategoryRows is cached with a fixed key, so this costs no database round trip once its entry exists.
const isCategoryId = async (categoryId: number | null) =>
  categoryId === null || (await getCategoryRows()).some((row) => row.id === categoryId)

// Arguments of a 'use cache' function are its cache key (ADR-0008). listCatalog passes only a category id confirmed
// by getCategoryRows and a page already clamped, but both functions are Server Functions of their own (NS-105), so
// each checks its key again: a wrong shape throws, an unknown category or a page past the last one is answered
// without the database and not stored. The entries stay at categories x sorts x real pages.
// Exported for tests only; outside the feature, index.ts does not export them.
export const countCatalog = async (categoryId: number | null): Promise<number> => {
  'use cache'
  if (!isCategoryIdShape(categoryId)) return rejectCacheArguments('products.count')
  cacheTag(PRODUCTS_TAG)
  cacheLife('hours')

  if (!(await isCategoryId(categoryId))) {
    cacheLife(SKIP_CACHE_ENTRY)
    return 0
  }
  return countWhere({ name: 'products.count', where: inCategory(categoryId) })
}

// Positional, not one object: an object key could carry extra properties, each one a new entry.
export const getCatalogPage = async (
  categoryId: number | null,
  sort: ProductSort,
  page: number,
): Promise<ProductSummary[]> => {
  'use cache'
  const validKey =
    isCategoryIdShape(categoryId) && PRODUCT_SORTS.includes(sort) && isCacheCount(page, Number.MAX_SAFE_INTEGER)
  if (!validKey) return rejectCacheArguments('products.page')
  cacheTag(PRODUCTS_TAG)
  cacheLife('hours')

  if (!(await isCategoryId(categoryId)) || page > toPageCount(await countCatalog(categoryId))) {
    cacheLife(SKIP_CACHE_ENTRY)
    return []
  }
  return selectPage({ name: 'products.page', where: inCategory(categoryId), sort, page })
}

const clampPage = (requested: number, pageCount: number) => Math.min(Math.max(requested, 1), pageCount)

/**
 * The page of a ProductQuery is a number (parseProductQuery already turned the URL string into one); a string
 * such as the raw `searchParams.page` is not accepted and reads as page 1. Only an own data property counts,
 * and anything that throws while being read (a getter, a hostile or revoked Proxy) also reads as page 1.
 */
const readPage = (raw: unknown): number => {
  try {
    if (typeof raw !== 'object' || raw === null) return 1
    const descriptor = Object.getOwnPropertyDescriptor(raw, 'page')
    const page: unknown = descriptor && 'value' in descriptor ? descriptor.value : undefined
    return typeof page === 'number' && Number.isSafeInteger(page) && page >= 1 ? page : 1
  } catch {
    return 1
  }
}

const resolveCategory = async (slug: string | null) => {
  if (slug === null) return null
  const known = await getCategoryRows()
  return known.find((row) => row.slug === slug) ?? null
}

type ListingPage = { items: ProductSummary[]; total: number; pageCount: number; page: number }

const emptyPage = (): ListingPage => ({ items: [], total: 0, pageCount: 1, page: 1 })

type ListingInput = { categoryId: number | null; sort: ProductSort; page: number }

const listCatalog = async ({ categoryId, sort, page: requested }: ListingInput): Promise<ListingPage> => {
  const total = await countCatalog(categoryId)
  if (total === 0) return emptyPage()
  const pageCount = toPageCount(total)
  const page = clampPage(requested, pageCount)
  const items = await getCatalogPage(categoryId, sort, page)
  return { items, total, pageCount, page }
}

// User text never becomes a cache key or a tag (ADR-0008), and never reaches a log through a query error: dbQuery
// replaces the error, whose Drizzle original carries the bound `%<q>%` in `params` (ADR-0011).
const searchCatalog = async ({ categoryId, sort, page: requested, text }: ListingInput & { text: string }) => {
  const where = and(inCategory(categoryId), nameContains(text))
  const total = await countWhere({ name: 'products.search-count', where })
  // An empty result is the cheapest request to repeat; stop at one query instead of two.
  if (total === 0) return emptyPage()
  const pageCount = toPageCount(total)
  const page = clampPage(requested, pageCount)
  const items = await selectPage({ name: 'products.search-page', where, sort, page })
  return { items, total, pageCount, page }
}

export const listProducts = async (query: ProductQuery): Promise<ProductListing> => {
  // Re-parse instead of trusting the type: the parser never throws and maps an unknown sort, a non-string q or
  // category, or a q with control characters to defaults. The page is a number here: readPage handles it.
  const { category: requested, sort, q } = parseProductQuery(query)
  const requestedPage = readPage(query)

  // Without this, an uncached query during prerender logs blocking-prerender-current-time on every request (K7).
  if (q !== '') await connection()

  const category = await resolveCategory(requested)
  const input = { categoryId: category?.id ?? null, sort, page: requestedPage }
  const { items, total, pageCount, page } =
    q === '' ? await listCatalog(input) : await searchCatalog({ ...input, text: q })
  return { items, total, pageCount, query: { category: category?.slug ?? null, sort, q, page } }
}
