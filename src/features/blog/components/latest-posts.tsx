import Link from 'next/link'
import { buttonVariants } from '@/components/ui/button'
import { Container } from '@/components/ui/container'
import { PostList } from '@/features/blog/components/post-list'
import { getLatestPosts } from '@/features/blog/posts'

const LATEST_LABEL = 'Bài viết mới'

// Home page section under "Sản phẩm nổi bật". No empty state: without posts the section is not there at all
// (approved at Gate 2). getLatestPosts reads the static registry, so the home page stays prerendered.
export const LatestPosts = () => {
  const posts = getLatestPosts()
  if (posts.length === 0) return null

  return (
    <section aria-labelledby="latest-posts-heading">
      <Container className="pb-16 md:pb-24">
        <div className="flex flex-col gap-8 border-t border-border pt-10 md:gap-12 md:pt-16">
          <h2 id="latest-posts-heading" className="text-2xl font-bold tracking-tight md:text-3xl">
            {LATEST_LABEL}
          </h2>
          <PostList posts={posts} headingLevel={3} label={LATEST_LABEL} />
          <p>
            <Link href="/blog" className={buttonVariants({ variant: 'secondary', className: 'w-full md:w-auto' })}>
              Xem tất cả bài viết
            </Link>
          </p>
        </div>
      </Container>
    </section>
  )
}
