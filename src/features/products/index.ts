export { getFeaturedProducts } from '@/features/products/queries'
export { ProductGrid, type ProductGridProps } from '@/features/products/components/product-grid'
export type { ProductSummary } from '@/features/products/types'
export {
  buildProductsHref,
  DEFAULT_PRODUCT_QUERY,
  isProductSlug,
  MAX_QUERY_LENGTH,
  PAGE_SIZE,
  parseProductQuery,
  PRODUCT_SORTS,
  type ProductQuery,
  type ProductSort,
} from '@/features/products/schema'
