import { Container } from '@/components/ui/container'
import { CursorBlock } from '@/components/ui/cursor-block'
import { PostList } from '@/features/blog/components/post-list'
import type { PostMeta } from '@/features/blog/types'

export type BlogIndexProps = { posts: PostMeta[] }

const LIST_LABEL = 'Danh sách bài viết'

// No link in the empty state: link colour on surface-muted is below 4.5:1 (design-system §2, Empty state).
const EmptyState = () => (
  <div className="flex flex-col items-start gap-4 rounded-md bg-surface-muted px-6 py-10 md:p-16">
    <CursorBlock className="size-8" />
    <p className="text-xl font-semibold md:text-2xl">Chưa có bài viết.</p>
    <p className="text-muted-foreground">Bài đầu tiên đang được viết, quay lại sau nhé.</p>
  </div>
)

// Takes the posts as a prop so the empty state is testable; the page passes getAllPosts().
export const BlogIndex = ({ posts }: BlogIndexProps) => (
  <Container className="flex flex-col gap-6 pt-10 pb-16 md:gap-8 md:pt-16 md:pb-24">
    <h1 className="text-4xl font-bold tracking-tight md:text-5xl">Blog</h1>
    <p className="max-w-xl text-lg text-muted-foreground md:text-xl">
      Ghi chép của next-store về đồ dùng và chuyện nghề của dân code.
    </p>
    {posts.length > 0 ? <PostList posts={posts} headingLevel={2} label={LIST_LABEL} /> : <EmptyState />}
  </Container>
)
