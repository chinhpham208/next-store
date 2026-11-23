'use client'

import Link from 'next/link'
import { CartIcon } from '@/components/ui/cart-icon'
import { useCartOptimism } from '@/features/cart/components/cart-provider'

export type CartLinkProps = { count: number | null }

// StaticCartLink (cart-badge.tsx) repeats these two: a server file importing a value from a "use client" module gets
// a client reference, not the string. cart-ui.test.ts checks both links render the same markup. 44 px without a number.
const CART_LINK_CLASS =
  'inline-flex min-h-11 min-w-11 items-center justify-center gap-1 rounded-md px-2 hover:bg-surface-muted'
const CART_LINK_LABEL = 'Giỏ hàng'

const MAX_SHOWN = 99

const cartLabel = (n: number): string => (n > 0 ? `Giỏ hàng, ${n} sản phẩm` : CART_LINK_LABEL)

// No aria-live here (design-system, Component M4): the customer is at the "Thêm vào giỏ" button, whose own status /
// alert region reports the result; a live link would be read again on every render. The badge sits beside the icon,
// hidden from assistive technology; the full number (even above 99) is in the link's name.
export const CartLink = ({ count }: CartLinkProps) => {
  const { pendingDelta } = useCartOptimism()
  // null: no cart, still loading (Suspense fallback) or the count failed. All three look the same.
  const n = (count ?? 0) + pendingDelta
  const pending = pendingDelta > 0
  return (
    <Link href="/cart" aria-label={cartLabel(n)} className={CART_LINK_CLASS}>
      <CartIcon className="shrink-0" />
      {n > 0 && (
        <span
          aria-hidden="true"
          // Hollow while the server has not answered, solid once it has: a change of shape, not only of colour.
          data-pending={pending || undefined}
          className="inline-flex h-5 min-w-5 items-center justify-center rounded-sm border border-foreground bg-foreground px-1 font-mono text-xs font-semibold text-background data-pending:bg-background data-pending:text-foreground"
        >
          {n > MAX_SHOWN ? `${MAX_SHOWN}+` : String(n)}
        </span>
      )}
    </Link>
  )
}
