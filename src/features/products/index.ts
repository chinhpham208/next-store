// The shop's entry of products. The admin part (edit form, admin table, admin reads, edit messages) is in admin.ts,
// which only src/app/admin/** imports (audit PR #108 M-1).
export {
  getAllProductSlugs,
  getCategories,
  getFeaturedProducts,
  getProductBySlug,
  getProductSitemapEntries,
  listProducts,
  type ProductSitemapEntry,
} from '@/features/products/queries'
export { getProductMetadata } from '@/features/products/metadata'
export { renderProductName } from '@/features/products/components/product-name'
export { ProductGrid, type ProductGridProps } from '@/features/products/components/product-grid'
export {
  ProductCatalog,
  ProductCatalogSkeleton,
  ProductCatalogView,
  type ProductCatalogProps,
  type ProductCatalogViewProps,
} from '@/features/products/components/product-catalog'
export {
  ProductDetailSection,
  ProductDetailSkeleton,
  ProductDetailView,
  type ProductDetailSectionProps,
  type ProductDetailViewProps,
  type ProductPurchase,
} from '@/features/products/components/product-detail'
export type {
  CategoryOption,
  ProductDetail,
  ProductListing,
  ProductSummary,
} from '@/features/products/types'
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
