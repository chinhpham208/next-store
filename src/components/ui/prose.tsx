import type { MDXComponents } from 'mdx/types'
import Link from 'next/link'
import type { ComponentProps, ReactNode } from 'react'
import { cn } from '@/lib/cn'

// design-system §2 "Prose": no @tailwindcss/typography (owner decision 5), so every element a post can produce is
// mapped here. Vertical rhythm comes only from the wrapper's gap; children carry no margin except hr.

export type ProseProps = { children: ReactNode; className?: string }

// max-w-xl (576 px) keeps ~67 Vietnamese characters per line at 18 px, ~47 at 390 px.
export const Prose = ({ children, className }: ProseProps) => (
  <div className={cn('flex max-w-xl flex-col gap-6 text-base md:gap-8 md:text-lg', className)}>{children}</div>
)

const H2_CLASS = 'pt-6 text-2xl font-bold tracking-tight text-balance md:pt-4 md:text-3xl'

// The page owns the only h1 (the post title), so a stray "# …" in a post still renders one level below it.
const ProseH2 = ({ className, ...props }: ComponentProps<'h2'>) => <h2 className={cn(H2_CLASS, className)} {...props} />

const ProseH3 = ({ className, ...props }: ComponentProps<'h3'>) => (
  <h3 className={cn('pt-2 text-xl font-semibold text-balance md:pt-0 md:text-2xl', className)} {...props} />
)

const ProseP = ({ className, ...props }: ComponentProps<'p'>) => <p className={cn('text-pretty', className)} {...props} />

const LINK_CLASS = 'text-link underline underline-offset-4 hover:decoration-2'

// One leading slash only: "//host" is protocol-relative, i.e. another origin. No target="_blank": the reader decides.
const isInternalHref = (href: string | undefined): href is string =>
  href !== undefined && href.startsWith('/') && !href.startsWith('//')

const ProseA = ({ href, className, ...props }: ComponentProps<'a'>) => {
  const linkClass = cn(LINK_CLASS, className)
  if (isInternalHref(href)) return <Link href={href} className={linkClass} {...props} />
  return <a href={href} rel="noopener noreferrer" className={linkClass} {...props} />
}

// text-foreground keeps bold text dark inside a muted blockquote.
const ProseStrong = ({ className, ...props }: ComponentProps<'strong'>) => (
  <strong className={cn('font-semibold text-foreground', className)} {...props} />
)

const ProseEm = ({ className, ...props }: ComponentProps<'em'>) => <em className={cn('italic', className)} {...props} />

const LIST_CLASS = 'flex flex-col gap-2 pl-6 marker:text-muted-foreground'

const ProseUl = ({ className, ...props }: ComponentProps<'ul'>) => (
  <ul className={cn('list-disc', LIST_CLASS, className)} {...props} />
)

const ProseOl = ({ className, ...props }: ComponentProps<'ol'>) => (
  <ol className={cn('list-decimal', LIST_CLASS, className)} {...props} />
)

const ProseLi = (props: ComponentProps<'li'>) => <li {...props} />

// No background: link colour on surface-muted would fall under 4.5:1. Not italic either.
const ProseBlockquote = ({ className, ...props }: ComponentProps<'blockquote'>) => (
  <blockquote
    className={cn('flex flex-col gap-4 border-l-4 border-border-strong pl-4 text-muted-foreground md:pl-6', className)}
    {...props}
  />
)

// MDX gives block code a "language-…" className and inline code none; that is the only way to tell them apart, hence
// the rule that every fenced block in a post names its language (posts.test.ts). Block code inherits from the pre.
const ProseCode = ({ className, ...props }: ComponentProps<'code'>) => {
  if (className) return <code className={className} {...props} />
  return <code className="rounded-sm bg-surface-muted px-1 font-mono text-sm break-words md:text-base" {...props} />
}

// tabIndex 0: a horizontally scrolling region must be reachable from the keyboard (WCAG 2.1.1); the focus ring is the
// global :focus-visible. No aria-label: a generic role cannot be named.
const ProsePre = ({ className, ...props }: ComponentProps<'pre'>) => (
  <pre
    tabIndex={0}
    className={cn('overflow-x-auto rounded-md border border-border bg-surface p-4 font-mono text-sm md:p-6', className)}
    {...props}
  />
)

const ProseHr = ({ className, ...props }: ComponentProps<'hr'>) => (
  <hr className={cn('my-4 border-border', className)} {...props} />
)

export const PROSE_COMPONENTS = {
  h1: ProseH2,
  h2: ProseH2,
  h3: ProseH3,
  p: ProseP,
  a: ProseA,
  strong: ProseStrong,
  em: ProseEm,
  ul: ProseUl,
  ol: ProseOl,
  li: ProseLi,
  blockquote: ProseBlockquote,
  code: ProseCode,
  pre: ProsePre,
  hr: ProseHr,
} satisfies MDXComponents
