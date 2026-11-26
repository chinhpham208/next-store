import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { listProductsForAdmin } from '@/features/products/admin-queries'
import {
  AdminProductTable,
  AdminProductTableSkeleton,
  AdminProductTableView,
} from '@/features/products/components/admin-product-table'
import type { AdminProductRow } from '@/features/products/types'
import { formatPrice } from '@/lib/format-price'

vi.mock('@/features/products/admin-queries', () => ({ listProductsForAdmin: vi.fn() }))

afterEach(() => {
  vi.clearAllMocks()
})

const ROWS: AdminProductRow[] = [
  { slug: 'ao-git-push-force', name: 'Áo thun git push --force', price: 199000, stock: 12 },
  { slug: 'ao-tabs-vs-spaces', name: 'Áo thun Tabs vs Spaces', price: 229000, stock: 0 },
]

const render = (rows: AdminProductRow[]): string => renderToStaticMarkup(createElement(AdminProductTableView, { rows }))
const textOf = (html: string): string => html.replace(/<[^>]*>/g, '')
const tableOf = (html: string): string => /<table[\s\S]*<\/table>/.exec(html)?.[0] ?? ''
const listOf = (html: string): string => /<ul[\s\S]*<\/ul>/.exec(html)?.[0] ?? ''

describe('AdminProductTableView (Gate 2 M5 decision 7)', () => {
  const html = render(ROWS)

  it('leads with the count and what can be edited', () => {
    expect(html).toMatch(
      /^<p class="max-w-xl text-muted-foreground md:text-lg">2 sản phẩm\. Sửa được tên, giá, mô tả, tồn kho; ảnh, danh mục và slug đổi qua mã nguồn\.<\/p>/,
    )
  })

  it('is a table from md and a list of cards under md: two blocks, one hidden by display:none', () => {
    expect(tableOf(html)).toMatch(/^<table aria-labelledby="admin-products-heading" class="hidden w-full [^"]*md:table"/)
    expect(listOf(html)).toMatch(/^<ul aria-labelledby="admin-products-heading" class="[^"]*md:hidden"/)
  })

  it('has the column headers, the last one for screen readers only', () => {
    const headers = [...tableOf(html).matchAll(/<th scope="col"[^>]*>([\s\S]*?)<\/th>/g)].map((match) => match[1])
    expect(headers).toEqual(['Sản phẩm', 'Giá', 'Tồn kho', '<span class="sr-only">Thao tác</span>'])
  })

  it('shows each product with its slug, price and stock, and one "Sửa {tên}" link per block', () => {
    for (const block of [tableOf(html), listOf(html)]) {
      for (const row of ROWS) {
        expect(block).toContain(row.slug)
        expect(block).toContain(formatPrice(row.price))
        const links = block.match(new RegExp(`<a [^>]*aria-label="Sửa ${row.name}"[^>]*>Sửa</a>`, 'g')) ?? []
        expect(links).toHaveLength(1)
        expect(links[0]).toContain(`href="/admin/products/${row.slug}"`)
      }
    }
  })

  it('the name is not a link: one link per row', () => {
    expect(tableOf(html).match(/<a /g)).toHaveLength(ROWS.length)
    expect(listOf(html).match(/<a /g)).toHaveLength(ROWS.length)
  })

  it('a sold-out product shows the "Hết hàng" badge, others their stock', () => {
    expect(textOf(tableOf(html))).toContain('Hết hàng')
    expect(textOf(listOf(html))).toContain('Tồn kho 12')
    expect(textOf(listOf(html))).not.toContain('Tồn kho 0')
  })

  it('keeps "--force" whole', () => {
    expect(html).toContain('<span class="whitespace-nowrap">--force</span>')
  })
})

describe('AdminProductTable', () => {
  it('reads the rows with the admin read', async () => {
    vi.mocked(listProductsForAdmin).mockResolvedValue(ROWS)
    const html = renderToStaticMarkup(await AdminProductTable())
    expect(html).toContain('2 sản phẩm.')
    expect(listProductsForAdmin).toHaveBeenCalledTimes(1)
  })
})

describe('AdminProductTableSkeleton', () => {
  it('is busy with an sr-only "Đang tải…" and nothing of the products', () => {
    const html = renderToStaticMarkup(createElement(AdminProductTableSkeleton))
    expect(html).toMatch(/^<div aria-busy="true"/)
    expect(html).toContain('<p class="sr-only">Đang tải…</p>')
    expect(html).not.toMatch(/<a |Sửa/)
  })
})
