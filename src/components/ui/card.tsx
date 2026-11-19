import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

export type CardProps = { children: ReactNode; className?: string }

// No border, background or shadow: the product image is the surface (design-system §2).
export const Card = ({ children, className }: CardProps) => (
  <div className={cn('flex flex-col gap-3 md:gap-4', className)}>{children}</div>
)
