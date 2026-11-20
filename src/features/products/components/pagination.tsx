import Link from 'next/link'
import { cn } from '@/lib/cn'
import { buildProductsHref, type ProductQuery } from '@/features/products/schema'

export type PaginationProps = { query: ProductQuery; pageCount: number }

const ITEM_CLASS =
  'inline-flex min-h-11 min-w-11 items-center justify-center rounded-md border border-border-strong px-4 text-sm font-medium text-foreground'
const LINK_CLASS =
  'hover:bg-surface-muted aria-[current=page]:border-foreground aria-[current=page]:bg-foreground aria-[current=page]:font-semibold aria-[current=page]:text-background'
// A dashed border, not just a lighter colour, marks the step that is not available.
const DISABLED_CLASS = 'border-dashed border-border text-muted-foreground cursor-not-allowed'

type StepProps = { query: ProductQuery; page: number; enabled: boolean; label: string }

// At either end the step is a <span>, not a link: a disabled link would still be focusable and announced.
const Step = ({ query, page, enabled, label }: StepProps) =>
  enabled ? (
    <Link href={buildProductsHref({ ...query, page })} className={cn(ITEM_CLASS, LINK_CLASS)}>
      {label}
    </Link>
  ) : (
    <span aria-disabled="true" className={cn(ITEM_CLASS, DISABLED_CLASS)}>
      {label}
    </span>
  )

// query.page is already clamped to 1..pageCount by listProducts, so every link points at a page that exists.
// Changing page keeps category, q and sort; page 1 is written without ?page (buildProductsHref drops it).
export const Pagination = ({ query, pageCount }: PaginationProps) => {
  if (pageCount <= 1) return null
  const pages = Array.from({ length: pageCount }, (_, index) => index + 1)

  return (
    <nav aria-label="Phân trang" className="pt-4 md:pt-8">
      <ul className="flex flex-wrap items-center justify-center gap-2">
        <li>
          <Step query={query} page={query.page - 1} enabled={query.page > 1} label="Trang trước" />
        </li>
        {pages.map((page) => (
          <li key={page}>
            <Link
              href={buildProductsHref({ ...query, page })}
              aria-current={page === query.page ? 'page' : undefined}
              className={cn(ITEM_CLASS, LINK_CLASS)}
            >
              {String(page)}
            </Link>
          </li>
        ))}
        <li>
          <Step query={query} page={query.page + 1} enabled={query.page < pageCount} label="Trang sau" />
        </li>
      </ul>
    </nav>
  )
}
