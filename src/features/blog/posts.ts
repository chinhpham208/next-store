// No imports on purpose, not even `import type`: src/proxy.ts reaches this file through proxy-api.ts and is bundled on
// its own (audit PR #26 L1), and Vitest reads it without compiling MDX. Adding a post = one file in content/blog/,
// one entry here, one line in content.ts (ADR-0012).

export type PostMeta = {
  slug: string
  title: string
  description: string
  // YYYY-MM-DD, formatted with formatDate (UTC): a string in the repo, so prerendered pages never depend on the clock.
  publishedAt: string
}

// Title, description and body as approved at Gate 2 (Task 6 M3).
export const POSTS = [
  {
    slug: 'chao-mung-den-next-store',
    title: 'Chào mừng đến next-store',
    description:
      'next-store là cửa hàng nhỏ bán áo thun, cốc, sticker và sách cho lập trình viên. Đây là những gì bạn sẽ tìm thấy ở cửa hàng và ở blog này.',
    publishedAt: '2026-10-26',
  },
  {
    slug: 'chon-ao-thun-cho-dan-code',
    title: 'Chọn áo thun cho dân code',
    description:
      'Chọn cỡ, hiểu chất vải và giặt sao cho hình in không nứt sau vài tháng: những điều nên biết trước khi mua một chiếc áo in dòng lệnh.',
    publishedAt: '2026-11-02',
  },
  {
    slug: 'git-push-force-va-nhung-cau-chuyen-buon',
    title: 'git push --force và những câu chuyện buồn',
    description:
      'Vì sao git push --force dễ xoá mất commit của đồng đội, --force-with-lease an toàn hơn ở chỗ nào, và cách tìm lại commit bằng reflog.',
    publishedAt: '2026-11-09',
  },
  {
    slug: 'vi-sao-coc-ca-phe-la-cong-cu-debug',
    title: 'Vì sao cốc cà phê là công cụ debug tốt nhất',
    description:
      'Rời màn hình đi pha cà phê, kể lỗi cho một chú vịt cao su hay cho chính chiếc cốc: vì sao nói thành lời giúp bạn tìm ra bug nhanh hơn.',
    publishedAt: '2026-11-16',
  },
] as const satisfies readonly PostMeta[]

export type PostSlug = (typeof POSTS)[number]['slug']

// A Set, not `slug in obj`: 'constructor', 'toString' and '__proto__' must not count as posts.
const POST_SLUGS: ReadonlySet<string> = new Set(POSTS.map((post) => post.slug))

// unknown, not string: the proxy passes whatever the URL holds and must never throw.
export const isPostSlug = (value: unknown): value is PostSlug => typeof value === 'string' && POST_SLUGS.has(value)

const DEFAULT_LATEST_LIMIT = 3

// Code-unit order, not localeCompare: YYYY-MM-DD and slugs are ASCII, and the order must not change with the ICU data
// of the machine that builds.
const compareAscii = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

// Newest first; same day → slug ascending, so the order never depends on the order of the array above.
const byNewest = (a: PostMeta, b: PostMeta): number =>
  compareAscii(b.publishedAt, a.publishedAt) || compareAscii(a.slug, b.slug)

// Copies, so a caller that sorts or edits the result cannot change the registry for the rest of the build.
export const getAllPosts = (): PostMeta[] => POSTS.map((post) => ({ ...post })).sort(byNewest)

export const getLatestPosts = (limit: number = DEFAULT_LATEST_LIMIT): PostMeta[] =>
  getAllPosts().slice(0, Math.max(0, limit))

export const getPostMeta = (slug: string): PostMeta | null => {
  if (!isPostSlug(slug)) return null
  const post = POSTS.find((entry) => entry.slug === slug)
  return post ? { ...post } : null
}
