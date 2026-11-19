import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { compile } from '@tailwindcss/node'
import { beforeAll, describe, expect, it } from 'vitest'

// Tailwind v4 silently drops a class whose token name does not resolve (e.g. `max-w-container-page` when only
// `--container-page` exists), so typecheck, lint and build all stay green. Compiling the real globals.css
// against the classes the primitives actually use is the only check that catches it.

const APP_DIR = join(process.cwd(), 'src/app')
const UI_DIR = join(process.cwd(), 'src/components/ui')

const stringLiterals = (code: string): string[] => [...code.matchAll(/'([^']*)'|"([^"]*)"/g)].map((m) => m[1] ?? m[2] ?? '')

// Class strings live in cn(...) arguments and in *_CLASS lookup objects (values only, not keys).
const classStringsOf = (source: string): string[] => {
  const cnArgs = [...source.matchAll(/\bcn\(([\s\S]*?)\)\s*}/g)].flatMap((m) => stringLiterals(m[1] ?? ''))
  const lookupValues = [...source.matchAll(/_CLASS\b[^=]*=\s*\{([\s\S]*?)\n\}/g)].flatMap((m) =>
    [...(m[1] ?? '').matchAll(/:\s*'([^']*)'/g)].map((v) => v[1] ?? ''),
  )
  return [...cnArgs, ...lookupValues]
}

const UI_CLASSES = [
  ...new Set(
    readdirSync(UI_DIR)
      .filter((file) => file.endsWith('.tsx'))
      .flatMap((file) => classStringsOf(readFileSync(join(UI_DIR, file), 'utf8')))
      .flatMap((value) => value.split(/\s+/))
      .filter(Boolean),
  ),
].sort()

const selectorOf = (candidate: string): string => `.${candidate.replace(/[^a-zA-Z0-9_-]/g, '\\$&')}`
const squash = (css: string): string => css.replace(/\s+/g, ' ')

let css = ''

beforeAll(async () => {
  const compiler = await compile(readFileSync(join(APP_DIR, 'globals.css'), 'utf8'), {
    base: APP_DIR,
    onDependency: () => {},
  })
  css = squash(compiler.build(UI_CLASSES))
})

describe('globals.css tokens', () => {
  it('finds the class strings of the ui primitives', () => {
    expect(UI_CLASSES).toEqual(
      expect.arrayContaining(['max-w-container-page', 'tracking-label', 'bg-surface-muted', 'cursor-block--blink']),
    )
  })

  it.each(UI_CLASSES)('emits a rule for %s', (candidate) => {
    expect(css).toContain(`${selectorOf(candidate)} {`)
  })

  it('stops the cursor blink under prefers-reduced-motion', () => {
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{ \.cursor-block--blink \{ animation: none; \}/)
  })

  it('overrides the colour tokens on :root for the dark scheme', () => {
    expect(css).toMatch(/@media \(prefers-color-scheme: dark\) \{ :root \{[^}]*--color-background: #0c0f12;/)
    expect(css).toMatch(/@media \(prefers-color-scheme: dark\) \{ :root \{[^}]*--color-accent: #2ee6ea;/)
  })
})
