import Image from 'next/image'
import { notFound } from 'next/navigation'
import { Breadcrumb, type BreadcrumbItem } from '@/components/layout/breadcrumb'
import { Badge } from '@/components/ui/badge'
import { Container } from '@/components/ui/container'
import { Price } from '@/components/ui/price'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/cn'
import { renderProductName } from '@/features/products/components/product-name'
import { getProductBySlug } from '@/features/products/queries'
import { buildProductsHref } from '@/features/products/schema'
import type { ProductDetail } from '@/features/products/types'

export type ProductDetailViewProps = { product: ProductDetail }

export type ProductDetailSectionProps = { params: Promise<{ slug: string }> }

const IMAGE_SIZE = 800

// View and skeleton share the shell so swapping one for the other does not move the page.
const SHELL_CLASS = 'flex flex-col gap-4 pt-4 pb-16 md:gap-6 md:pt-6 md:pb-24'
const BODY_CLASS = 'grid gap-8 md:grid-cols-2 md:items-start md:gap-16'
const IMAGE_FRAME_CLASS =
  'aspect-square overflow-hidden rounded-md bg-surface-muted outline outline-1 -outline-offset-1 outline-border'

// One template string, not "Còn {stock} sản phẩm": separate text nodes would stream as "Còn <!-- -->12…" and the
// element would no longer contain exactly "Còn N sản phẩm".
const Stock = ({ stock }: { stock: number }) =>
  stock > 0 ? (
    <p className="font-medium">{`Còn ${stock} sản phẩm`}</p>
  ) : (
    <p>
      <Badge variant="sold-out">Hết hàng</Badge>
    </p>
  )

export const ProductDetailView = ({ product }: ProductDetailViewProps) => {
  const inStock = product.stock > 0
  // The product name is the h1 right below, so the trail stops at the category (design-system §2).
  const crumbs: BreadcrumbItem[] = [
    { href: '/', label: 'Trang chủ' },
    { href: '/products', label: 'Sản phẩm' },
    { href: buildProductsHref({ category: product.categorySlug }), label: product.categoryName },
  ]

  return (
    <Container className={SHELL_CLASS}>
      <Breadcrumb crumbs={crumbs} />
      <div className={BODY_CLASS}>
        <div className={IMAGE_FRAME_CLASS}>
          <Image
            src={product.image}
            alt={product.name}
            width={IMAGE_SIZE}
            height={IMAGE_SIZE}
            // The LCP element of the page. Not `priority` (deprecated in Next.js 16) nor `preload`: the image docs
            // recommend eager + high priority instead, and the element is already in the prerendered HTML.
            loading="eager"
            fetchPriority="high"
            // SVG gains nothing from the optimizer, and serving it through it would need dangerouslyAllowSVG.
            unoptimized={product.image.endsWith('.svg')}
            className="size-full object-cover"
          />
        </div>
        <div className="flex flex-col gap-6">
          <h1 className="text-3xl font-bold tracking-tight text-balance break-words md:text-4xl">
            {renderProductName(product.name)}
          </h1>
          <div className="flex flex-wrap items-center gap-4">
            <Price amount={product.price} className={cn('text-2xl md:text-2xl', !inStock && 'text-muted-foreground')} />
            <Stock stock={product.stock} />
          </div>
          <p className="border-t border-border pt-6 text-muted-foreground md:text-lg">{product.description}</p>
          {/* M4 puts the "Thêm vào giỏ" button here; M2 deliberately renders nothing in its place. */}
        </div>
      </div>
    </Container>
  )
}

// Runs inside the page's <Suspense>: with a slug that was not prerendered, the read happens at request time
// after the shell is sent, so this notFound() only swaps the UI — the real 404 status comes from src/proxy.ts
// (M2 Task 12, K3). A database error is not caught here: it reaches (shop)/error.tsx, which shows fixed text.
export const ProductDetailSection = async ({ params }: ProductDetailSectionProps) => {
  const { slug } = await params
  const product = await getProductBySlug(slug)
  if (!product) notFound()
  return <ProductDetailView product={product} />
}

// Same blocks as the view, each at the line height of the real content (design-system §2, Skeleton).
export const ProductDetailSkeleton = () => (
  <Container>
    <div aria-busy="true" className={SHELL_CLASS}>
      <p className="sr-only">Đang tải…</p>
      <div className="flex min-h-11 items-center">
        <Skeleton className="h-5 w-52" />
      </div>
      <div className={BODY_CLASS}>
        <Skeleton className="aspect-square rounded-md" />
        <div className="flex flex-col gap-6">
          <div className="flex flex-col gap-2">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-2/3" />
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <Skeleton className="h-8 w-32" />
            <Skeleton className="h-6 w-36" />
          </div>
          <div className="flex flex-col gap-2 border-t border-border pt-6">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        </div>
      </div>
    </div>
  </Container>
)
