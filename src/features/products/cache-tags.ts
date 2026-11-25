// Every product cache tag and the tags each kind of product write invalidates (ADR-0019, ADR-0003). Imports nothing,
// so the cached queries, the Server Actions and their tests share one list.

// Listings, featured, sitemap, categories and counts: they show names and prices, so every product write refreshes them.
export const PRODUCTS_TAG = 'products'

// The catalogue's slug list (getCatalogSlugs) only. Every detail page reads it, so its tag rides up to every
// /products/<slug> entry: only a change to the set of slugs may invalidate it.
export const PRODUCT_SLUGS_TAG = 'product-slugs'

// One product's detail page. The payment webhook (M6) also invalidates it after a stock decrement.
export const productTag = (slug: string): `product:${string}` => `product:${slug}`

// fields: name, price, description or stock of an existing product (M5 admin edit).
// slug-set: a product created, deleted, hidden or renamed. None of these exists in M5 (decision 3A).
export type ProductWrite = { slug: string; change: 'fields' } | { slug: string; change: 'slug-set' }

export const tagsForProductWrite = ({ slug, change }: ProductWrite): readonly string[] =>
  change === 'slug-set'
    ? [productTag(slug), PRODUCTS_TAG, PRODUCT_SLUGS_TAG]
    : [productTag(slug), PRODUCTS_TAG]
