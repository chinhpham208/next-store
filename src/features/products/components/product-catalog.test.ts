import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_PRODUCT_QUERY,
  ProductCatalog,
  ProductCatalogSkeleton,
  ProductCatalogView,
  type CategoryOption,
  type ProductListing,
  type ProductQuery,
  type ProductSummary,
} from '@/features/products'
import { getCategories, listProducts } from '@/features/products/queries'

// The view is pure; ProductCatalog only wires searchParams to the queries, which listing.test.ts covers against
// a real database. Mocked here so the test is about which query the links are built from.
vi.mock('@/features/products/queries', () => ({
  listProducts: vi.fn(),
  getCategories: vi.fn(),
  getFeaturedProducts: vi.fn(),
  getProductBySlug: vi.fn(),
  getAllProductSlugs: vi.fn(),
}))

const CATS: CategoryOption[] = [
  { slug: 'ao-thun', name: 'Áo thun' },
  { slug: 'coc', name: 'Cốc' },
  { slug: 'sticker', name: 'Sticker' },
  { slug: 'sach', name: 'Sách' },
]

const items: ProductSummary[] = Array.from({ length: 12 }, (_, index) => ({
  slug: `san-pham-${index + 1}`,
  name: `Sản phẩm ${index + 1}`,
  price: 100000 + index * 1000,
  image: '/images/coc.svg',
  categoryName: 'Cốc',
  inStock: true,
}))

const listingOf = (query: Partial<ProductQuery>, extra: Partial<ProductListing> = {}): ProductListing => ({
  items,
  total: 24,
  pageCount: 2,
  query: { ...DEFAULT_PRODUCT_QUERY, ...query },
  ...extra,
})

const view = (query: Partial<ProductQuery>, extra: Partial<ProductListing> = {}) =>
  renderToStaticMarkup(createElement(ProductCatalogView, { categories: CATS, listing: listingOf(query, extra) }))

// next/link writes href after the other props, so attributes are checked per element, never in a fixed order.
const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const tagsOf = (html: string, tag: string, text: string): string[] =>
  [...html.matchAll(new RegExp(`<${tag}(\\s[^>]*)?>${escapeRegExp(text)}</${tag}>`, 'g'))].map((m) => m[1] ?? '')
const anchorOf = (html: string, text: string): string => {
  const found = tagsOf(html, 'a', text)
  expect(found, `exactly one <a> with text "${text}"`).toHaveLength(1)
  return found[0] ?? ''
}
const hrefOf = (attributes: string) => /\shref="([^"]*)"/.exec(attributes)?.[1]
const navOf = (html: string, label: string): string => {
  const match = new RegExp(`<nav[^>]*aria-label="${label}"[^>]*>([\\s\\S]*?)</nav>`).exec(html)
  expect(match, `nav "${label}"`).not.toBeNull()
  return match?.[1] ?? ''
}

beforeEach(() => vi.clearAllMocks())

describe('ProductCatalogView', () => {
  it('marks "Tất cả" and "Mới nhất" as current by default', () => {
    const html = view({})
    const all = anchorOf(navOf(html, 'Danh mục'), 'Tất cả')
    expect(hrefOf(all)).toBe('/products')
    expect(all).toContain('aria-current="true"')
    expect(anchorOf(navOf(html, 'Sắp xếp'), 'Mới nhất')).toContain('aria-current="true"')
    expect(anchorOf(navOf(html, 'Danh mục'), 'Cốc')).not.toContain('aria-current')
  })

  it('marks the applied category and sort as current, and only those', () => {
    const html = view({ category: 'coc', sort: 'price-asc' })
    expect(anchorOf(navOf(html, 'Danh mục'), 'Cốc')).toContain('aria-current="true"')
    expect(anchorOf(navOf(html, 'Sắp xếp'), 'Giá tăng dần')).toContain('aria-current="true"')
    expect(navOf(html, 'Danh mục').match(/aria-current/g)).toHaveLength(1)
    expect(navOf(html, 'Sắp xếp').match(/aria-current/g)).toHaveLength(1)
  })

  it('US-03: category links keep q and sort and drop page', () => {
    const nav = navOf(view({ q: 'git', sort: 'price-asc', page: 2 }), 'Danh mục')
    expect(hrefOf(anchorOf(nav, 'Sách'))).toBe('/products?category=sach&amp;q=git&amp;sort=price-asc')
    expect(hrefOf(anchorOf(nav, 'Tất cả'))).toBe('/products?q=git&amp;sort=price-asc')
    expect(nav).not.toContain('page=')
  })

  it('US-03: sort links keep category and q and drop page', () => {
    const nav = navOf(view({ category: 'coc', q: 'merge', page: 2 }), 'Sắp xếp')
    expect(hrefOf(anchorOf(nav, 'Giá giảm dần'))).toBe('/products?category=coc&amp;q=merge&amp;sort=price-desc')
    expect(hrefOf(anchorOf(nav, 'Mới nhất'))).toBe('/products?category=coc&amp;q=merge')
    expect(nav).not.toContain('page=')
  })

  it('sort is a group of plain links, so it works without JavaScript', () => {
    const nav = navOf(view({}), 'Sắp xếp')
    expect(nav.match(/<a\s/g)).toHaveLength(3)
    expect(nav).not.toMatch(/<(select|button|form)/)
  })

  it('marks the current sort with more than colour (weight and underline)', () => {
    const current = anchorOf(navOf(view({}), 'Sắp xếp'), 'Mới nhất')
    expect(current).toContain('aria-[current=true]:font-semibold')
    expect(current).toContain('aria-[current=true]:underline')
  })

  it('marks the current category with more than colour (weight and a square marker)', () => {
    const current = anchorOf(navOf(view({}), 'Danh mục'), 'Tất cả')
    expect(current).toContain('aria-[current=true]:font-semibold')
    expect(current).toContain('aria-[current=true]:before:size-2')
  })

  it('US-03: the search form carries category and sort as hidden fields and never page', () => {
    const html = view({ category: 'coc', sort: 'price-desc', q: 'merge', page: 2 })
    expect(html).toMatch(/<form[^>]*role="search"/)
    expect(html).toMatch(/<form[^>]*action="\/products"/)
    expect(html).toMatch(/<input[^>]*type="search"[^>]*name="q"[^>]*value="merge"/)
    expect(html).toMatch(/<input[^>]*type="hidden"[^>]*name="category"[^>]*value="coc"/)
    expect(html).toMatch(/<input[^>]*type="hidden"[^>]*name="sort"[^>]*value="price-desc"/)
    expect(html).not.toContain('name="page"')
  })

  it('gives the search box a visible label, a length cap and a submit button "Tìm"', () => {
    const html = view({})
    const id = /<input[^>]*type="search"[^>]*id="([^"]+)"/.exec(html)?.[1] ?? /<input[^>]*id="([^"]+)"[^>]*type="search"/.exec(html)?.[1]
    expect(id).toBeTruthy()
    expect(html).toContain(`<label for="${id}" class="text-sm font-medium text-foreground">Tìm sản phẩm</label>`)
    expect(html).toMatch(/<input[^>]*type="search"[^>]*maxLength="60"/)
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*>Tìm<\/button>/)
  })

  it('omits hidden fields that hold defaults', () => {
    expect(view({})).not.toContain('type="hidden"')
  })

  it('US-02: shows the result count and the labelled grid', () => {
    const html = view({})
    expect(html).toMatch(/role="status"[^>]*>24 sản phẩm</)
    expect(html).toContain('aria-label="Danh sách sản phẩm"')
    expect(html.match(/<li/g)?.length).toBeGreaterThanOrEqual(12)
  })

  it('has no heading other than the product names (no "Kết quả cho" heading)', () => {
    const html = view({ q: 'git' })
    expect(html).not.toMatch(/<h[12456]/)
    expect(html).not.toContain('Kết quả cho')
  })

  it('US-02: paginates when there is more than one page', () => {
    const nav = navOf(view({ category: 'x', page: 1 }), 'Phân trang')
    expect(anchorOf(nav, '1')).toContain('aria-current="page"')
    expect(anchorOf(nav, '2')).not.toContain('aria-current')
    expect(hrefOf(anchorOf(nav, 'Trang sau'))).toBe('/products?category=x&amp;page=2')
    expect(tagsOf(nav, 'span', 'Trang trước')[0]).toContain('aria-disabled="true"')
    expect(tagsOf(nav, 'a', 'Trang trước')).toHaveLength(0)
  })

  it('US-03: page links keep category, q and sort', () => {
    const nav = navOf(view({ category: 'coc', q: 'git', sort: 'price-desc', page: 1 }), 'Phân trang')
    expect(hrefOf(anchorOf(nav, '2'))).toBe('/products?category=coc&amp;q=git&amp;sort=price-desc&amp;page=2')
  })

  it('links page 1 without a page parameter and disables "Trang sau" on the last page', () => {
    const nav = navOf(view({ page: 2, sort: 'price-asc' }), 'Phân trang')
    expect(hrefOf(anchorOf(nav, 'Trang trước'))).toBe('/products?sort=price-asc')
    expect(hrefOf(anchorOf(nav, '1'))).toBe('/products?sort=price-asc')
    expect(tagsOf(nav, 'span', 'Trang sau')[0]).toContain('aria-disabled="true"')
  })

  it('hides pagination on a single page', () => {
    expect(view({}, { total: 6, pageCount: 1 })).not.toContain('aria-label="Phân trang"')
  })

  it('shows the empty state with a primary "Xoá bộ lọc" button link and no grid or pagination', () => {
    const html = view({ q: 'khong-co' }, { items: [], total: 0, pageCount: 1 })
    expect(html).toContain('Không tìm thấy sản phẩm phù hợp.')
    expect(html).toContain('Thử từ khoá khác hoặc bỏ bớt bộ lọc.')
    const reset = anchorOf(html, 'Xoá bộ lọc')
    expect(hrefOf(reset)).toBe('/products')
    expect(reset).toContain('bg-foreground')
    expect(html).toMatch(/role="status"[^>]*>0 sản phẩm</)
    expect(html).not.toContain('aria-label="Danh sách sản phẩm"')
    expect(html).not.toContain('aria-label="Phân trang"')
  })

  it('escapes the search term', () => {
    const html = view({ q: '"><script>alert(1)</script>' })
    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).not.toContain('"><script>')
  })
})

describe('ProductCatalog', () => {
  it('builds every link from the applied query, never from the raw searchParams', async () => {
    // The listing dropped an unknown category and clamped page 99 to 2; links must follow that, not the URL.
    vi.mocked(listProducts).mockResolvedValue(listingOf({ category: null, sort: 'price-asc', page: 2 }))
    vi.mocked(getCategories).mockResolvedValue(CATS)
    const searchParams = Promise.resolve({ category: 'khong-co', sort: 'price-asc', page: '99' })

    const html = renderToStaticMarkup(await ProductCatalog({ searchParams }))

    expect(listProducts).toHaveBeenCalledWith({ category: 'khong-co', sort: 'price-asc', q: '', page: 99 })
    expect(html).not.toContain('khong-co')
    expect(html).not.toContain('page=99')
    expect(anchorOf(navOf(html, 'Danh mục'), 'Tất cả')).toContain('aria-current="true"')
    expect(anchorOf(navOf(html, 'Phân trang'), '2')).toContain('aria-current="page"')
  })

  it('falls back to the default query for hostile searchParams', async () => {
    vi.mocked(listProducts).mockResolvedValue(listingOf({}))
    vi.mocked(getCategories).mockResolvedValue(CATS)
    const searchParams = Promise.resolve({ page: 'abc', sort: ['a', 'b'], q: '\u0000' })

    await ProductCatalog({ searchParams })

    expect(listProducts).toHaveBeenCalledWith({ ...DEFAULT_PRODUCT_QUERY })
  })
})

describe('ProductCatalogSkeleton', () => {
  it('is a busy region with only hidden blocks and an sr-only "Đang tải…"', () => {
    const html = renderToStaticMarkup(createElement(ProductCatalogSkeleton))
    expect(html).toMatch(/^<div[^>]*aria-busy="true"/)
    expect(html).toContain('<p class="sr-only">Đang tải…</p>')
    expect(html).toContain('bg-border')
    expect(html).not.toMatch(/animate-/)
    expect(html).not.toContain('<a ')
  })
})

describe('/products page', () => {
  const source = readFileSync('src/app/(shop)/products/page.tsx', 'utf8')

  it('keeps the h1 in the static shell and reads searchParams only inside Suspense', () => {
    expect(source).toMatch(/<h1[^>]*>Sản phẩm<\/h1>/)
    expect(source).toMatch(
      /<Suspense fallback=\{<ProductCatalogSkeleton \/>\}>\s*<ProductCatalog searchParams=\{searchParams\} \/>\s*<\/Suspense>/,
    )
    expect(source).not.toMatch(/export default async/)
    expect(source).not.toMatch(/await searchParams/)
  })

  it('renders user text only through JSX', () => {
    for (const file of ['product-catalog.tsx', 'product-filters.tsx', 'pagination.tsx']) {
      const code = readFileSync(`src/features/products/components/${file}`, 'utf8')
      expect(code, file).not.toContain('dangerouslySetInnerHTML')
      expect(code, file).not.toContain("'use client'")
    }
    expect(source).not.toContain('dangerouslySetInnerHTML')
  })
})
