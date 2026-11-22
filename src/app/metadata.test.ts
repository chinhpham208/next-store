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
// summary_large_image card, while still showing og:title — easy to miss by eye. Task 12 adds the one exception.
it('no page or layout below the root declares openGraph or twitter', () => {
  const offenders = sourceFiles('src/app', 'src/features')
    .filter((file) => file !== 'src/app/layout.tsx')
    .filter((file) => /\b(openGraph|twitter)\s*:/.test(readFileSync(file, 'utf8')))
  expect(offenders).toEqual([])
})

it('the root layout sets metadataBase from getSiteUrl', () => {
  expect(readFileSync('src/app/layout.tsx', 'utf8')).toMatch(/metadataBase:\s*getSiteUrl\(\)/)
})

it('no source file hard-codes the production domain', () => {
  expect(sourceFiles('src').filter((file) => /vercel\.app/.test(readFileSync(file, 'utf8')))).toEqual([])
})
