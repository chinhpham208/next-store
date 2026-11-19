import { CursorBlock } from '@/components/ui/cursor-block'
import { ProductCard } from '@/features/products/components/product-card'
import type { ProductSummary } from '@/features/products/types'

export type ProductGridProps = { products: ProductSummary[]; label: string }

// No link in the empty state: link colour on surface-muted is below 4.5:1 (design-system review, NS-27).
const EmptyState = () => (
  <div className="flex flex-col items-start gap-4 rounded-md bg-surface-muted px-6 py-10 md:p-16">
    <CursorBlock className="size-8" />
    <p className="text-xl font-semibold md:text-2xl">Chưa có sản phẩm nổi bật.</p>
    <p className="text-muted-foreground">Hàng mới đang được đóng gói, quay lại sau nhé.</p>
  </div>
)

export const ProductGrid = ({ products, label }: ProductGridProps) => {
  if (products.length === 0) return <EmptyState />

  return (
    <ul aria-label={label} className="grid grid-cols-2 gap-x-4 gap-y-10 md:grid-cols-3 md:gap-x-8 md:gap-y-16">
      {products.map((product) => (
        <li key={product.slug}>
          <ProductCard product={product} />
        </li>
      ))}
    </ul>
  )
}
