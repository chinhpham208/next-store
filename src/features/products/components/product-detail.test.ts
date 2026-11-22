import { readFileSync } from 'node:fs'
import { createElement, type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getProductBySlug,
  getProductMetadata,
  ProductDetailSection,
  ProductDetailSkeleton,
  ProductDetailView,
  type ProductDetail,
} from '@/features/products'

// The page and the section must read only through getProductBySlug (NS-48 audit of PR #20); the mock lets each
// test assert exactly which reads happened and simulate a missing product or a database error.
vi.mock('@/features/products/queries', () => ({
  getProductBySlug: vi.fn(),
  getAllProductSlugs: vi.fn(),
  getCategories: vi.fn(),
  getFeaturedProducts: vi.fn(),
  listProducts: vi.fn(),
}))

const NOT_FOUND = new Error('NEXT_HTTP_ERROR_FALLBACK;404')
vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw NOT_FOUND
  }),
}))

const product: ProductDetail = {
  slug: 'ao-git-push-force',
  name: 'Áo thun git push --force',
  description: 'Áo thun cotton 100% in dòng lệnh.',
  price: 199000,
  image: '/images/ao-thun.svg',
  categorySlug: 'ao-thun',
  categoryName: 'Áo thun',
  stock: 12,
}
// formatPrice separates amount and symbol with U+00A0, not a plain space.
const NBSP = ' '
const render = (value: ProductDetail) => renderToStaticMarkup(createElement(ProductDetailView, { product: value }))
const textOf = (html: string): string => html.replace(/<[^>]*>/g, '')
const params = (slug: string) => Promise.resolve({ slug })

beforeEach(() => {
  vi.mocked(getProductBySlug).mockResolvedValue(product)
})
afterEach(() => {
  vi.clearAllMocks()
})

describe('ProductDetailView', () => {
  it('US-04: renders image, name, description, price and remaining stock', () => {
    const html = render(product)
    expect(html.match(/<h1/g)).toHaveLength(1)
    expect(html.match(/<img /g)).toHaveLength(1)
    expect(html).toContain('alt="Áo thun git push --force"')
    // The image is the page's LCP element: never lazy.
    expect(html).toMatch(/<img (?=[^>]*fetchPriority="high")(?![^>]*loading="lazy")/)
    expect(html).toContain('Áo thun cotton 100% in dòng lệnh.')
    expect(html).toContain(`199.000${NBSP}₫`)
    expect(html).toContain('>Còn 12 sản phẩm<')
    expect(html).not.toContain('Hết hàng')
  })
  it('US-04: renders "Hết hàng" and no count when stock is 0', () => {
    const html = render({ ...product, stock: 0 })
    expect(html).toContain('Hết hàng')
    expect(html).not.toMatch(/Còn \d+ sản phẩm/)
  })
  it('keeps the h1 text equal to the name and lets a long word break', () => {
    const heading = /<h1([^>]*)>(.*?)<\/h1>/.exec(render(product))
    expect(textOf(heading?.[2] ?? '')).toBe('Áo thun git push --force')
    expect(heading?.[1]).toContain('break-words')
  })
  it('links the category to the filtered listing and the breadcrumb to /products', () => {
    const html = render(product)
    expect(html).toContain('href="/products?category=ao-thun"')
    expect(html).toMatch(/<nav[^>]*aria-label="Đường dẫn"[^>]*>[\s\S]*href="\/products"/)
  })
  it('breadcrumb reads Trang chủ / Sản phẩm / <category> and does not repeat the product name', () => {
    const nav = /<nav[^>]*aria-label="Đường dẫn"[^>]*>([\s\S]*?)<\/nav>/.exec(render(product))?.[1] ?? ''
    expect(textOf(nav)).toBe('Trang chủ/Sản phẩm/Áo thun')
    expect(nav).toContain('href="/"')
    expect(nav).not.toContain(product.name)
  })
  it('has no add-to-cart button before M4', () => {
    const html = render(product)
    expect(html).not.toContain('<button')
    expect(html).not.toContain('Thêm vào giỏ')
  })
})

describe('ProductDetailSkeleton', () => {
  it('is busy, hidden from assistive technology except one loading line, and has no heading', () => {
    const html = renderToStaticMarkup(createElement(ProductDetailSkeleton))
    expect(html).toContain('aria-busy="true"')
    expect(html).toMatch(/<p class="sr-only">Đang tải…<\/p>/)
    expect(html).not.toMatch(/<h1|<img /)
  })
})

describe('ProductDetailSection', () => {
  it('US-04: reads the product by its slug and renders the view', async () => {
    const element: ReactElement = await ProductDetailSection({ params: params('ao-git-push-force') })
    expect(getProductBySlug).toHaveBeenCalledWith('ao-git-push-force')
    expect(renderToStaticMarkup(element)).toContain('>Còn 12 sản phẩm<')
  })
  it('US-05: calls notFound() when the product does not exist', async () => {
    vi.mocked(getProductBySlug).mockResolvedValue(null)
    await expect(ProductDetailSection({ params: params('khong-ton-tai') })).rejects.toBe(NOT_FOUND)
  })
  it('lets a database error reach the error boundary instead of rendering it', async () => {
    vi.mocked(getProductBySlug).mockRejectedValue(new Error('connect ECONNREFUSED postgres://u:secret@h/db'))
    await expect(ProductDetailSection({ params: params('sticker-git') })).rejects.toThrow('ECONNREFUSED')
  })
})

describe('product page', () => {
  it('wraps the detail section in Suspense', () => {
    const source = readFileSync('src/app/(shop)/products/[slug]/page.tsx', 'utf8')
    expect(source).toMatch(
      /<Suspense fallback=\{<ProductDetailSkeleton \/>\}>\s*<ProductDetailSection params=\{params\} \/>\s*<\/Suspense>/,
    )
    expect(source).not.toMatch(/export default async/)
  })
  it('prerenders every product slug and takes its metadata from getProductMetadata', () => {
    const source = readFileSync('src/app/(shop)/products/[slug]/page.tsx', 'utf8')
    expect(source).toMatch(/generateStaticParams\(\) \{\s*const slugs = await getAllProductSlugs\(\);/)
    expect(source).toMatch(/return getProductMetadata\(slug\);/)
  })
})

describe('getProductMetadata', () => {
  it('builds the title and description from getProductBySlug', async () => {
    expect(await getProductMetadata('ao-git-push-force')).toEqual({
      title: 'Áo thun git push --force',
      description: 'Áo thun cotton 100% in dòng lệnh.',
    })
    expect(getProductBySlug).toHaveBeenCalledWith('ao-git-push-force')
  })
  // noindex: if the proxy fails open (ADR-0009) and the page renders for an unknown slug, it is still never indexed.
  it('US-05: titles a missing product "Không tìm thấy trang" and marks it noindex', async () => {
    vi.mocked(getProductBySlug).mockResolvedValue(null)
    expect(await getProductMetadata('khong-ton-tai')).toEqual({ title: 'Không tìm thấy trang', robots: { index: false } })
  })
})
