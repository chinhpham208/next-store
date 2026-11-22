import Form from 'next/form'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  buildProductsHref,
  DEFAULT_PRODUCT_QUERY,
  MAX_QUERY_LENGTH,
  PRODUCT_SORTS,
  type ProductQuery,
  type ProductSort,
} from '@/features/products/schema'
import type { CategoryOption } from '@/features/products/types'

export type ProductFiltersProps = { categories: CategoryOption[]; query: ProductQuery }

export type SortLinksProps = { query: ProductQuery }

const SEARCH_INPUT_ID = 'product-search'

const SORT_LABELS: Record<ProductSort, string> = {
  newest: 'Mới nhất',
  'price-asc': 'Giá tăng dần',
  'price-desc': 'Giá giảm dần',
}

// Selected = inverted fill + bold + an 8 px square, so the state never rests on colour alone (WCAG 1.4.1).
const CATEGORY_LINK_CLASS =
  'inline-flex min-h-11 items-center gap-2 rounded-md border border-border-strong px-4 text-sm font-medium text-foreground hover:bg-surface-muted aria-[current=true]:border-foreground aria-[current=true]:bg-foreground aria-[current=true]:font-semibold aria-[current=true]:text-background aria-[current=true]:before:size-2 aria-[current=true]:before:bg-background'

// Selected = foreground + bold + thick underline, not colour alone.
const SORT_LINK_CLASS =
  'inline-flex min-h-11 items-center text-sm text-muted-foreground underline-offset-6 hover:text-foreground hover:underline aria-[current=true]:font-semibold aria-[current=true]:text-foreground aria-[current=true]:underline aria-[current=true]:decoration-2'

// "true", not "page": every option links to /products, so the current one marks a choice within a set.
const currentIf = (selected: boolean) => (selected ? 'true' : undefined)

// A GET form: submitting it is a plain navigation to /products?…, so it works without JavaScript and the URL
// stays the only state. Only non-default category and sort ride along; page is dropped so a new search starts
// at page 1.
const SearchForm = ({ query }: { query: ProductQuery }) => (
  <Form action="/products" role="search" className="flex flex-col gap-2 md:w-96 md:flex-none">
    <label htmlFor={SEARCH_INPUT_ID} className="text-sm font-medium text-foreground">
      Tìm sản phẩm
    </label>
    <div className="flex gap-2">
      {/* Uncontrolled, so defaultValue is read only on mount: a soft navigation that changes q (Back, Forward, a
          link) re-renders with the new value but the DOM keeps the old text. Keying on q remounts the input so the
          box always matches the URL (NS-57), without "use client" or state. Text typed but not submitted still
          survives links that keep q (category, sort): accepted, since those links carry the submitted q anyway. */}
      <Input
        key={query.q}
        id={SEARCH_INPUT_ID}
        type="search"
        name="q"
        maxLength={MAX_QUERY_LENGTH}
        defaultValue={query.q}
        placeholder="Ví dụ: git"
        autoComplete="off"
      />
      {query.category ? <input type="hidden" name="category" value={query.category} /> : null}
      {query.sort === DEFAULT_PRODUCT_QUERY.sort ? null : <input type="hidden" name="sort" value={query.sort} />}
      <Button type="submit" variant="primary">
        Tìm
      </Button>
    </div>
  </Form>
)

// Changing category keeps q and sort and drops page: page 2 of one category means nothing in another.
const CategoryLinks = ({ categories, query }: ProductFiltersProps) => {
  const options = [{ slug: null, name: 'Tất cả' }, ...categories]
  return (
    <nav aria-label="Danh mục" className="flex flex-col gap-2">
      <span aria-hidden="true" className="text-sm font-medium">
        Danh mục
      </span>
      <ul className="flex flex-wrap gap-2">
        {options.map((option) => (
          <li key={option.slug ?? ''}>
            <Link
              href={buildProductsHref({ category: option.slug, q: query.q, sort: query.sort })}
              aria-current={currentIf(option.slug === query.category)}
              className={CATEGORY_LINK_CLASS}
            >
              {option.name}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  )
}

export const ProductFilters = ({ categories, query }: ProductFiltersProps) => (
  <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between md:gap-8">
    <SearchForm query={query} />
    <CategoryLinks categories={categories} query={query} />
  </div>
)

// A link group rather than a <select>: no JavaScript needed and the URL changes on click (owner decision 8).
// Changing sort keeps category and q and drops page.
export const SortLinks = ({ query }: SortLinksProps) => (
  <nav aria-label="Sắp xếp" className="flex flex-wrap items-center gap-x-4">
    <span aria-hidden="true" className="text-sm font-medium text-muted-foreground">
      Sắp xếp
    </span>
    <ul className="flex flex-wrap gap-x-4">
      {PRODUCT_SORTS.map((sort) => (
        <li key={sort}>
          <Link
            href={buildProductsHref({ category: query.category, q: query.q, sort })}
            aria-current={currentIf(sort === query.sort)}
            className={SORT_LINK_CLASS}
          >
            {SORT_LABELS[sort]}
          </Link>
        </li>
      ))}
    </ul>
  </nav>
)
