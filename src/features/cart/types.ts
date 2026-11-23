// No imports on purpose: client components (M4 Task 8) use these types.

/** One line of the cart at the product's current price (ADR-0014 4A); `stock` lets the page warn (10A). */
export type CartLine = {
  slug: string
  name: string
  image: string
  price: number
  quantity: number
  stock: number
  lineTotal: number
}

/** `count` is the sum of quantities, not the number of lines. */
export type CartView = {
  lines: CartLine[]
  count: number
  total: number
}

export type CartError =
  | 'invalid'
  | 'not-found'
  | 'out-of-stock'
  | 'over-stock'
  | 'line-limit'
  | 'cart-full'
  | 'unavailable'

// What a cart action returns, and all it returns: no DB row and no cart id (ADR-0014). `available` comes with
// over-stock ("Chỉ còn N sản phẩm", US-08).
export type CartActionResult = { ok: true; count: number } | { ok: false; error: CartError; available?: number }
