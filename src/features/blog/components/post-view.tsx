import Link from 'next/link'
import type { ReactNode } from 'react'
import { Breadcrumb, type BreadcrumbItem } from '@/components/layout/breadcrumb'
import { buttonVariants } from '@/components/ui/button'
import { Container } from '@/components/ui/container'
import { Prose } from '@/components/ui/prose'
import type { PostMeta } from '@/features/blog/types'
import { formatDate } from '@/lib/format-date'

export type PostViewProps = { post: PostMeta; children: ReactNode }

// The title is the h1 right below, so the trail stops at the blog (design-system §2, PostView).
const CRUMBS: BreadcrumbItem[] = [
  { href: '/', label: 'Trang chủ' },
  { href: '/blog', label: 'Blog' },
]

// The reading column is left-aligned with the logo and the breadcrumb, like the product page.
export const PostView = ({ post, children }: PostViewProps) => (
  <Container className="flex flex-col gap-6 pt-4 pb-16 md:gap-8 md:pt-6 md:pb-24">
    <Breadcrumb crumbs={CRUMBS} />
    <article className="flex flex-col gap-8 md:gap-12">
      <header className="flex flex-col gap-4">
        <h1 className="max-w-3xl text-3xl font-bold tracking-tight text-balance break-words md:text-5xl">{post.title}</h1>
        <time dateTime={post.publishedAt} className="text-sm text-muted-foreground md:text-base">
          {formatDate(post.publishedAt)}
        </time>
      </header>
      <Prose>{children}</Prose>
    </article>
    <p className="max-w-xl border-t border-border pt-8 md:pt-12">
      <Link href="/blog" className={buttonVariants({ variant: 'secondary', className: 'w-full md:w-auto' })}>
        Tất cả bài viết
      </Link>
    </p>
  </Container>
)
