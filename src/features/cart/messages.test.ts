import { describe, expect, it } from 'vitest'
import { MAX_CART_LINES, MAX_LINE_QUANTITY } from '@/features/cart/limits'
import { CART_NETWORK_ERROR, cartErrorMessage, QUANTITY_RANGE_MESSAGE } from '@/features/cart/messages'
import type { CartError } from '@/features/cart/types'

// Every member of CartError, checked at compile time: adding one to the union without listing it here fails
// typecheck, and cartErrorMessage's own switch fails it too (assertNever).
const ALL_ERRORS = {
  invalid: true,
  'not-found': true,
  'out-of-stock': true,
  'over-stock': true,
  'line-limit': true,
  'cart-full': true,
  unavailable: true,
} satisfies Record<CartError, true>

describe('cartErrorMessage', () => {
  it('US-08: over-stock reads "Chỉ còn 3 sản phẩm"', () => {
    expect(cartErrorMessage({ error: 'over-stock', available: 3 })).toBe('Chỉ còn 3 sản phẩm')
  })

  it('reads the fixed text of each error', () => {
    expect(cartErrorMessage({ error: 'out-of-stock' })).toBe('Sản phẩm đã hết hàng')
    expect(cartErrorMessage({ error: 'line-limit' })).toBe(`Mỗi sản phẩm tối đa ${MAX_LINE_QUANTITY} cái`)
    expect(cartErrorMessage({ error: 'cart-full' })).toBe(`Giỏ hàng tối đa ${MAX_CART_LINES} loại sản phẩm`)
    expect(cartErrorMessage({ error: 'invalid' })).toBe('Không tìm thấy sản phẩm')
    expect(cartErrorMessage({ error: 'not-found' })).toBe('Không tìm thấy sản phẩm')
    expect(cartErrorMessage({ error: 'unavailable' })).toBe('Không cập nhật được giỏ hàng. Vui lòng thử lại.')
  })

  it.each(Object.keys(ALL_ERRORS) as CartError[])('has a non-empty message for %s', (error) => {
    expect(cartErrorMessage({ error, available: 2 }).trim()).not.toBe('')
  })

  it('never shows "undefined" when over-stock comes without a number', () => {
    expect(cartErrorMessage({ error: 'over-stock' })).not.toMatch(/undefined|NaN/)
  })
})

describe('CART_NETWORK_ERROR', () => {
  it('asks to reload the page', () => {
    expect(CART_NETWORK_ERROR).toBe('Không kết nối được. Vui lòng tải lại trang và thử lại.')
  })
})

describe('QUANTITY_RANGE_MESSAGE', () => {
  it('names the range 1 to MAX_LINE_QUANTITY', () => {
    expect(QUANTITY_RANGE_MESSAGE).toBe(`Nhập số lượng từ 1 đến ${MAX_LINE_QUANTITY}`)
    expect(QUANTITY_RANGE_MESSAGE).toBe('Nhập số lượng từ 1 đến 10')
  })
})
