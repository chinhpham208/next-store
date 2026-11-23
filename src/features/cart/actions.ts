'use server'

import { refresh } from 'next/cache'
import { clearCartId, readCartId, writeCartId } from '@/features/cart/cookie'
import {
  addToCartInput,
  cartIdSchema,
  removeFromCartInput,
  setCartQuantityInput,
  type CartId,
} from '@/features/cart/schema'
import {
  addLine,
  purgeExpiredCarts,
  removeLine,
  setLine,
  type AddLineResult,
  type SetLineResult,
} from '@/features/cart/store'
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
const SET_FAILED_LOG = 'cart: update of a cart line failed'
const REMOVE_FAILED_LOG = 'cart: removal of a cart line failed'

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

const EMPTY_CART: CartActionResult = { ok: true, count: 0 }

/**
 * The common path of an update and a removal. The cart is the cookie's, and only the cookie's: the input has no
 * cart id (strict schemas), so no request can write another customer's cart. Neither ever creates a cart: with
 * no cookie, a malformed one, or a cart that expired, the answer is an empty cart and the cookie goes.
 */
const writeExistingCart = async (
  write: (cartId: CartId, now: Date) => Promise<SetLineResult>,
  failedLog: string,
): Promise<CartActionResult> => {
  const now = new Date()
  try {
    const cartId = await readCartId()
    const result: SetLineResult = cartId === null ? { ok: false, error: 'missing-cart' } : await write(cartId, now)

    if (!result.ok) {
      const { error, available } = result
      if (error === 'missing-cart') {
        // Deleting the cookie also makes Next render the page again (D2), so it shows the empty cart.
        await clearCartId()
        return EMPTY_CART
      }
      // A refusal changed nothing: no cookie, no render (C4).
      return available === undefined ? { ok: false, error } : { ok: false, error, available }
    }
    if (cartId === null) return UNAVAILABLE

    // Every successful write sets the cookie again: Max-Age slides with carts.updated_at (6A), and the page is
    // rendered again in this response (D2).
    await writeCartId(cartId)
    return { ok: true, count: result.count }
  } catch {
    // As in addToCartAction: a timed-out write may have committed (ADR-0011), so no retry, and a fresh render.
    console.error(failedLog)
    refresh()
    return UNAVAILABLE
  }
}

/** Sets the quantity of a line; 0 removes it (US-07). Raising above the stock is refused, lowering never is. */
export async function setCartQuantityAction(input: unknown): Promise<CartActionResult> {
  const parsed = setCartQuantityInput.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'invalid' }
  const { slug, quantity } = parsed.data
  return writeExistingCart((cartId, now) => setLine({ cartId, slug, quantity, now }), SET_FAILED_LOG)
}

/** Removes a line (US-07); a line that is not there is still a success. */
export async function removeFromCartAction(input: unknown): Promise<CartActionResult> {
  const parsed = removeFromCartInput.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'invalid' }
  const { slug } = parsed.data
  return writeExistingCart((cartId, now) => removeLine({ cartId, slug, now }), REMOVE_FAILED_LOG)
}
