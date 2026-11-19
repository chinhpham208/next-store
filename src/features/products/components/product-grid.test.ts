import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it } from 'vitest'
import { ProductGrid, type ProductSummary } from '@/features/products'

const product: ProductSummary = {
  slug: 'so-tay-rebase',
  name: 'Sổ tay rebase',
  price: 199000,
  image: '/images/sach.svg',
  categoryName: 'Sách',
  inStock: false,
}
const render = (products: ProductSummary[]) =>
  renderToStaticMarkup(createElement(ProductGrid, { products, label: 'Sản phẩm nổi bật' }))
// formatPrice separates amount and symbol with U+00A0, not a plain space.
const NBSP = '\u00a0'
const textOf = (html: string): string => html.replace(/<[^>]*>/g, '')

it('renders the empty message when there are no products', () => {
  const html = render([])
  expect(html).toContain('Chưa có sản phẩm nổi bật.')
  expect(html).not.toContain('<ul')
})
it('renders image alt, name, price, category and sold-out badge', () => {
  const html = render([product])
  expect(html).toContain('aria-label="Sản phẩm nổi bật"')
  expect(html).toContain('alt="Sổ tay rebase"')
  expect(html).toMatch(/<h3[^>]*>Sổ tay rebase<\/h3>/)
  expect(html).toContain(`199.000${NBSP}₫`)
  expect(html).toContain('>Sách<')
  expect(html).toContain('Hết hàng')
})
it('does not render the sold-out badge for products in stock', () => {
  expect(render([{ ...product, inStock: true }])).not.toContain('Hết hàng')
})
it('renders exactly one image per product', () => {
  const html = render([product, { ...product, slug: 'b', name: 'B' }])
  expect(html.match(/<img /g)).toHaveLength(2)
  expect(html.match(/<li/g)).toHaveLength(2)
})
it('keeps a CLI flag on one line without changing the heading text', () => {
  const html = render([{ ...product, inStock: true, name: 'Áo thun git push --force' }])
  const heading = /<h3[^>]*>(.*?)<\/h3>/.exec(html)?.[1] ?? ''
  // The E2E contract matches the heading's text against the image alt, so the characters must stay "--".
  expect(textOf(heading)).toBe('Áo thun git push --force')
  expect(heading).toMatch(/<span class="whitespace-nowrap">--force<\/span>/)
})
