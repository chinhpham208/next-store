import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

export type BadgeVariant = 'neutral' | 'sold-out'

export type BadgeProps = { children: ReactNode; variant?: BadgeVariant }

// Record keeps the variants exhaustive at compile time. Sold-out is inverted Ink/Paper rather than red:
// the brand has no warning colour for stock state.
const VARIANT_CLASS: Record<BadgeVariant, string> = {
  neutral: 'bg-surface-muted text-foreground',
  'sold-out': 'bg-foreground text-background',
}

export const Badge = ({ children, variant = 'neutral' }: BadgeProps) => (
  <span
    className={cn(
      'inline-flex min-h-6 items-center rounded-sm px-2 text-xs font-semibold uppercase tracking-label',
      VARIANT_CLASS[variant],
    )}
  >
    {children}
  </span>
)
