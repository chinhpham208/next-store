'use server'

import { refresh } from 'next/cache'
import { readCartId, writeCartId } from '@/features/cart/cookie'
import { addToCartInput, cartIdSchema, type CartId } from '@/features/cart/schema'
import { addLine, purgeExpiredCarts, type AddLineResult } from '@/features/cart/store'
import type { CartActionResult } from '@/features/cart/types'

// Each action is a public POST to the page that calls it (plan M4 D5): the input is parsed before anything else,
// the cart comes from the cookie only, and the result is a CartActionResult — no row, no cart id.
//
// Business errors are returned, never thrown (ADR-0014): a throw inside the client's transition would reach the
// error boundary instead of the message next to the button (D6).

const UNAVAILABLE: CartActionResult = { ok: false, error: 'unavailable' }

// The cart id is the only secret here: it is never part of a log line, and neither is an error object.
const ADD_FAILED_LOG = 'cart: add to cart failed'
const PURGE_FAILED_LOG = 'cart: purge of expired carts failed'

const newCartId = (): CartId => cartIdSchema.parse(crypto.randomUUID())

// The purge piggybacks on carts being created (ADR-0014 7A); the add has already succeeded, so its failure only
// leaves the expired carts for the next new cart.
const purgeQuietly = async (now: Date): Promise<void> => {
  try {
    await purgeExpiredCarts(now)
  } catch {
    console.error(PURGE_FAILED_LOG)
  }
}

const refused = (result: Exclude<AddLineResult, { ok: true }>): CartActionResult => {
  // A cart created in this very transaction cannot be missing; were it to happen, it is not the customer's error.
  if (result.error === 'missing-cart') return UNAVAILABLE
  return result.available === undefined
    ? { ok: false, error: result.error }
    : { ok: false, error: result.error, available: result.available }
}

export async function addToCartAction(input: unknown): Promise<CartActionResult> {
  const parsed = addToCartInput.safeParse(input)
  // No cookie read, no query: a malformed POST costs nothing.
  if (!parsed.success) return { ok: false, error: 'invalid' }
  const { slug, quantity } = parsed.data
  // One clock per request: the expiry cutoff, updated_at and the purge agree.
  const now = new Date()

  try {
    const cookieId = await readCartId()
    let cartId = cookieId
    let result: AddLineResult = { ok: false, error: 'missing-cart' }
    if (cookieId !== null) result = await addLine({ cartId: cookieId, slug, quantity, create: false, now })

    // No cookie, or its cart is unknown or expired: a new cart with a new id. The id in the cookie is never
    // inserted (ADR-0014 3A), so nobody can choose the id of a cart.
    const created = !result.ok && result.error === 'missing-cart'
    if (created) {
      cartId = newCartId()
      result = await addLine({ cartId, slug, quantity, create: true, now })
    }

    // A refusal sets no cookie and asks for no render: nothing changed (C4).
    if (!result.ok) return refused(result)
    if (cartId === null) return UNAVAILABLE

    // Set on every success: Max-Age slides with carts.updated_at (6A), and a cookie write makes Next render the
    // current page again in this same response (D2, C4).
    await writeCartId(cartId)
    if (created) await purgeQuietly(now)
    return { ok: true, count: result.count }
  } catch {
    // dbQuery failed or timed out. A timed-out write may or may not have committed (ADR-0011), so no retry: a
    // fresh render shows what the database holds, and the customer decides whether to add again.
    console.error(ADD_FAILED_LOG)
    refresh()
    return UNAVAILABLE
  }
}
