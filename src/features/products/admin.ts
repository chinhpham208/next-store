// The admin entry of products (audit PR #108 M-1): only src/app/admin/** imports it (dependency-cruiser
// `products-admin-entry-only-from-admin`). index.ts is the shop's entry; a client component re-exported there ships
// its chunk, and the id of the action it calls, with every shop page (Turbopack follows the barrel's client
// references). scripts/check-admin-bundle.mjs checks the build after `next build`.
export { getProductForAdmin, listProductsForAdmin } from '@/features/products/admin-queries'
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
export { parseProductEdit, PRODUCT_EDIT_LIMITS } from '@/features/products/schema'
export type {
  AdminProductForm,
  AdminProductRow,
  ProductEditErrors,
  ProductEditField,
  ProductEditFieldErrors,
  ProductEditState,
} from '@/features/products/types'
