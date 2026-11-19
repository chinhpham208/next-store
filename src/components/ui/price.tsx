import { cn } from '@/lib/cn'
import { formatPrice } from '@/lib/format-price'

export type PriceProps = { amount: number; className?: string }

// Mono because Lexend has no tabular figures, so prices in a grid would not align.
export const Price = ({ amount, className }: PriceProps) => (
  <span className={cn('font-mono text-sm font-medium text-foreground md:text-base', className)}>
    {formatPrice(amount)}
  </span>
)
