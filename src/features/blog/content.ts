import type { MDXContent } from 'mdx/types'
import ChaoMungDenNextStore from '@content/blog/chao-mung-den-next-store.mdx'
import ChonAoThunChoDanCode from '@content/blog/chon-ao-thun-cho-dan-code.mdx'
import GitPushForceVaNhungCauChuyenBuon from '@content/blog/git-push-force-va-nhung-cau-chuyen-buon.mdx'
import ViSaoCocCaPheLaCongCuDebug from '@content/blog/vi-sao-coc-ca-phe-la-cong-cu-debug.mdx'
import type { PostSlug } from '@/features/blog/posts'

// Static imports, not import(`…/${slug}.mdx`): the bundler sees exactly these four files, and Record<PostSlug, …>
// makes TypeScript fail when a registry entry has no body or a body has no entry (Review Focus 10).
const POST_CONTENT: Record<PostSlug, MDXContent> = {
  'chao-mung-den-next-store': ChaoMungDenNextStore,
  'chon-ao-thun-cho-dan-code': ChonAoThunChoDanCode,
  'git-push-force-va-nhung-cau-chuyen-buon': GitPushForceVaNhungCauChuyenBuon,
  'vi-sao-coc-ca-phe-la-cong-cu-debug': ViSaoCocCaPheLaCongCuDebug,
}

export const getPostContent = (slug: PostSlug): MDXContent => POST_CONTENT[slug]
