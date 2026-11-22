import type { ProductQuery } from '@/features/products/schema'

export type ProductSummary = {
  slug: string
  name: string
  price: number
  image: string
  categoryName: string
  inStock: boolean
}

export type ProductDetail = {
  slug: string
  name: string
  description: string
  price: number
  image: string
  categorySlug: string
  categoryName: string
  stock: number
}

export type CategoryOption = {
  slug: string
  name: string
}

// `query` is what was actually applied: an unknown category is null and the page is clamped to 1..pageCount,
// so links built from it never point at a filter or a page the listing did not show.
export type ProductListing = {
  items: ProductSummary[]
  total: number
  pageCount: number
  query: ProductQuery
}
