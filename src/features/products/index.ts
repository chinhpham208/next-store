export {
  getAllProductSlugs,
  getCategories,
  getFeaturedProducts,
  getProductBySlug,
  listProducts,
} from '@/features/products/queries'
export { getProductMetadata } from '@/features/products/metadata'
export { isKnownProductSlug } from '@/features/products/slug-guard'
export { ProductGrid, type ProductGridProps } from '@/features/products/components/product-grid'
export {
  ProductDetailSection,
  ProductDetailSkeleton,
  ProductDetailView,
  type ProductDetailSectionProps,
  type ProductDetailViewProps,
} from '@/features/products/components/product-detail'
export type { CategoryOption, ProductDetail, ProductListing, ProductSummary } from '@/features/products/types'
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
