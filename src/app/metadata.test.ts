import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, it } from 'vitest'

// Paths relative to the repo root (Vitest's cwd), with forward slashes, so the expected lists read like the tree.
const sourceFiles = (...roots: string[]): string[] =>
  roots.flatMap((root) =>
    readdirSync(root, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile() && /\.tsx?$/.test(entry.name) && !entry.name.endsWith('.test.ts'))
      .map((entry) => join(entry.parentPath, entry.name).split('\\').join('/')),
  )

// M3 K5: a page or layout that declares openGraph (or twitter) drops the inherited og:image, og:site_name and the
// summary_large_image card, while still showing og:title — easy to miss by eye. The one exception is the blog post
// metadata: /blog/[slug] has its own opengraph-image in the same segment, so its image survives (Task 12).
const OPEN_GRAPH_ALLOWED = ['src/app/layout.tsx', 'src/features/blog/metadata.ts']

it('no page or layout below the root declares openGraph or twitter', () => {
  const offenders = sourceFiles('src/app', 'src/features')
    .filter((file) => !OPEN_GRAPH_ALLOWED.includes(file))
    .filter((file) => /\b(openGraph|twitter)\s*:/.test(readFileSync(file, 'utf8')))
  expect(offenders).toEqual([])
})

it('the root layout sets metadataBase from getSiteUrl', () => {
  expect(readFileSync('src/app/layout.tsx', 'utf8')).toMatch(/metadataBase:\s*getSiteUrl\(\)/)
})

it('no source file hard-codes the production domain', () => {
  expect(sourceFiles('src').filter((file) => /vercel\.app/.test(readFileSync(file, 'utf8')))).toEqual([])
})

it('the admin area is noindex, titled "… · Quản trị" (requirements.md §5, plan M5 Task 7)', async () => {
  const { metadata } = await import('@/app/admin/layout')
  expect(metadata.robots).toEqual({ index: false, follow: false })
  expect(metadata.title).toEqual({ template: '%s · Quản trị', default: 'Quản trị' })
  const login = await import('@/app/admin/login/page')
  expect(login.metadata.title).toBe('Đăng nhập')
})
