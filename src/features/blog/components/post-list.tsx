import Link from 'next/link'
import type { PostMeta } from '@/features/blog/types'
import { formatDate } from '@/lib/format-date'

export type PostListProps = { posts: PostMeta[]; headingLevel: 2 | 3; label: string }

// Same trick as ProductCard: the ::after of the title link covers the whole row, so the row is the click target and
// the focus ring is drawn around it (design-system §2, PostList).
const TITLE_LINK_CLASS =
  'after:absolute after:inset-0 after:rounded-md underline-offset-4 hover:underline focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:outline-offset-2 focus-visible:after:outline-ring'

// One layout for /blog (h2) and the home page (h3). DOM order is title, date, description so a screen reader meets
// the title first; on desktop the grid lifts the date into the left column, level with the first line of the title.
export const PostList = ({ posts, headingLevel, label }: PostListProps) => {
  if (posts.length === 0) return null
  const Heading = headingLevel === 2 ? 'h2' : 'h3'

  return (
    <ul aria-label={label} className="flex flex-col border-b border-border">
      {posts.map((post) => (
        <li key={post.slug} className="relative grid gap-2 border-t border-border py-6 md:grid-cols-4 md:gap-x-8 md:py-8">
          <Heading className="text-xl font-semibold text-balance break-words md:col-span-3 md:col-start-2 md:text-2xl">
            <Link href={`/blog/${post.slug}`} className={TITLE_LINK_CLASS}>
              {post.title}
            </Link>
          </Heading>
          <time
            dateTime={post.publishedAt}
            className="text-sm text-muted-foreground md:col-start-1 md:row-start-1 md:pt-1 md:text-base"
          >
            {formatDate(post.publishedAt)}
          </time>
          <p className="text-muted-foreground text-pretty md:col-span-3 md:col-start-2">{post.description}</p>
        </li>
      ))}
    </ul>
  )
}
