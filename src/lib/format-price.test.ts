import { describe, expect, it } from 'vitest'
import { formatPrice } from './format-price'

const NBSP = ' '

describe('formatPrice', () => {
  it('formats a typical price', () => {
    expect(formatPrice(199000)).toBe(`199.000${NBSP}₫`)
  })
  it('formats zero', () => {
    expect(formatPrice(0)).toBe(`0${NBSP}₫`)
  })
  it('formats millions with dot separators', () => {
    expect(formatPrice(1250000)).toBe(`1.250.000${NBSP}₫`)
  })
})
