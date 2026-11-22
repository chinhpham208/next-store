// The types live in posts.ts because that file may import nothing (see the comment there); this is where the rest of
// the feature reads them from.
export type { PostMeta, PostSlug } from '@/features/blog/posts'
