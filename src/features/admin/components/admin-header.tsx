import type { ReactNode } from 'react'
import { Container } from '@/components/ui/container'
import { CursorBlock } from '@/components/ui/cursor-block'
import { cn } from '@/lib/cn'

export type AdminHeaderProps = {
  /** `login`: one row at every width (title + "Về cửa hàng"). `shell`: two rows under sm (title, then nav + logout). */
  layout: 'login' | 'shell'
  children?: ReactNode
}

// Gate 2 decision 1: the Ink band of the footer, the same in both themes; in the dark theme the bottom border keeps it
// apart from the page (also Ink). The focus ring is re-pointed to inverse-accent as in the footer, for every
// focusable descendant. The title is neither a link nor a heading: each page has its own h1.
export const AdminHeader = ({ layout, children }: AdminHeaderProps) => (
  <header className="border-b border-inverse-border bg-inverse text-inverse-foreground [--color-ring:var(--color-inverse-accent)]">
    <Container
      className={cn(
        'flex items-center gap-x-8 py-2 sm:h-16 sm:flex-nowrap sm:py-0',
        layout === 'shell' ? 'flex-wrap' : 'flex-nowrap',
      )}
    >
      <p
        className={cn(
          'flex min-h-11 items-center text-lg/7 font-bold tracking-tight whitespace-nowrap',
          layout === 'shell' && 'w-full sm:w-auto',
        )}
      >
        Quản trị next-store
        <CursorBlock className="bg-inverse-accent" />
      </p>
      {children}
    </Container>
  </header>
)
