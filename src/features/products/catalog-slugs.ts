// No imports on purpose (ADR-0017, like the blog's posts.ts in ADR-0012): src/proxy.ts reaches this through
// proxy-api.ts, and on Vercel the proxy runs at the edge nearest the visitor, far from the database. Every product
// slug the shop sells is listed here, in the order of PRODUCT_SEEDS (src/db/seed-data.ts). Adding or removing a
// product means changing the seed and this list in the same PR and deploying (product images live in the repo
// anyway); Vitest `PRODUCT_SLUGS equals the seed slugs` stops the two from drifting, and the read-only E2E
// `catalog: sitemap và registry slug khớp nhau` checks each environment's database against it.
export const PRODUCT_SLUGS = [
  'ao-git-push-force',
  'ao-404-not-found',
  'ao-hello-world',
  'ao-sudo-make-me-coffee',
  'ao-tabs-vs-spaces',
  'ao-dark-mode',
  'coc-works-on-my-machine',
  'coc-console-log-ca-phe',
  'coc-null-pointer',
  'coc-merge-conflict',
  'coc-while-true-coffee',
  'coc-giu-nhiet-localhost',
  'sticker-hello-world',
  'sticker-not-a-bug',
  'sticker-git',
  'sticker-dau-cham-phay',
  'sticker-stack-overflow',
  'sticker-vit-cao-su',
  'sach-clean-code',
  'sach-pragmatic-programmer',
  'sach-refactoring',
  'sach-git-co-ban',
  'sach-cau-truc-du-lieu',
  'sach-typescript-thuc-chien',
] as const

const CATALOG = new Set<string>(PRODUCT_SLUGS)

// A Set, not an object lookup: `constructor` or `__proto__` must never count as a product.
export const isCatalogSlug = (slug: string): boolean => CATALOG.has(slug)
