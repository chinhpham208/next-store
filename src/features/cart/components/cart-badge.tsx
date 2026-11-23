import Link from 'next/link'
import { unstable_rethrow } from 'next/navigation'
import { CartIcon } from '@/components/ui/cart-icon'
import { CartLink } from '@/features/cart/components/cart-link'
import { getCartCount } from '@/features/cart/queries'

// Same class and name as CartLink without a number (cart-link.tsx explains why they are repeated, not imported).
const CART_LINK_CLASS =
  'inline-flex min-h-11 min-w-11 items-center justify-center gap-1 rounded-md px-1 hover:bg-surface-muted sm:px-2'

const COUNT_UNAVAILABLE_LOG = 'cart: cart count unavailable'

const readCountQuietly = async (): Promise<number | null> => {
  try {
    return await getCartCount()
  } catch (error) {
    unstable_rethrow(error)
    console.error(COUNT_UNAVAILABLE_LOG)
    return null
  }
}

// The dynamic hole of the header (ADR-0014 9A): it reads the cookie, so (shop)/layout.tsx renders it only inside
// <Suspense> and the rest of every page stays prerendered (D1, C2). A failed count costs the number, never the page:
// the error stops here instead of reaching (shop)/error.tsx. Next.js's own signals (a prerender that must postpone at
// cookies()) are rethrown untouched. One fixed log line: no error object, SQL, host or cart id.
export const CartBadge = async () => <CartLink count={await readCountQuietly()} />

// For app/not-found.tsx, which sits outside (shop) and has no CartProvider: no number, no cookie, so the 404 page
// stays static.
export const StaticCartLink = () => (
  <Link href="/cart" aria-label="Giỏ hàng" className={CART_LINK_CLASS}>
    <CartIcon className="shrink-0" />
  </Link>
)
