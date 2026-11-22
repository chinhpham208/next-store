import { cn } from '@/lib/cn'

export type SkeletonProps = { className?: string }

// bg-border, not bg-surface-muted: surface-muted is only 1.09:1 on the light background and disappears.
// No shimmer: the brand allows one motion only (the hero cursor). The caller marks the region aria-busy
// and adds an sr-only "Đang tải…" line, so each block stays hidden from assistive technology.
export const Skeleton = ({ className }: SkeletonProps) => (
  <div aria-hidden="true" className={cn('rounded-sm bg-border', className)} />
)
