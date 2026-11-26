import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { updateProductAction } from '@/features/products/actions'
import {
  firstErrorField,
  ProductEditForm,
  ProductEditFormView,
  type ProductEditFormState,
  sessionEnded,
  submitProductEdit,
} from '@/features/products/components/product-edit-form'
import type { AdminProductForm, ProductEditState } from '@/features/products/types'

// The action module pulls in cookies, the session and the database; the form only holds a reference to it.
vi.mock('@/features/products/actions', () => ({ updateProductAction: vi.fn() }))

afterEach(() => {
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

const PRODUCT: AdminProductForm = {
  slug: 'ao-git-push-force',
  name: 'Áo thun git push --force',
  description: 'Áo thun cotton 100%.',
  price: 199000,
  stock: 12,
  updatedAt: '2026-11-25T08:00:00.123456Z',
}
const LATER = '2026-11-26T09:30:00.654321Z'

const stateOf = (result: ProductEditFormState['result'], updatedAt = PRODUCT.updatedAt): ProductEditFormState => ({
  result,
  updatedAt,
})
const render = (state: ProductEditFormState, isPending = false): string =>
  renderToStaticMarkup(createElement(ProductEditFormView, { product: PRODUCT, state, isPending }))
const textOf = (html: string): string => html.replace(/<[^>]*>/g, '')
const tagWithId = (html: string, id: string): string => new RegExp(`<(?:input|textarea) [^>]*id="${id}"[^>]*>`).exec(html)?.[0] ?? ''
const regionOf = (html: string, role: 'status' | 'alert'): string =>
  new RegExp(`<div role="${role}">([\\s\\S]*?)</div>(?=<div role=|</div></form>|$)`).exec(html)?.[1] ?? ''
const invalid = (fieldErrors: Extract<ProductEditState, { status: 'invalid' }>['fieldErrors']): ProductEditFormState =>
  stateOf({ status: 'invalid', fieldErrors })

const FIELDS = [
  ['product-name', 'name', 'Tên', 'Tối đa 120 ký tự.'],
  ['product-price', 'price', 'Giá (₫)', 'Chỉ gõ chữ số, đơn vị đồng. Ví dụ: 199000.'],
  ['product-stock', 'stock', 'Tồn kho', '0 là hết hàng: cửa hàng hiện &quot;Hết hàng&quot; và khoá nút &quot;Thêm vào giỏ&quot;.'],
  ['product-description', 'description', 'Mô tả', 'Tối đa 2.000 ký tự.'],
] as const

describe('ProductEditFormView (Gate 2 M5, plan Task 10)', () => {
  const idle = render(stateOf({ status: 'idle' }))

  it('is a noValidate form with the four labelled fields, each with its hint, in DOM order', () => {
    expect(idle).toMatch(/^<form [^>]*novalidate=""/i)
    const order = FIELDS.map(([id]) => idle.indexOf(`id="${id}"`))
    expect(order).toEqual([...order].sort((a, b) => a - b))
    for (const [id, name, label, hint] of FIELDS) {
      expect(idle).toContain(`<label for="${id}" class="text-sm font-medium">${label}</label>`)
      expect(idle).toContain(`<p id="${id}-hint" class="text-sm text-muted-foreground">${hint}</p>`)
      const field = tagWithId(idle, id)
      expect(field).toContain(`name="${name}"`)
      expect(field).toContain(`aria-describedby="${id}-hint"`)
      expect(field).not.toContain('aria-invalid=')
      expect(field).not.toMatch(/maxLength|type="number"/i)
    }
  })

  it('fills the fields with the product, price and stock as plain digits', () => {
    expect(tagWithId(idle, 'product-name')).toContain('value="Áo thun git push --force"')
    const price = tagWithId(idle, 'product-price')
    expect(price).toContain('value="199000"')
    expect(price).toContain('inputMode="numeric"')
    expect(price).toContain('type="text"')
    expect(tagWithId(idle, 'product-stock')).toContain('value="12"')
    expect(idle).toMatch(/<textarea [^>]*rows="4"[^>]*>Áo thun cotton 100%.<\/textarea>/)
  })

  it('carries the slug and the loaded updatedAt in hidden inputs', () => {
    expect(idle).toContain('<input type="hidden" name="slug" value="ao-git-push-force"/>')
    expect(idle).toContain(`<input type="hidden" name="expectedUpdatedAt" value="${PRODUCT.updatedAt}"/>`)
  })

  it('has one submit button "Lưu", not disabled, and empty status and alert regions', () => {
    expect(idle.match(/<button [^>]*type="submit"[^>]*>Lưu<\/button>/g)).toHaveLength(1)
    expect(idle).not.toMatch(/<button [^>]*( disabled=| aria-disabled=)/)
    expect(idle).toContain('<div role="status"></div><div role="alert"></div>')
  })

  it('shows each field error next to its input with aria-describedby', () => {
    const html = render(invalid({ name: 'too-long', price: 'not-integer', stock: 'too-large', description: 'empty' }))
    const messages = {
      'product-name': 'Tên tối đa 120 ký tự',
      'product-price': 'Giá phải là số nguyên (đồng)',
      'product-stock': 'Tồn kho là số nguyên từ 0 đến 10.000',
      'product-description': 'Mô tả không được để trống',
    }
    for (const [id] of FIELDS) {
      const field = tagWithId(html, id)
      expect(field).toContain('aria-invalid="true"')
      expect(field).toContain(`aria-describedby="${id}-hint ${id}-error"`)
      // The error follows its own field, before the next field's label.
      const error = new RegExp(`${id}"[^>]*>(?:[^<]*</textarea>)?<p id="${id}-error" class="[^"]*text-danger[^"]*">([^<]*)</p>`).exec(html)
      expect(error?.[1]).toBe(messages[id])
    }
    expect(regionOf(html, 'alert')).toBe('')
  })

  it('US-13: shows "Giá không được âm" next to the price', () => {
    const html = render(invalid({ price: 'negative' }))
    expect(html).toContain('<p id="product-price-error"')
    expect(textOf(/<p id="product-price-error"[\s\S]*?<\/p>/.exec(html)?.[0] ?? '')).toBe('Giá không được âm')
    expect(tagWithId(html, 'product-name')).not.toContain('aria-invalid=')
  })

  it('US-13: shows "Tên không được để trống" next to the name', () => {
    const html = render(invalid({ name: 'empty' }))
    expect(textOf(/<p id="product-name-error"[\s\S]*?<\/p>/.exec(html)?.[0] ?? '')).toBe('Tên không được để trống')
  })

  it('while saving: "Đang lưu…" in the status, the button aria-disabled, the last answer cleared', () => {
    const html = render(invalid({ price: 'negative' }), true)
    expect(textOf(regionOf(html, 'status'))).toBe('Đang lưu…')
    expect(html).toMatch(/<button [^>]*aria-disabled="true"[^>]*>Lưu<\/button>/)
    expect(html).not.toContain('product-price-error')
    expect(regionOf(html, 'alert')).toBe('')
  })

  it('saved: "Đã lưu." and a link to the product in the shop, in the status region', () => {
    const html = render(stateOf({ status: 'saved', updatedAt: LATER }, LATER))
    const status = regionOf(html, 'status')
    expect(textOf(status)).toBe('Đã lưu.Xem trên cửa hàng')
    expect(status).toMatch(/<a [^>]*href="\/products\/ao-git-push-force"[^>]*>Xem trên cửa hàng<\/a>/)
    expect(regionOf(html, 'alert')).toBe('')
  })

  it.each([
    [{ status: 'error', error: 'conflict' }, 'Sản phẩm vừa được sửa ở nơi khác. Tải lại trang để xem bản mới nhất.', '/admin/products/ao-git-push-force'],
    [{ status: 'error', error: 'unauthorized' }, 'Phiên đăng nhập đã hết. Đăng nhập lại.', '/admin/login'],
    [{ status: 'error', error: 'unavailable' }, 'Không chắc thay đổi đã được lưu. Tải lại trang để xem dữ liệu hiện tại rồi thử lại.', '/admin/products/ao-git-push-force'],
    [{ status: 'error', error: 'not-found' }, 'Sản phẩm này không còn trong cửa hàng. Về danh sách sản phẩm.', '/admin/products'],
    [{ status: 'invalid', fieldErrors: {}, formError: 'invalid' }, 'Biểu mẫu đã cũ. Tải lại trang rồi sửa lại.', '/admin/products/ao-git-push-force'],
  ] as const)('shows the general message of %j in the alert, with its link', (result, text, href) => {
    const alert = regionOf(render(stateOf(result)), 'alert')
    expect(textOf(alert)).toBe(text)
    expect(alert).toMatch(new RegExp(`<a class="[^"]*underline[^"]*" href="${href}"`))
    expect(alert).toMatch(/^<p class="[^"]*text-danger/)
  })

  it('shows the network message when the action rejected', () => {
    expect(textOf(regionOf(render(stateOf({ status: 'network' })), 'alert'))).toBe(
      'Không kết nối được. Vui lòng tải lại trang và thử lại.',
    )
  })

  it('uses the new updatedAt after a save', () => {
    const html = render(stateOf({ status: 'saved', updatedAt: LATER }, LATER))
    expect(html).toContain(`<input type="hidden" name="expectedUpdatedAt" value="${LATER}"/>`)
  })
})

describe('firstErrorField', () => {
  it('follows the DOM order: name, price, stock, description', () => {
    expect(firstErrorField({ description: 'empty', stock: 'negative', price: 'negative' })).toBe('price')
    expect(firstErrorField({ description: 'empty', stock: 'negative' })).toBe('stock')
    expect(firstErrorField({ description: 'too-long', name: 'empty' })).toBe('name')
    expect(firstErrorField({})).toBeUndefined()
  })
})

describe('submitProductEdit', () => {
  const data = new FormData()
  const assign = vi.fn()
  const stubWindow = () => vi.stubGlobal('window', { location: { assign } })

  it('uses the new updatedAt after a save, and keeps it through a later refusal', async () => {
    vi.mocked(updateProductAction).mockResolvedValueOnce({ status: 'saved', updatedAt: LATER })
    const saved = await submitProductEdit(stateOf({ status: 'idle' }), data)
    expect(saved).toEqual(stateOf({ status: 'saved', updatedAt: LATER }, LATER))
    vi.mocked(updateProductAction).mockResolvedValueOnce({ status: 'invalid', fieldErrors: { price: 'negative' } })
    expect(await submitProductEdit(saved, data)).toEqual(stateOf({ status: 'invalid', fieldErrors: { price: 'negative' } }, LATER))
  })

  it('passes the form data to the action', async () => {
    vi.mocked(updateProductAction).mockResolvedValueOnce({ status: 'error', error: 'conflict' })
    expect(await submitProductEdit(stateOf({ status: 'idle' }), data)).toEqual(stateOf({ status: 'error', error: 'conflict' }))
    expect(vi.mocked(updateProductAction).mock.calls[0]?.[1]).toBe(data)
  })

  // Gate 2 decision 6, audit PR #106 M1: the proxy answers a POST without a session with an empty 401 before the
  // action runs, and Next.js rejects. The probe tells that apart from a network failure.
  it('a rejection without a session sends the tab to /admin/login', async () => {
    stubWindow()
    vi.mocked(updateProductAction).mockRejectedValueOnce(new Error('An unexpected response was received from the server.'))
    const fetch = vi.fn().mockResolvedValue({ type: 'opaqueredirect', status: 0 })
    vi.stubGlobal('fetch', fetch)
    expect(await submitProductEdit(stateOf({ status: 'invalid', fieldErrors: { name: 'empty' } }), data)).toEqual(
      stateOf({ status: 'idle' }),
    )
    expect(assign).toHaveBeenCalledWith('/admin/login')
  })

  it('a rejection with the session still valid shows the network message', async () => {
    stubWindow()
    vi.mocked(updateProductAction).mockRejectedValueOnce(new TypeError('Failed to fetch'))
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ type: 'basic', status: 404 }))
    expect(await submitProductEdit(stateOf({ status: 'idle' }, LATER), data)).toEqual(stateOf({ status: 'network' }, LATER))
    expect(assign).not.toHaveBeenCalled()
  })

  it('a rejection while offline shows the network message', async () => {
    stubWindow()
    vi.mocked(updateProductAction).mockRejectedValueOnce(new TypeError('Failed to fetch'))
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    expect(await submitProductEdit(stateOf({ status: 'idle' }), data)).toEqual(stateOf({ status: 'network' }))
    expect(assign).not.toHaveBeenCalled()
  })

  it('rethrows a Next.js redirect or not-found before anything else', () => {
    const source = readFileSync('src/features/products/components/product-edit-form.tsx', 'utf8')
    expect(source).toMatch(/catch \(error\) \{\s*unstable_rethrow\(error\)/)
  })
})

describe('sessionEnded', () => {
  it('asks a path under /admin without following redirects: a redirect or a 401 means no session', async () => {
    const fetch = vi.fn().mockResolvedValue({ type: 'opaqueredirect', status: 0 })
    vi.stubGlobal('fetch', fetch)
    expect(await sessionEnded()).toBe(true)
    const [path, init] = fetch.mock.calls[0] ?? []
    expect(path).toMatch(/^\/admin\/_/)
    expect(init).toMatchObject({ method: 'HEAD', redirect: 'manual', cache: 'no-store' })
    fetch.mockResolvedValue({ type: 'basic', status: 401 })
    expect(await sessionEnded()).toBe(true)
    fetch.mockResolvedValue({ type: 'basic', status: 404 })
    expect(await sessionEnded()).toBe(false)
  })
})

describe('ProductEditForm', () => {
  const source = readFileSync('src/features/products/components/product-edit-form.tsx', 'utf8')

  it('keeps the typed values after a refused save: dispatched by hand, never through a form reset', () => {
    // React resets a form after its action; the submit handler prevents that and dispatches in a transition.
    expect(source).toMatch(/event\.preventDefault\(\)\s*if \(isPending\) return/)
    expect(source).toMatch(/startTransition\(\(\) => dispatch\(/)
    expect(source).not.toMatch(/\bvalue=\{(?!state\.updatedAt|product\.slug)/)
  })

  it('moves focus to the first field in error', () => {
    expect(source).toMatch(/firstErrorField\(/)
    expect(source).toMatch(/\.focus\(\)/)
  })

  it('renders the view with the product as it loaded', () => {
    const html = renderToStaticMarkup(createElement(ProductEditForm, { product: PRODUCT }))
    expect(html).toContain(`value="${PRODUCT.updatedAt}"`)
    expect(html).toMatch(/<form [^>]*action="javascript:/)
  })
})
