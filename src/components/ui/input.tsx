import type { ComponentProps } from 'react'
import { cn } from '@/lib/cn'

export type InputProps = ComponentProps<'input'>

// text-base (16 px) keeps iOS Safari from zooming on focus. The visible <label> is the caller's job:
// the placeholder is only an example, never the label.
// Also the look of a <textarea> (the admin description field, design-system "Component M5").
export const INPUT_CLASS =
  'min-h-11 w-full rounded-md border border-border-strong bg-surface px-4 text-base text-foreground placeholder:text-muted-foreground'

export const Input = ({ className, ...props }: InputProps) => <input className={cn(INPUT_CLASS, className)} {...props} />
