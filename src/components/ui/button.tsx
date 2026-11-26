import type { ComponentProps } from 'react'
import { cn } from '@/lib/cn'

export type ButtonVariant = 'primary' | 'secondary'

export type ButtonProps = ComponentProps<'button'> & { variant?: ButtonVariant }

// No transition and no cyan (brand §7). The disabled state only ever applies to <button>; links have no
// disabled state, so the variant stays harmless when buttonVariants() styles a <Link>. aria-disabled looks the same
// (M5 Gate 2): the admin forms mark a waiting submit that way, keeping it focusable and its name unchanged.
const BASE_CLASS =
  'inline-flex min-h-11 items-center justify-center rounded-md border px-6 text-base font-semibold whitespace-nowrap disabled:cursor-not-allowed disabled:border-surface-muted disabled:bg-surface-muted disabled:text-muted-foreground aria-disabled:cursor-not-allowed aria-disabled:border-surface-muted aria-disabled:bg-surface-muted aria-disabled:text-muted-foreground'

// Primary hovers to muted-foreground rather than a tint: Paper on Slate still reads 6.98 / 7.45:1.
const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary: 'border-foreground bg-foreground text-background hover:border-muted-foreground hover:bg-muted-foreground',
  secondary: 'border-border-strong bg-transparent text-foreground hover:bg-surface-muted',
}

export type ButtonVariantsOptions = { variant?: ButtonVariant; className?: string }

export const buttonVariants = ({ variant = 'primary', className }: ButtonVariantsOptions = {}): string =>
  cn(BASE_CLASS, VARIANT_CLASS[variant], className)

// type defaults to "button" so a Button dropped into a form never submits it by accident.
export const Button = ({ variant, className, type = 'button', ...props }: ButtonProps) => (
  <button type={type} className={buttonVariants({ variant, className })} {...props} />
)
