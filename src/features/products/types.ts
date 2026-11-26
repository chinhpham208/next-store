import type { ProductEditFieldErrors, ProductQuery } from '@/features/products/schema'

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

// Admin edit (M5 Task 9, ADR-0019). Imported by the edit form (a client file), so types only. The input types
// live next to their parser in schema.ts; re-exported here so messages and the form import types.ts only.
export type { ProductEdit, ProductEditErrors, ProductEditField, ProductEditFieldErrors } from '@/features/products/schema'

export type ProductEditActionError = 'unauthorized' | 'not-found' | 'conflict' | 'unavailable'

// formError: the slug or expectedUpdatedAt is wrong, or the POST was not this form: nothing the admin typed.
export type ProductEditState =
  | { status: 'idle' }
  | { status: 'saved'; updatedAt: string }
  | { status: 'invalid'; fieldErrors: ProductEditFieldErrors; formError?: 'invalid' }
  | { status: 'error'; error: ProductEditActionError }

export type AdminProductRow = { slug: string; name: string; price: number; stock: number }

export type AdminProductForm = {
  slug: string
  name: string
  description: string
  price: number
  stock: number
  updatedAt: string
}
