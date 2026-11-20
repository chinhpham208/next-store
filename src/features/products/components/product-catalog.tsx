import Link from 'next/link'
import { buttonVariants } from '@/components/ui/button'
import { CursorBlock } from '@/components/ui/cursor-block'
import { Skeleton } from '@/components/ui/skeleton'
import { Pagination } from '@/features/products/components/pagination'
import { ProductFilters, SortLinks } from '@/features/products/components/product-filters'
import { ProductGrid } from '@/features/products/components/product-grid'
import { getCategories, listProducts } from '@/features/products/queries'
import { buildProductsHref, PAGE_SIZE, parseProductQuery } from '@/features/products/schema'
import type { CategoryOption, ProductListing } from '@/features/products/types'

export type ProductCatalogViewProps = { listing: ProductListing; categories: CategoryOption[] }

export type ProductCatalogProps = { searchParams: Promise<Record<string, string | string[] | undefined>> }

const LIST_LABEL = 'Danh sách sản phẩm'

// View and skeleton share these so swapping one for the other does not move the page.
const CATALOG_CLASS = 'flex flex-col gap-6 md:gap-8'
const CONTROLS_CLASS = 'flex flex-col gap-6 md:flex-row md:items-end md:justify-between md:gap-8'
const RESULT_BAR_CLASS = 'flex flex-wrap items-center justify-between gap-x-6 border-t border-border pt-4'
const GRID_CLASS = 'grid grid-cols-2 gap-x-4 gap-y-10 md:grid-cols-3 md:gap-x-8 md:gap-y-16'

// The action is a Button-styled link, not a text link: link colour on surface-muted is below 4.5:1.
const EmptyResult = () => (
  <div className="flex flex-col items-start gap-4 rounded-md bg-surface-muted px-6 py-10 md:p-16">
    <CursorBlock className="size-8" />
    <p className="text-xl font-semibold md:text-2xl">Không tìm thấy sản phẩm phù hợp.</p>
    <p className="text-muted-foreground">Thử từ khoá khác hoặc bỏ bớt bộ lọc.</p>
    <Link href={buildProductsHref({})} className={buttonVariants({ variant: 'primary' })}>
      Xoá bộ lọc
    </Link>
  </div>
)

/**
 * Pure presentation. Every link is built from listing.query — what the listing actually applied (unknown
 * category dropped, page clamped) — and never from the raw URL, so no link leads to a filter or page that was
 * not shown. q is only ever rendered as JSX text or an attribute value, which React escapes.
 */
export const ProductCatalogView = ({ listing, categories }: ProductCatalogViewProps) => {
  const { query, total, pageCount, items } = listing

  return (
    <div className={CATALOG_CLASS}>
      <ProductFilters categories={categories} query={query} />
      <div className={RESULT_BAR_CLASS}>
        {/* One template string: "{total} sản phẩm" would stream as two text nodes split by a comment. */}
        <p role="status" className="font-semibold">{`${total} sản phẩm`}</p>
        <SortLinks query={query} />
      </div>
      {total === 0 ? (
        <EmptyResult />
      ) : (
        <>
          <ProductGrid products={items} label={LIST_LABEL} />
          <Pagination query={query} pageCount={pageCount} />
        </>
      )}
    </div>
  )
}

// Runs inside the page's <Suspense>: awaiting searchParams makes this subtree request-time while the h1 and
// layout stay in the prerendered shell. parseProductQuery is the only reader of the raw params (Global
// Constraints); listProducts keeps the unfiltered listing on its cached path and runs a search after
// connection(), outside the cache (ADR-0008).
export const ProductCatalog = async ({ searchParams }: ProductCatalogProps) => {
  const query = parseProductQuery(await searchParams)
  const [listing, categories] = await Promise.all([listProducts(query), getCategories()])
  return <ProductCatalogView listing={listing} categories={categories} />
}

const CARD_PLACEHOLDERS = Array.from({ length: PAGE_SIZE }, (_, index) => index)
const CATEGORY_PLACEHOLDERS = ['w-20', 'w-24', 'w-16', 'w-22', 'w-18']
const SORT_PLACEHOLDERS = ['w-18', 'w-22', 'w-22']

// Same blocks as the view, each at the line height of the real content (design-system §2, Skeleton): label
// h-5 (text-sm), controls h-11, count h-6 (text-base), card meta h-6, name h-6 / h-7, price h-5 / h-6.
export const ProductCatalogSkeleton = () => (
  <div aria-busy="true" className={CATALOG_CLASS}>
    <p className="sr-only">Đang tải…</p>
    <div className={CONTROLS_CLASS}>
      <div className="flex flex-col gap-2 md:w-96 md:flex-none">
        <Skeleton className="h-5 w-26" />
        <Skeleton className="h-11 rounded-md" />
      </div>
      <div className="flex flex-col gap-2">
        <Skeleton className="h-5 w-18" />
        <div className="flex flex-wrap gap-2">
          {CATEGORY_PLACEHOLDERS.map((width, index) => (
            <Skeleton key={index} className={`h-11 rounded-md ${width}`} />
          ))}
        </div>
      </div>
    </div>
    <div className={RESULT_BAR_CLASS}>
      <Skeleton className="h-6 w-28" />
      <div className="flex min-h-11 flex-wrap items-center gap-x-4">
        {SORT_PLACEHOLDERS.map((width, index) => (
          <Skeleton key={index} className={`h-5 ${width}`} />
        ))}
      </div>
    </div>
    <div className={GRID_CLASS}>
      {CARD_PLACEHOLDERS.map((index) => (
        <div key={index} className="flex flex-col gap-3 md:gap-4">
          <Skeleton className="aspect-square rounded-md" />
          <div className="flex h-6 items-center">
            <Skeleton className="h-4 w-16" />
          </div>
          <Skeleton className="h-6 w-full md:h-7" />
          <div className="pt-1 md:pt-2">
            <Skeleton className="h-5 w-24 md:h-6" />
          </div>
        </div>
      ))}
    </div>
  </div>
)
