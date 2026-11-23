import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { createElement, type FunctionComponent, type ReactElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MAX_LINE_QUANTITY } from '@/features/cart/limits'
import { getCartCount } from '@/features/cart/queries'
import { AddToCartForm } from '@/features/cart/components/add-to-cart-form'
import { CartBadge, StaticCartLink } from '@/features/cart/components/cart-badge'
import { CartLink } from '@/features/cart/components/cart-link'
import { CartProvider } from '@/features/cart/components/cart-provider'

// The action module pulls in cookies and the database; the components only hold a reference to it.
vi.mock('@/features/cart/actions', () => ({ addToCartAction: vi.fn() }))
vi.mock('@/features/cart/queries', () => ({ getCartCount: vi.fn(), getCart: vi.fn() }))

afterEach(() => {
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

// The files allowed to say "use client" (plan M4 Global Constraints, conventions.md §2).
const CART_CLIENT_FILES = [
  'src/features/cart/components/cart-provider.tsx',
  'src/features/cart/components/cart-link.tsx',
  'src/features/cart/components/add-to-cart-form.tsx',
  'src/features/cart/components/cart-line-controls.tsx',
]
const ALLOWED_CLIENT_FILES = ['src/app/(shop)/error.tsx', ...CART_CLIENT_FILES]

const listTsx = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return listTsx(path)
    return path.endsWith('.tsx') ? [path] : []
  })

const USE_CLIENT = /^\s*(?:\/\/[^\n]*\n|\/\*[\s\S]*?\*\/\s*)*\s*['"]use client['"]/

const importsOf = (source: string): string[] =>
  [...source.matchAll(/^\s*import\s[\s\S]*?\sfrom\s+['"]([^'"]+)['"]/gm)].map((match) => match[1] ?? '')

// What a client file may import (Global Constraints): react, next/link, UI primitives, cn, formatPrice, and in the
// cart feature only the action reference and the import-free modules. The four client files may use one another:
// they all ship to the browser anyway.
const isAllowedClientImport = (specifier: string): boolean =>
  specifier === 'react' ||
  specifier === 'next/link' ||
  /^@\/components\/ui\/[a-z-]+$/.test(specifier) ||
  specifier === '@/lib/cn' ||
  specifier === '@/lib/format-price' ||
  /^@\/features\/cart\/(actions|messages|types|limits)$/.test(specifier) ||
  /^@\/features\/cart\/components\/(cart-provider|cart-link|add-to-cart-form|cart-line-controls)$/.test(specifier)

const render = (element: ReactElement): string => renderToStaticMarkup(element)
// Required `children` must sit in props for TypeScript, which react/no-children-prop rejects on a literal
// createElement call; a typed helper satisfies both (as in ui.test.ts).
const renderWith = <P extends object>(component: FunctionComponent<P>, props: P): ReactElement =>
  createElement(component, props)
const withProvider = (child: ReactNode): ReactElement => renderWith(CartProvider, { children: child })
const labelOf = (html: string): string | undefined => /<a [^>]*aria-label="([^"]*)"/.exec(html)?.[1]

describe('client boundary', () => {
  it('only the listed files use "use client"', () => {
    const found = listTsx('src')
      .filter((path) => USE_CLIENT.test(readFileSync(path, 'utf8')))
      .sort()
    // cart-line-controls.tsx arrives with the /cart page (Task 9); every file found must be on the list.
    expect(found.filter((path) => !ALLOWED_CLIENT_FILES.includes(path))).toEqual([])
    expect(found).toEqual(expect.arrayContaining(['src/app/(shop)/error.tsx', ...CART_CLIENT_FILES.slice(0, 3)]))
  })

  it('client files import nothing server-only', () => {
    for (const path of CART_CLIENT_FILES) {
      let source: string
      try {
        source = readFileSync(path, 'utf8')
      } catch {
        continue // cart-line-controls.tsx: Task 9
      }
      expect(source, path).not.toContain('server-only')
      expect(importsOf(source).filter((specifier) => !isAllowedClientImport(specifier)), path).toEqual([])
    }
  })

  it('UI primitives used by client files stay free of hooks and "use client"', () => {
    for (const path of ['src/components/ui/cart-icon.tsx', 'src/components/ui/quantity-stepper.tsx']) {
      const source = readFileSync(path, 'utf8')
      expect(source, path).not.toMatch(USE_CLIENT)
      expect(source, path).not.toMatch(/\buse[A-Z]\w*\(/)
    }
  })
})

describe('reads cookies only inside Suspense', () => {
  it('(shop)/layout.tsx puts CartBadge inside <Suspense> with the count-less link as fallback', () => {
    const source = readFileSync('src/app/(shop)/layout.tsx', 'utf8')
    expect(source).toMatch(/<Suspense fallback=\{<CartLink count=\{null\} \/>\}>\s*<CartBadge \/>\s*<\/Suspense>/)
    expect(source.match(/<CartBadge \/>/g)).toHaveLength(1)
    expect(source).toMatch(/<CartProvider>[\s\S]*<SiteHeader[\s\S]*<\/CartProvider>/)
  })

  it('no file in src/app calls cookies()', () => {
    for (const path of listTsx('src/app')) {
      expect(readFileSync(path, 'utf8'), path).not.toMatch(/\bcookies\(/)
    }
  })

  it('app/not-found.tsx stays static: the cart link reads no cookie and has no provider', () => {
    const source = readFileSync('src/app/not-found.tsx', 'utf8')
    expect(source).toContain('<SiteHeader cart={<StaticCartLink />} />')
    expect(source).not.toMatch(/CartBadge|CartProvider|Suspense/)
  })
})

describe('CartBadge', () => {
  it('passes the count to CartLink', async () => {
    vi.mocked(getCartCount).mockResolvedValue(3)
    const element = await CartBadge()
    expect(element.type).toBe(CartLink)
    expect(element.props).toEqual({ count: 3 })
  })

  it('CartBadge renders the link without a count when the query fails', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(getCartCount).mockRejectedValue(new Error('connect ECONNREFUSED postgres://u:secret@h/db'))
    const element = await CartBadge()
    expect(element.type).toBe(CartLink)
    expect(element.props).toEqual({ count: null })
    // One fixed line: no error object, SQL, host or cart id.
    expect(log.mock.calls).toEqual([['cart: cart count unavailable']])
  })
})

describe('CartLink', () => {
  it('links to /cart with the cart icon and no number when there is no count', () => {
    for (const count of [null, 0]) {
      const html = render(withProvider(createElement(CartLink, { count })))
      expect(html).toMatch(/^<a [^>]*href="\/cart"/)
      expect(labelOf(html)).toBe('Giỏ hàng')
      expect(html).toContain('<svg')
      expect(html).not.toMatch(/<span[^>]*aria-hidden="true"[^>]*>\d/)
    }
  })

  it('CartLink shows 99+ above 99 and names the count', () => {
    const one = render(withProvider(createElement(CartLink, { count: 1 })))
    expect(labelOf(one)).toBe('Giỏ hàng, 1 sản phẩm')
    expect(one).toMatch(/<span aria-hidden="true"[^>]*>1<\/span>/)
    const many = render(withProvider(createElement(CartLink, { count: 150 })))
    expect(labelOf(many)).toBe('Giỏ hàng, 150 sản phẩm')
    expect(many).toMatch(/<span aria-hidden="true"[^>]*>99\+<\/span>/)
    expect(render(withProvider(createElement(CartLink, { count: 99 })))).toMatch(/>99<\/span>/)
  })

  it('keeps a 44 px target and puts no live region in the header', () => {
    const html = render(withProvider(createElement(CartLink, { count: 3 })))
    expect(html).toMatch(/class="[^"]*min-h-11[^"]*min-w-11/)
    expect(html).not.toMatch(/aria-live|role="status"|role="alert"/)
  })

  it('StaticCartLink is the same link without a number', () => {
    const fromStatic = render(createElement(StaticCartLink))
    expect(fromStatic).toBe(render(withProvider(createElement(CartLink, { count: null }))))
  })

  it('useCartOptimism throws a fixed error outside CartProvider', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => render(createElement(CartLink, { count: 1 }))).toThrow('useCartOptimism must be used inside CartProvider')
  })
})

describe('AddToCartForm', () => {
  const formHtml = (stock: number) => render(withProvider(createElement(AddToCartForm, { slug: 'ao-sudo-make-me-coffee', stock })))

  it('add-to-cart-form disables the button when stock is 0', () => {
    const html = formHtml(0)
    expect(html).toMatch(/^<section aria-label="Mua hàng"/)
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Thêm vào giỏ<\/button>/)
    expect(html).not.toContain('type="number"')
    expect(html).not.toMatch(/role="(status|alert)"/)
  })

  it('add-to-cart-form does not cap the quantity at the stock', () => {
    const html = formHtml(3)
    const input = /<input [^>]*>/.exec(html)?.[0] ?? ''
    expect(input).toContain('type="number"')
    expect(input).toContain('name="quantity"')
    expect(input).toContain('id="quantity"')
    expect(input).toContain('min="1"')
    expect(input).toContain(`max="${MAX_LINE_QUANTITY}"`)
    expect(input).toContain('value="1"')
    expect(html).toContain('<label for="quantity" class="text-sm font-medium">Số lượng</label>')
  })

  it('renders an enabled submit button, the steppers and both live regions empty from the start', () => {
    const html = formHtml(3)
    expect(html).toMatch(/<form [^>]*noValidate=""|<form novalidate=""/i)
    expect(html).toMatch(/<button type="submit"(?![^>]*disabled="")[^>]*>Thêm vào giỏ<\/button>/)
    expect(html).toContain('aria-label="Giảm số lượng"')
    expect(html).toContain('aria-label="Tăng số lượng"')
    expect(html).toContain('<div role="status"></div><div role="alert"></div>')
  })

  it('add-to-cart-form catches a rejected action and shows the fixed message', () => {
    const source = readFileSync('src/features/cart/components/add-to-cart-form.tsx', 'utf8')
    expect(source).toMatch(/try \{[\s\S]*await addToCartAction\(\{ slug, quantity \}\)[\s\S]*\} catch \{[\s\S]*CART_NETWORK_ERROR/)
    // Inside a transition, with the optimistic bump first (C1, D6).
    expect(source).toMatch(/startTransition\(async \(\) => \{\s*addPending\(quantity\)/)
  })

  it('marks the button busy while waiting but never disables it', () => {
    const source = readFileSync('src/features/cart/components/add-to-cart-form.tsx', 'utf8')
    expect(source).toContain('aria-busy={isPending || undefined}')
    expect(source).not.toMatch(/disabled=\{isPending/)
  })
})
