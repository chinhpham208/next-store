import { readFileSync } from 'node:fs'
import { createElement, type FunctionComponent } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BlogIndex, getAllPosts, getLatestPosts, LatestPosts, PostList, PostView } from '@/features/blog'

// getLatestPosts is wrapped so one test can empty the registry; every other test sees the real posts.
vi.mock('@/features/blog/posts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/blog/posts')>()
  return { ...actual, getLatestPosts: vi.fn(actual.getLatestPosts) }
})

// index.ts re-exports content.ts, which imports the .mdx files; Vitest does not compile MDX (ADR-0012), and none of
// these components reads post bodies.
vi.mock('@/features/blog/content', () => ({ getPostContent: vi.fn() }))

afterEach(() => {
  vi.mocked(getLatestPosts).mockReset()
})

const posts = getAllPosts()
// Required `children` must sit in props for TypeScript, which react/no-children-prop rejects on a literal createElement
// call; one typed helper satisfies both (same as src/components/ui/ui.test.ts).
const render = <P extends object>(component: FunctionComponent<P>, props: P): string =>
  renderToStaticMarkup(createElement(component, props))
const textOf = (html: string): string => html.replace(/<[^>]*>/g, '')

describe('PostList', () => {
  it('US-10: renders every post newest first with date, linked title and description', () => {
    const html = renderToStaticMarkup(createElement(PostList, { posts, headingLevel: 2, label: 'Danh sách bài viết' }))
    expect(html).toContain('<ul aria-label="Danh sách bài viết"')
    expect([...html.matchAll(/href="\/blog\/([a-z0-9-]+)"/g)].map((match) => match[1])).toEqual(
      posts.map((post) => post.slug),
    )
    expect(html).toMatch(
      /<h2[^>]*><a[^>]*href="\/blog\/vi-sao-coc-ca-phe-la-cong-cu-debug"[^>]*>Vì sao cốc cà phê là công cụ debug tốt nhất<\/a><\/h2>/,
    )
    expect(html).toContain('<time dateTime="2026-11-16"')
    expect(html).toContain('16 tháng 11, 2026')
    expect(html).toContain(`<p class="text-muted-foreground text-pretty md:col-span-3 md:col-start-2">${posts[0]?.description}</p>`)
  })

  it('orders each item title, date, description in the DOM (the date moves left only on desktop)', () => {
    const html = renderToStaticMarkup(createElement(PostList, { posts: posts.slice(0, 1), headingLevel: 2, label: 'x' }))
    expect(html).toMatch(/<li[^>]*><h2[\s\S]*<\/h2><time[\s\S]*<\/time><p[\s\S]*<\/p><\/li>/)
    expect(html).toMatch(/<time[^>]*class="[^"]*md:col-start-1 md:row-start-1/)
  })

  it('uses h3 titles when asked (home page)', () => {
    const html = renderToStaticMarkup(createElement(PostList, { posts, headingLevel: 3, label: 'Bài viết mới' }))
    expect(html.match(/<h3/g)).toHaveLength(posts.length)
    expect(html).not.toContain('<h2')
  })

  it('renders no list when there are no posts', () => {
    expect(renderToStaticMarkup(createElement(PostList, { posts: [], headingLevel: 2, label: 'x' }))).not.toContain('<ul')
  })
})

describe('BlogIndex', () => {
  it('US-10: has one h1 "Blog", the lead sentence and the list of every post', () => {
    const html = renderToStaticMarkup(createElement(BlogIndex, { posts }))
    expect(html.match(/<h1/g)).toHaveLength(1)
    expect(html).toMatch(/<h1[^>]*>Blog<\/h1>/)
    expect(html).toContain('Ghi chép của next-store về đồ dùng và chuyện nghề của dân code.')
    expect(html).toContain('<ul aria-label="Danh sách bài viết"')
    expect(html.match(/<h2/g)).toHaveLength(posts.length)
  })

  it('US-10: shows the empty state and no list when there are no posts', () => {
    const html = renderToStaticMarkup(createElement(BlogIndex, { posts: [] }))
    expect(html).toContain('<p class="text-xl font-semibold md:text-2xl">Chưa có bài viết.</p>')
    expect(html).toContain('Bài đầu tiên đang được viết, quay lại sau nhé.')
    expect(html).not.toContain('<ul')
    expect(html).not.toContain('<a ')
  })
})

describe('PostView', () => {
  it('US-10: renders the post with one h1, its date, breadcrumb and the MDX children', () => {
    const post = posts[0]!
    const html = render(PostView, { post, children: createElement('p', null, 'Thân bài') })
    expect(html.match(/<h1/g)).toHaveLength(1)
    expect(html).toMatch(new RegExp(`<h1[^>]*>${post.title}</h1>`))
    expect(html).toContain(`<time dateTime="${post.publishedAt}"`)
    expect(html).toMatch(/<nav[^>]*aria-label="Đường dẫn"[^>]*>[\s\S]*href="\/"[\s\S]*href="\/blog"/)
    expect(html).toMatch(/<article[\s\S]*<p>Thân bài<\/p>[\s\S]*<\/article>/)
  })

  it('breadcrumb reads Trang chủ / Blog and does not repeat the title', () => {
    const html = render(PostView, { post: posts[1]!, children: null })
    const nav = /<nav[^>]*aria-label="Đường dẫn"[^>]*>([\s\S]*?)<\/nav>/.exec(html)?.[1] ?? ''
    expect(textOf(nav)).toBe('Trang chủ/Blog')
  })

  it('puts title and date inside the article and the "Tất cả bài viết" link after it', () => {
    const html = render(PostView, { post: posts[0]!, children: null })
    expect(html).toMatch(/<article[^>]*><header[^>]*><h1[\s\S]*<time[\s\S]*<\/header>/)
    expect(html).toMatch(/<\/article><p[^>]*><a[^>]*href="\/blog"[^>]*>Tất cả bài viết<\/a><\/p>/)
  })
})

describe('LatestPosts', () => {
  it('US-01: the home section shows the 3 latest posts under h3 and links to /blog', () => {
    const html = renderToStaticMarkup(createElement(LatestPosts))
    expect(html).toMatch(/^<section aria-labelledby="latest-posts-heading"/)
    expect(html).toMatch(/<h2 id="latest-posts-heading"[^>]*>Bài viết mới<\/h2>/)
    expect(html).toContain('<ul aria-label="Bài viết mới"')
    expect(html.match(/<h3/g)).toHaveLength(3)
    expect(html).not.toContain('chao-mung-den-next-store')
    expect(html).toMatch(/href="\/blog"[^>]*>Xem tất cả bài viết</)
  })

  it('US-01: renders nothing when there are no posts', () => {
    vi.mocked(getLatestPosts).mockReturnValue([])
    expect(renderToStaticMarkup(createElement(LatestPosts))).toBe('')
  })
})

describe('blog pages', () => {
  // Comments are dropped so the checks see code only (the page comments explain why openGraph is absent).
  const readCode = (path: string): string => readFileSync(path, 'utf8').replace(/^\s*\/\/.*$/gm, '')
  const listPage = readCode('src/app/(shop)/blog/page.tsx')
  const postPage = readCode('src/app/(shop)/blog/[slug]/page.tsx')
  const homePage = readCode('src/app/(shop)/page.tsx')

  it('declare only title and description, never openGraph or twitter (M3 K5)', () => {
    for (const source of [listPage, postPage]) expect(source).not.toMatch(/openGraph|twitter/)
    expect(listPage).toMatch(/title: "Blog"/)
    expect(postPage).toMatch(/return getPostMetadata\(slug\);/)
  })

  it('/blog does no IO: not async, no Suspense', () => {
    expect(listPage).not.toMatch(/async|Suspense/)
  })

  it('/blog/<slug> prerenders every post and falls back to notFound() for anything else', () => {
    expect(postPage).toMatch(/generateStaticParams\(\) \{\s*return POSTS\.map/)
    expect(postPage).toMatch(/if \(!isPostSlug\(slug\)\) notFound\(\);/)
  })

  it('US-01: home renders the latest posts after the featured products', () => {
    expect(homePage.indexOf('<LatestPosts />')).toBeGreaterThan(homePage.indexOf('aria-labelledby="featured-heading"'))
  })
})
