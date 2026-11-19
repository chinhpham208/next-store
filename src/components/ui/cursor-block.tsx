import { cn } from '@/lib/cn'

export type CursorBlockProps = { blink?: boolean; className?: string }

export const CursorBlock = ({ blink = false, className }: CursorBlockProps) => (
  <span aria-hidden="true" className={cn('cursor-block', blink && 'cursor-block--blink', className)} />
)
