import { cn } from '@/lib/cn'

export type CartIconProps = { className?: string }

// The only icon of the site, used only by the cart link (design-system, Component M4). Decorative: the link carries
// the accessible name.
export const CartIcon = ({ className }: CartIconProps) => (
  <svg
    viewBox="0 0 24 24"
    className={cn('size-6', className)}
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M2 3h3l2.6 11.2a1 1 0 0 0 1 .8h9.2a1 1 0 0 0 1-.8L21 7H6" />
    <circle cx="9.5" cy="19.5" r="1.5" />
    <circle cx="17.5" cy="19.5" r="1.5" />
  </svg>
)
