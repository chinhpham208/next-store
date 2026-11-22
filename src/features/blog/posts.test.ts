import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { getPostMetadata } from '@/features/blog/metadata'
import { getAllPosts, getLatestPosts, getPostMeta, isPostSlug, POSTS } from '@/features/blog/posts'
import { formatDate } from '@/lib/format-date'

// Vitest cannot compile MDX without a plugin outside the plan, so content.ts is not imported here: its
// Record<PostSlug, MDXContent> type and `next build` cover it, and these tests check the files on disk.
const readPost = (slug: string): string => readFileSync(`content/blog/${slug}.mdx`, 'utf8')

// Opening fence: up to 3 spaces, then ``` or ~~~ (3+), then the info string. Closing fence: same character, at least
// as long, nothing after it (CommonMark §4.5).
const FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/

type FenceIssue = { line: number; text: string }

const findFencesWithoutLanguage = (source: string): FenceIssue[] => {
  const issues: FenceIssue[] = []
  let open: string | null = null
  source.split('\n').forEach((text, index) => {
    const match = FENCE.exec(text)
    if (!match) return
    const [, fence = '', info = ''] = match
    if (open) {
      if (fence[0] === open[0] && fence.length >= open.length && info.trim() === '') open = null
      return
    }
    open = fence
    if (!/^[a-z0-9+#-]+$/.test(info.trim().split(/\s+/)[0] ?? '')) issues.push({ line: index + 1, text })
  })
  if (open) issues.push({ line: -1, text: 'unclosed fence' })
  return issues
}

describe('blog post registry', () => {
  it('US-10: lists posts newest first', () => {
    expect(getAllPosts().map((post) => post.slug)).toEqual([
      'vi-sao-coc-ca-phe-la-cong-cu-debug',
      'git-push-force-va-nhung-cau-chuyen-buon',
      'chon-ao-thun-cho-dan-code',
      'chao-mung-den-next-store',
    ])
  })

  it('US-01: returns the 3 latest posts by default', () => {
    expect(getLatestPosts().map((post) => post.slug)).toEqual([
      'vi-sao-coc-ca-phe-la-cong-cu-debug',
      'git-push-force-va-nhung-cau-chuyen-buon',
      'chon-ao-thun-cho-dan-code',
    ])
    expect(getLatestPosts(1)).toHaveLength(1)
  })

  it('does not mutate POSTS when sorting', () => {
    const before = [...POSTS]
    getAllPosts()
    expect([...POSTS]).toEqual(before)
  })

  it('returns a fresh array each call, so a caller cannot reorder the registry', () => {
    const first = getAllPosts()
    first.reverse()
    expect(getAllPosts()[0]?.slug).toBe('vi-sao-coc-ca-phe-la-cong-cu-debug')
  })

  it('US-10: finds a post by slug and returns null for anything else', () => {
    expect(getPostMeta('chao-mung-den-next-store')?.title).toBe('Chào mừng đến next-store')
    for (const slug of ['khong-ton-tai', 'Chao-Mung-Den-Next-Store', '', '../x', 'constructor', '__proto__']) {
      expect(getPostMeta(slug), slug).toBeNull()
    }
  })

  it('isPostSlug accepts only declared slugs', () => {
    expect(isPostSlug('chon-ao-thun-cho-dan-code')).toBe(true)
    for (const value of ['toString', 'chon-ao-thun-cho-dan-code/', undefined, null, 1, ['chon-ao-thun-cho-dan-code']]) {
      expect(isPostSlug(value), String(value)).toBe(false)
    }
  })

  it('every post has a valid slug, date, title and description', () => {
    expect(new Set(POSTS.map((post) => post.slug)).size).toBe(POSTS.length)
    for (const post of POSTS) {
      expect(post.slug).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
      expect(post.slug.length).toBeLessThanOrEqual(80)
      expect(() => formatDate(post.publishedAt)).not.toThrow()
      expect(post.title.length).toBeGreaterThan(0)
      expect(post.title.length).toBeLessThanOrEqual(70)
      expect(post.description.length).toBeGreaterThan(0)
      expect(post.description.length).toBeLessThanOrEqual(160)
    }
  })

  it('getPostMetadata returns title and description, and a not-found title for an unknown slug', () => {
    expect(getPostMetadata('chao-mung-den-next-store')).toMatchObject({
      title: 'Chào mừng đến next-store',
      description: POSTS.find((post) => post.slug === 'chao-mung-den-next-store')?.description,
    })
    expect(getPostMetadata('khong-ton-tai')).toEqual({ title: 'Không tìm thấy trang' })
  })

  // The segment has its own opengraph-image, so declaring openGraph here keeps og:image (M3 K5); the page must then
  // restate site name and locale, which a child openGraph no longer inherits from the root layout.
  it('US-11: getPostMetadata declares an article with its publish date', () => {
    const post = POSTS.find((entry) => entry.slug === 'chao-mung-den-next-store')
    expect(getPostMetadata('chao-mung-den-next-store').openGraph).toEqual({
      type: 'article',
      title: 'Chào mừng đến next-store',
      description: post?.description,
      publishedTime: '2026-10-26',
      siteName: 'next-store',
      locale: 'vi_VN',
      url: '/blog/chao-mung-den-next-store',
    })
  })

  it('posts.ts imports nothing, so the proxy can use it', () => {
    expect(readFileSync('src/features/blog/posts.ts', 'utf8')).not.toMatch(/^import\s/m)
  })
})

describe('blog post files', () => {
  it('every post has exactly one .mdx file and the other way round', () => {
    const files = readdirSync('content/blog')
      .filter((name) => name.endsWith('.mdx'))
      .map((name) => name.slice(0, -4))
      .sort()
    expect(files).toEqual(POSTS.map((post) => post.slug).sort())
  })

  it('content.ts imports every post file once, by its own slug', () => {
    const source = readFileSync('src/features/blog/content.ts', 'utf8')
    const imports = [...source.matchAll(/from '@content\/blog\/([a-z0-9-]+)\.mdx'/g)].map((match) => match[1]).sort()
    expect(imports).toEqual(POSTS.map((post) => post.slug).sort())
  })

  it('posts use CommonMark only: no imports, exports, h1, tables or other-origin resources', () => {
    for (const post of POSTS) {
      const source = readPost(post.slug)
      expect(source, post.slug).not.toMatch(/^(import|export)\s/m)
      expect(source, post.slug).not.toMatch(/^#\s/m)
      expect(source, post.slug).not.toMatch(/^\|.*\|\s*$/m)
      expect(source, post.slug).not.toMatch(/<(script|iframe|img|link|style)\b|!\[[^\]]*\]\(\s*(https?:)?\/\//i)
    }
  })

  it('posts keep registry data out of the file (no frontmatter, no leftover registry comment)', () => {
    for (const post of POSTS) {
      const source = readPost(post.slug)
      expect(source.startsWith('---'), post.slug).toBe(false)
      expect(source, post.slug).not.toContain('{/*')
    }
  })

  it('every fenced code block in a post names its language', () => {
    for (const post of POSTS) expect(findFencesWithoutLanguage(readPost(post.slug)), post.slug).toEqual([])
  })

  it('the fence check flags a block without a language and ignores fences inside a block', () => {
    expect(findFencesWithoutLanguage('```bash\ngit status\n```\n')).toEqual([])
    expect(findFencesWithoutLanguage('````md\n```\nx\n```\n````\n')).toEqual([])
    expect(findFencesWithoutLanguage('a\n\n```\ngit status\n```\n')).toEqual([{ line: 3, text: '```' }])
    expect(findFencesWithoutLanguage('~~~ \nx\n~~~\n')).toEqual([{ line: 1, text: '~~~ ' }])
    expect(findFencesWithoutLanguage('```ts\nx\n')).toEqual([{ line: -1, text: 'unclosed fence' }])
  })
})
