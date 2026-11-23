// Posts are imported as components (src/features/blog/content.ts); @next/mdx compiles them at build time.
declare module '*.mdx' {
  import type { MDXContent } from 'mdx/types'

  const MDXComponent: MDXContent
  export default MDXComponent
}
