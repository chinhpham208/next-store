import 'server-only'
import { connection } from 'next/server'
import { readCartId } from '@/features/cart/cookie'
import { countCartItems, readCartLines } from '@/features/cart/store'
import type { CartView } from '@/features/cart/types'

// Never inside 'use cache' (plan M4 D8): cookies() would throw there, and the cart belongs to one browser. Called
// only below a <Suspense> boundary (D1). cookies() alone did not keep new Date() out of the prerender: it logged
// blocking-prerender-current-time on every request (NS-104, audit NS-96, as M2 K7), so await connection() first.
// Only with a cookie: without one there is no clock and no query.

export const getCart = async (): Promise<CartView> => {
  const cartId = await readCartId()
  if (cartId === null) return { lines: [], count: 0, total: 0 }
  await connection()
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
  await connection()
  return countCartItems(cartId, new Date())
}
