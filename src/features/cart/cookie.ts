import 'server-only'
import { cookies } from 'next/headers'
import { CART_TTL_DAYS } from '@/features/cart/limits'
import { cartIdSchema, type CartId } from '@/features/cart/schema'
import { getSiteUrl } from '@/lib/site-url'

// The only file that reads or writes the cart cookie (ADR-0014 3A, conventions.md §1).

const SECONDS_PER_DAY = 86_400

// __Host- makes the browser refuse the cookie unless it is Secure, Path=/ and has no Domain, so a sibling
// subdomain cannot plant one. The prefix needs HTTPS, hence the plain name locally and in CI.
export const cartCookieName = (secure: boolean): '__Host-ns_cart' | 'ns_cart' => (secure ? '__Host-ns_cart' : 'ns_cart')

// No `domain`: the cookie stays on the exact host. maxAge, not a session cookie: the cart must survive closing the
// browser (US-07), and every successful write sets it again, so the 30 days slide (6A).
export const cartCookieOptions = (
  secure: boolean,
): { httpOnly: true; sameSite: 'lax'; path: '/'; secure: boolean; maxAge: number } => ({
  httpOnly: true,
  sameSite: 'lax',
  path: '/',
  secure,
  maxAge: CART_TTL_DAYS * SECONDS_PER_DAY,
})

export const isSecureSite = (): boolean => getSiteUrl().protocol === 'https:'

/** The cart id from the cookie of the current scheme, or null; a malformed value is treated as no cart. */
export const readCartId = async (): Promise<CartId | null> => {
  const value = (await cookies()).get(cartCookieName(isSecureSite()))?.value
  if (value === undefined) return null
  const parsed = cartIdSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

/** Only in a Server Action (cookies can be set only there, plan M4 D1). */
export const writeCartId = async (id: CartId): Promise<void> => {
  const secure = isSecureSite()
  ;(await cookies()).set(cartCookieName(secure), id, cartCookieOptions(secure))
}

/** Only in a Server Action. */
export const clearCartId = async (): Promise<void> => {
  const secure = isSecureSite()
  // Same attributes as when it was set, or the browser keeps the __Host- cookie. No maxAge: the cookie library
  // turns a maxAge into an expiry in the future, which would undo the deletion.
  const { httpOnly, sameSite, path } = cartCookieOptions(secure)
  ;(await cookies()).delete({ name: cartCookieName(secure), httpOnly, sameSite, path, secure })
}
