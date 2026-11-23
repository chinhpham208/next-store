import type { Locator, Page } from '@playwright/test'
import { POSTS, type PostMeta } from '@/features/blog/posts'

// Helpers over the blog's markup contract (M3 Task 10). Expected titles and order come from the registry, never
// copied by hand, so adding a post does not break the specs. posts.ts imports nothing, so Playwright can load it.

// Same rule as the registry (newest first, same day → slug ascending), written out again here so the spec does not
// trust the function it is checking.
export const POSTS_NEWEST_FIRST: readonly PostMeta[] = [...POSTS].sort(
  (a, b) => (a.publishedAt < b.publishedAt ? 1 : a.publishedAt > b.publishedAt ? -1 : a.slug < b.slug ? -1 : 1),
)

export const blogList = (page: Page): Locator => page.getByRole('list', { name: 'Danh sách bài viết' })

export const latestPostsList = (page: Page): Locator => page.getByRole('list', { name: 'Bài viết mới' })

// The slug of every post link in a list, in DOM order.
export const listedSlugs = async (list: Locator): Promise<string[]> =>
  (await list.getByRole('link').evaluateAll((links) => links.map((link) => link.getAttribute('href') ?? ''))).map(
    (href) => href.replace(/^\/blog\//, ''),
  )

export const breadcrumb = (page: Page): Locator => page.getByRole('navigation', { name: 'Đường dẫn' })

// A slug nobody has opened in this server's life, so no cached answer from an earlier run can hide a soft 404.
export const freshPostSlug = (): string => `khong-co-${Date.now()}-${Math.floor(Math.random() * 1e6)}`
