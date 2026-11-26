export {
  getAllProductSlugs,
  getCategories,
  getFeaturedProducts,
  getProductBySlug,
  getProductSitemapEntries,
  listProducts,
  type ProductSitemapEntry,
} from '@/features/products/queries'
export { getProductForAdmin, listProductsForAdmin } from '@/features/products/admin-queries'
// The edit action is not re-exported: only the edit form references it, so its id sits in the manifest of the edit
// page alone (audit PR #107 nit). It still checks the session itself, first.
export { ProductEditForm, type ProductEditFormProps } from '@/features/products/components/product-edit-form'
export {
  AdminProductTable,
  AdminProductTableSkeleton,
  AdminProductTableView,
} from '@/features/products/components/admin-product-table'
export {
  PRODUCT_EDIT_SAVING,
  productEditErrorMessage,
  productEditStateMessage,
  type ProductEditStateMessage,
} from '@/features/products/edit-messages'
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
  AdminProductForm,
  AdminProductRow,
  CategoryOption,
  ProductDetail,
  ProductEditErrors,
  ProductEditField,
  ProductEditFieldErrors,
  ProductEditState,
  ProductListing,
  ProductSummary,
} from '@/features/products/types'
export {
  buildProductsHref,
  DEFAULT_PRODUCT_QUERY,
  isProductSlug,
  MAX_QUERY_LENGTH,
  PAGE_SIZE,
  parseProductEdit,
  parseProductQuery,
  PRODUCT_EDIT_LIMITS,
  PRODUCT_SORTS,
  type ProductQuery,
  type ProductSort,
} from '@/features/products/schema'
