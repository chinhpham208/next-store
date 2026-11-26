import { describe, expect, it } from 'vitest'
import { orderItemsSchema, paymentRefSchema } from '@/features/orders/schema'

const item = { productId: 1, slug: 'ao-git-push-force', name: 'Áo thun', price: 199000, quantity: 2, lineTotal: 398000 }

describe('orderItemsSchema', () => {
  it('accepts 1 to 20 well-formed lines', () => {
    expect(orderItemsSchema.safeParse([item]).success).toBe(true)
    expect(orderItemsSchema.safeParse(Array.from({ length: 20 }, () => item)).success).toBe(true)
  })

  it('rejects no lines, more than 20, and non-arrays', () => {
    expect(orderItemsSchema.safeParse([]).success).toBe(false)
    expect(orderItemsSchema.safeParse(Array.from({ length: 21 }, () => item)).success).toBe(false)
    expect(orderItemsSchema.safeParse({ ...item }).success).toBe(false)
    expect(orderItemsSchema.safeParse(null).success).toBe(false)
  })

  it('rejects a line with a wrong type, a missing key, an extra key or a line total that is not price × quantity', () => {
    expect(orderItemsSchema.safeParse([{ ...item, price: '199000' }]).success).toBe(false)
    expect(orderItemsSchema.safeParse([{ ...item, quantity: 0 }]).success).toBe(false)
    expect(orderItemsSchema.safeParse([{ ...item, quantity: 1.5 }]).success).toBe(false)
    expect(orderItemsSchema.safeParse([{ ...item, lineTotal: 1 }]).success).toBe(false)
    expect(orderItemsSchema.safeParse([{ ...item, extra: true }]).success).toBe(false)
    const { slug: _slug, ...withoutSlug } = item
    expect(orderItemsSchema.safeParse([withoutSlug]).success).toBe(false)
  })
})

describe('paymentRefSchema', () => {
  it('accepts 8 to 64 letters, digits, underscore and dash', () => {
    for (const ref of ['fake_12345', 'A-b_c1234', 'x'.repeat(8), 'x'.repeat(64)]) {
      expect(paymentRefSchema.safeParse(ref).success).toBe(true)
    }
  })

  it('rejects anything else', () => {
    for (const ref of ['short', 'x'.repeat(65), 'has space1', 'a/b/c/d/e/f', "ref'; --abcd", '', 12345678, null, undefined]) {
      expect(paymentRefSchema.safeParse(ref).success).toBe(false)
    }
  })
})
