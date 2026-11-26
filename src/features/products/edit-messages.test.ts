import { describe, expect, it } from 'vitest'
import {
  PRODUCT_EDIT_HINTS,
  PRODUCT_EDIT_NETWORK_ERROR,
  PRODUCT_EDIT_SAVING,
  productEditErrorMessage,
  productEditStateMessage,
} from '@/features/products/edit-messages'
import type { ProductEditState } from '@/features/products/types'

const SLUG = 'ao-git-push-force'

describe('productEditErrorMessage (plan M5 Task 9)', () => {
  it('US-13: keeps the two sentences of the story', () => {
    expect(productEditErrorMessage('price', 'negative')).toBe('Giá không được âm')
    expect(productEditErrorMessage('name', 'empty')).toBe('Tên không được để trống')
  })

  it.each([
    ['name', 'too-long', 'Tên tối đa 120 ký tự'],
    ['price', 'not-integer', 'Giá phải là số nguyên (đồng)'],
    ['price', 'too-large', 'Giá tối đa 100.000.000 ₫'],
    ['description', 'empty', 'Mô tả không được để trống'],
    ['description', 'too-long', 'Mô tả tối đa 2.000 ký tự'],
    ['stock', 'negative', 'Tồn kho là số nguyên từ 0 đến 10.000'],
    ['stock', 'not-integer', 'Tồn kho là số nguyên từ 0 đến 10.000'],
    ['stock', 'too-large', 'Tồn kho là số nguyên từ 0 đến 10.000'],
  ] as const)('%s/%s reads %j', (field, error, message) => {
    expect(productEditErrorMessage(field, error)).toBe(message)
  })
})

// Cổng 2 M5 decision 4: the text of the alert is exactly these sentences; the link is part of the sentence.
describe('productEditStateMessage (Cổng 2 M5 decision 4)', () => {
  const text = (state: ProductEditState) => {
    const message = productEditStateMessage(state, SLUG)
    return message === null ? null : `${message.before}${message.link.label}${message.after}`
  }

  it.each([
    [
      { status: 'error', error: 'conflict' },
      'Sản phẩm vừa được sửa ở nơi khác. Tải lại trang để xem bản mới nhất.',
      `/admin/products/${SLUG}`,
    ],
    [{ status: 'error', error: 'unauthorized' }, 'Phiên đăng nhập đã hết. Đăng nhập lại.', '/admin/login'],
    [
      { status: 'error', error: 'unavailable' },
      'Không chắc thay đổi đã được lưu. Tải lại trang để xem dữ liệu hiện tại rồi thử lại.',
      `/admin/products/${SLUG}`,
    ],
    [
      { status: 'error', error: 'not-found' },
      'Sản phẩm này không còn trong cửa hàng. Về danh sách sản phẩm.',
      '/admin/products',
    ],
    [
      { status: 'invalid', fieldErrors: {}, formError: 'invalid' },
      'Biểu mẫu đã cũ. Tải lại trang rồi sửa lại.',
      `/admin/products/${SLUG}`,
    ],
  ] satisfies [ProductEditState, string, string][])('%o reads %j', (state, sentence, href) => {
    expect(text(state)).toBe(sentence)
    expect(productEditStateMessage(state, SLUG)?.link.href).toBe(href)
  })

  it('has no general message for idle, saved or field errors only', () => {
    expect(text({ status: 'idle' })).toBeNull()
    expect(text({ status: 'saved', updatedAt: '2026-11-25T08:00:00.000000Z' })).toBeNull()
    expect(text({ status: 'invalid', fieldErrors: { price: 'negative' } })).toBeNull()
  })

  it('says it is saving', () => {
    expect(PRODUCT_EDIT_SAVING).toBe('Đang lưu…')
  })
})

describe('form text of Gate 2 M5 (Task 10)', () => {
  it('has the approved hint of each field', () => {
    expect(PRODUCT_EDIT_HINTS).toEqual({
      name: 'Tối đa 120 ký tự.',
      price: 'Chỉ gõ chữ số, đơn vị đồng. Ví dụ: 199000.',
      stock: '0 là hết hàng: cửa hàng hiện "Hết hàng" và khoá nút "Thêm vào giỏ".',
      description: 'Tối đa 2.000 ký tự.',
    })
  })

  it('a rejected save reads like the cart (CART_NETWORK_ERROR, Gate 2 decision 6)', () => {
    expect(PRODUCT_EDIT_NETWORK_ERROR).toBe('Không kết nối được. Vui lòng tải lại trang và thử lại.')
  })
})
