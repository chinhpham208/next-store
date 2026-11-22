// The only entry src/proxy.ts uses (dependency-cruiser `proxy-entry-only`, `proxy-narrow-entry`): posts.ts imports
// nothing, so the blog branch of the proxy carries no MDX, React or database code (Task 13).
export { isPostSlug } from '@/features/blog/posts'
