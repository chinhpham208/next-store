import 'server-only'
import { readCartId } from '@/features/cart/cookie'
import { countCartItems, readCartLines } from '@/features/cart/store'
import type { CartView } from '@/features/cart/types'

// Never inside 'use cache' (plan M4 D8): cookies() would throw there, and the cart belongs to one browser. Called
// only below a <Suspense> boundary or in an action, so new Date() and cookies() never touch a prerender (D1).

export const getCart = async (): Promise<CartView> => {
  const cartId = await readCartId()
  if (cartId === null) return { lines: [], count: 0, total: 0 }
  const lines = await readCartLines(cartId, new Date())
  return {
    lines,
    count: lines.reduce((sum, line) => sum + line.quantity, 0),
    total: lines.reduce((sum, line) => sum + line.lineTotal, 0),
  }
}

/** The number on the cart icon: one query by primary key when there is a cookie, none otherwise. */
export const getCartCount = async (): Promise<number> => {
  const cartId = await readCartId()
  if (cartId === null) return 0
  return countCartItems(cartId, new Date())
}
