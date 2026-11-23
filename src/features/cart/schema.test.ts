import { describe, expect, it } from 'vitest'
import { MAX_LINE_QUANTITY } from '@/features/cart/limits'
import { addToCartInput, cartIdSchema, removeFromCartInput, setCartQuantityInput } from '@/features/cart/schema'

const SLUG = 'ao-git-push-force'

describe('addToCartInput', () => {
  it('addToCartInput accepts 1..10 and rejects 0, 11, 1.5, "2", NaN, extra keys', () => {
    for (let quantity = 1; quantity <= MAX_LINE_QUANTITY; quantity += 1) {
      expect(addToCartInput.safeParse({ slug: SLUG, quantity }).success).toBe(true)
    }
    for (const quantity of [0, 11, 1.5, '2', Number.NaN, Number.POSITIVE_INFINITY, -1, null, undefined]) {
      expect(addToCartInput.safeParse({ slug: SLUG, quantity }).success).toBe(false)
    }
    expect(addToCartInput.safeParse({ slug: SLUG, quantity: 1, extra: 1 }).success).toBe(false)
    expect(addToCartInput.safeParse({ slug: SLUG }).success).toBe(false)
  })

  it.each([null, undefined, 'ao-git-push-force', [], 1])('rejects a non-object input %j', (input) => {
    expect(addToCartInput.safeParse(input).success).toBe(false)
  })
})

describe('setCartQuantityInput', () => {
  it('setCartQuantityInput accepts 0', () => {
    expect(setCartQuantityInput.safeParse({ slug: SLUG, quantity: 0 }).success).toBe(true)
    expect(setCartQuantityInput.safeParse({ slug: SLUG, quantity: MAX_LINE_QUANTITY }).success).toBe(true)
  })

  it.each([-1, 11, 2.5, '1'])('rejects the quantity %j', (quantity) => {
    expect(setCartQuantityInput.safeParse({ slug: SLUG, quantity }).success).toBe(false)
  })

  it('rejects extra keys', () => {
    expect(setCartQuantityInput.safeParse({ slug: SLUG, quantity: 1, cartId: 'x' }).success).toBe(false)
  })
})

describe('removeFromCartInput', () => {
  it('accepts a slug only', () => {
    expect(removeFromCartInput.safeParse({ slug: SLUG }).success).toBe(true)
    expect(removeFromCartInput.safeParse({ slug: SLUG, quantity: 1 }).success).toBe(false)
  })
})

describe('slug', () => {
  it.each(['Ao', 'a%2Db', 'a'.repeat(81), '', ' ao-git', 'ao--git', 42])('rejects a malformed slug %j', (slug) => {
    expect(addToCartInput.safeParse({ slug, quantity: 1 }).success).toBe(false)
    expect(setCartQuantityInput.safeParse({ slug, quantity: 1 }).success).toBe(false)
    expect(removeFromCartInput.safeParse({ slug }).success).toBe(false)
  })

  it('accepts an 80-character slug', () => {
    expect(removeFromCartInput.safeParse({ slug: 'a'.repeat(80) }).success).toBe(true)
  })
})

describe('cartIdSchema', () => {
  it('accepts a UUID v4 from crypto.randomUUID', () => {
    expect(cartIdSchema.safeParse(crypto.randomUUID()).success).toBe(true)
  })

  it.each([
    'x',
    // v1
    'c232ab00-9414-11ec-b3c8-9f6bdeced846',
    // nil
    '00000000-0000-0000-0000-000000000000',
    ' 3F2504E0-4F89-41D3-9A0C-0305E82C3301 ',
  ])('rejects %j', (value) => {
    expect(cartIdSchema.safeParse(value).success).toBe(false)
  })
})
