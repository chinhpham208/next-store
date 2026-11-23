import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PRODUCT_SEEDS } from '@/db/seed-data'
import { formatPrice } from '@/lib/format-price'
import { getCart } from '@/features/cart/queries'
import { CartSection, CartSkeleton, CartView } from '@/features/cart/components/cart-view'
import type { CartLine, CartView as CartViewData } from '@/features/cart/types'

// The action module pulls in cookies and the database; the line controls only hold a reference to it.
vi.mock('@/features/cart/actions', () => ({ setCartQuantityAction: vi.fn(), removeFromCartAction: vi.fn() }))
vi.mock('@/features/cart/queries', () => ({ getCart: vi.fn(), getCartCount: vi.fn() }))
// The products index opens the database on import; the cart page only needs its product name renderer, whose own
// behaviour (the "--force" span) is tested in products.
vi.mock('@/features/products', () => ({ renderProductName: (name: string) => name }))

afterEach(() => {
  vi.clearAllMocks()
})

const seed = (slug: string) => {
  const product = PRODUCT_SEEDS.find((candidate) => candidate.slug === slug)
  if (product === undefined) throw new Error(`no seed ${slug}`)
  return product
}

const line = (slug: string, quantity: number, stock?: number): CartLine => {
  const product = seed(slug)
  return {
    slug,
    name: product.name,
    image: '/images/ao-thun.svg',
    price: product.price,
    quantity,
    stock: stock ?? product.stock ?? 0,
    lineTotal: product.price * quantity,
  }
}

const cartOf = (lines: CartLine[]): CartViewData => ({
  lines,
  count: lines.reduce((sum, item) => sum + item.quantity, 0),
  total: lines.reduce((sum, item) => sum + item.lineTotal, 0),
})

const render = (cart: CartViewData): string => renderToStaticMarkup(createElement(CartView, { cart }))
const textOf = (html: string): string => html.replace(/<[^>]*>/g, '')
const lineHtml = (html: string, slug: string): string =>
  new RegExp(`<li data-cart-line="${slug}"[\\s\\S]*?</li>`).exec(html)?.[0] ?? ''

const totalOf = (html: string): string | undefined => /<dd data-testid="cart-total"[^>]*>([^<]*)<\/dd>/.exec(html)?.[1]

const OVER_STOCK_NOTE = 'Có sản phẩm không đủ hàng. Giảm số lượng hoặc xoá dòng có cảnh báo.'

describe('CartView', () => {
  it('US-07: shows each line total and the cart total', () => {
    const force = line('ao-git-push-force', 2)
    const book = line('sach-typescript-thuc-chien', 1)
    const cart = cartOf([force, book])
    const html = render(cart)

    expect(html).toMatch(/<ul aria-label="Sản phẩm trong giỏ"/)
    expect(html.match(/<li /g)).toHaveLength(2)
    for (const item of [force, book]) {
      const row = lineHtml(html, item.slug)
      expect(row).toContain(`href="/products/${item.slug}"`)
      expect(textOf(row)).toContain(`Đơn giá ${formatPrice(item.price)}`)
      expect(textOf(row)).toContain(`Thành tiền ${formatPrice(item.lineTotal)}`)
      expect(row).toContain(`aria-label="Số lượng ${item.name}"`)
      expect(row).toContain(`value="${item.quantity}"`)
      expect(textOf(row)).toContain(`Xoá ${item.name}`)
    }
    expect(totalOf(html)).toBe(formatPrice(cart.total))
    expect(cart.total).toBe(2 * seed('ao-git-push-force').price + seed('sach-typescript-thuc-chien').price)
    // The hidden live region reads the new total after every edit (US-07).
    expect(html).toContain(
      `<p role="status" class="sr-only">Giỏ hàng có ${cart.count} sản phẩm, tổng cộng ${formatPrice(cart.total)}</p>`,
    )
    expect(textOf(html)).toContain(`${cart.count} sản phẩm`)
    // No checkout in M4 (Gate 2 #8), not even a disabled one.
    expect(textOf(html)).toContain('Thanh toán sẽ mở trong bản cập nhật tới.')
    expect(html).not.toMatch(/>Thanh toán</)
    expect(html).toMatch(/<a [^>]*href="\/products"[^>]*>Tiếp tục mua sắm<\/a>/)
    expect(textOf(html)).not.toContain(OVER_STOCK_NOTE)
  })

  it('shows the empty state', () => {
    const html = render(cartOf([]))
    expect(textOf(html)).toContain('Giỏ hàng trống.')
    expect(textOf(html)).toContain('Sản phẩm bạn thêm được giữ trong giỏ 30 ngày.')
    expect(html).toMatch(/<a [^>]*href="\/products"[^>]*>Xem sản phẩm<\/a>/)
    expect(html).toContain('<p role="status" class="sr-only">Không còn sản phẩm nào trong giỏ</p>')
    expect(html).not.toContain('<ul')
    expect(html).not.toContain('cart-total')
  })

  it('keeps the live region at the same place in both states', () => {
    const start = (html: string) => html.slice(0, html.indexOf('</p>'))
    expect(start(render(cartOf([])))).toMatch(/^<div class="flex flex-col gap-6 md:gap-8"><p role="status" class="sr-only">/)
    expect(start(render(cartOf([line('ao-git-push-force', 1)])))).toMatch(
      /^<div class="flex flex-col gap-6 md:gap-8"><p role="status" class="sr-only">/,
    )
  })

  it('US-08: warns on a line above the stock with "Chỉ còn N sản phẩm"', () => {
    const over = line('ao-git-push-force', 5, 3)
    const fine = line('sach-typescript-thuc-chien', 1)
    const html = render(cartOf([over, fine]))
    const row = lineHtml(html, over.slug)

    expect(row).toContain(`<p id="cart-warning-${over.slug}"`)
    expect(textOf(row)).toContain('Chỉ còn 3 sản phẩm')
    // The quantity stays as it is (decision 10A), the field points at the warning, and "+" cannot go further.
    expect(row).toContain('value="5"')
    expect(row).toMatch(/<input [^>]*aria-describedby="cart-warning-ao-git-push-force"/)
    expect(row).toMatch(/<button [^>]*aria-label="Tăng số lượng [^"]*" disabled=""/)
    expect(row).not.toMatch(/<button [^>]*aria-label="Giảm số lượng [^"]*" disabled=""/)
    expect(textOf(lineHtml(html, fine.slug))).not.toContain('Chỉ còn')
    // A state of the line, not an error: no danger colour. The total still counts it (10A), with a note below.
    expect(row).not.toContain('text-danger')
    expect(textOf(html)).toContain(OVER_STOCK_NOTE)
    expect(totalOf(html)).toBe(formatPrice(over.lineTotal + fine.lineTotal))
  })

  it('marks an out-of-stock line', () => {
    const soldOut = line('ao-tabs-vs-spaces', 1, 0)
    const html = render(cartOf([soldOut]))
    const row = lineHtml(html, soldOut.slug)
    expect(row).toMatch(/<p id="cart-warning-ao-tabs-vs-spaces"><span[^>]*>Hết hàng<\/span><\/p>/)
    expect(row).toMatch(/<button [^>]*aria-label="Tăng số lượng [^"]*" disabled=""/)
    expect(textOf(html)).toContain(OVER_STOCK_NOTE)
  })

  it('wraps the line total below the controls rather than scroll at 320 px', () => {
    const html = render(cartOf([line('sach-typescript-thuc-chien', 3)]))
    expect(html).toContain('<div class="flex flex-wrap items-center justify-between gap-4 md:justify-end md:gap-6">')
    expect(html).toMatch(/<p class="ml-auto font-mono[^"]*"><span class="sr-only">Thành tiền <\/span>/)
  })

  it('lets "+" go up to the stock on a line below it', () => {
    const html = render(cartOf([line('ao-git-push-force', 2, 12)]))
    expect(html).not.toMatch(/<button [^>]*aria-label="Tăng số lượng [^"]*" disabled=""/)
    expect(html).toMatch(/<input [^>]*min="0" max="10"/)
  })
})

describe('CartSection and CartSkeleton', () => {
  it('renders the cart that getCart reads', async () => {
    vi.mocked(getCart).mockResolvedValue(cartOf([]))
    const element = await CartSection()
    expect(textOf(renderToStaticMarkup(element))).toContain('Giỏ hàng trống.')
    expect(getCart).toHaveBeenCalledTimes(1)
  })

  it('lets a failed read reach (shop)/error.tsx', async () => {
    vi.mocked(getCart).mockRejectedValue(new Error('db down'))
    await expect(CartSection()).rejects.toThrow('db down')
  })

  it('the skeleton is busy, announces loading and hides its blocks', () => {
    const html = renderToStaticMarkup(createElement(CartSkeleton))
    expect(html).toMatch(/^<div aria-busy="true"/)
    expect(html).toContain('<p class="sr-only">Đang tải…</p>')
    expect(html).toMatch(/<ul aria-hidden="true"/)
  })
})

describe('cart page', () => {
  const page = readFileSync('src/app/(shop)/cart/page.tsx', 'utf8')

  it('cart page reads the cart only inside Suspense and is noindex', () => {
    expect(page).toMatch(/<Suspense fallback=\{<CartSkeleton \/>\}>\s*<CartSection \/>\s*<\/Suspense>/)
    expect(page.match(/<CartSection \/>/g)).toHaveLength(1)
    // Not async, no cookie read: the h1 is the prerendered shell (D1).
    expect(page).not.toMatch(/export default async/)
    expect(page).not.toMatch(/\bcookies\(|getCart\(/)
    expect(page).toMatch(/title:\s*['"]Giỏ hàng['"]/)
    expect(page).toMatch(/robots:\s*\{\s*index:\s*false/)
    // The heading sits outside Suspense and takes focus once the last line is gone.
    expect(page).toMatch(/<h1 id="cart-heading" tabIndex=\{-1\}[^>]*>\s*Giỏ hàng\s*<\/h1>\s*<Suspense/)
  })

  it('renders user text only through JSX', () => {
    for (const path of [
      'src/app/(shop)/cart/page.tsx',
      'src/features/cart/components/cart-view.tsx',
      'src/features/cart/components/cart-line-controls.tsx',
    ]) {
      const source = readFileSync(path, 'utf8')
      expect(source, path).not.toMatch(/dangerouslySetInnerHTML|innerHTML|insertAdjacentHTML|outerHTML/)
    }
  })

  it('/cart is not in the sitemap', () => {
    expect(readFileSync('src/app/sitemap.ts', 'utf8')).not.toContain('/cart')
  })
})

describe('CartLineControls', () => {
  const source = readFileSync('src/features/cart/components/cart-line-controls.tsx', 'utf8')

  it('catches a rejected action and shows the fixed message', () => {
    // Both actions go through one runner, whose await sits in a try whose catch shows CART_NETWORK_ERROR (as Task 8).
    expect(source).toMatch(/try\s*\{\s*const result = await write\(\)[\s\S]*?\}\s*catch\s*\{\s*setError\(CART_NETWORK_ERROR\)/)
    expect(source).toMatch(/run\(\(\) => setCartQuantityAction\(/)
    expect(source).toMatch(/run\(\(\) => removeFromCartAction\(/)
    expect(source.match(/await \w+Action\(/g)).toBeNull()
  })

  it('moves focus to the next line, or the heading, after a removal', () => {
    expect(source).toContain('nextElementSibling')
    expect(source).toContain('previousElementSibling')
    expect(source).toContain('cart-heading')
  })
})
