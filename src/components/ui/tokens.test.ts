import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { compile } from '@tailwindcss/node'
import { beforeAll, describe, expect, it } from 'vitest'

// Tailwind v4 silently drops a class whose token name does not resolve (e.g. `max-w-container-page` when only
// `--container-page` exists), so typecheck, lint and build all stay green. Compiling the real globals.css
// against the classes the primitives actually use is the only check that catches it.

const APP_DIR = join(process.cwd(), 'src/app')
const COMPONENT_DIRS = ['src/components/ui', 'src/components/layout', 'src/features/products/components'].map(
  (dir) => join(process.cwd(), dir),
)

const stringLiterals = (code: string): string[] => [...code.matchAll(/'([^']*)'|"([^"]*)"/g)].map((m) => m[1] ?? m[2] ?? '')

// Class strings live in cn(...) arguments, in *_CLASS constants (a string, or a lookup object's values, not
// keys) and in literal className="..." attributes. cn(...) arguments never contain parentheses, so stopping at
// the first ")" keeps a later comment or prop from being read as a class.
const classStringsOf = (source: string): string[] => {
  const cnArgs = [...source.matchAll(/\bcn\(([^()]*)\)/g)].flatMap((m) => stringLiterals(m[1] ?? ''))
  const lookupValues = [...source.matchAll(/_CLASS\b[^=]*=\s*\{([\s\S]*?)\n\}/g)].flatMap((m) =>
    [...(m[1] ?? '').matchAll(/:\s*'([^']*)'/g)].map((v) => v[1] ?? ''),
  )
  const constants = [...source.matchAll(/_CLASS\s*=\s*'([^']*)'/g)].map((m) => m[1] ?? '')
  const attributes = [...source.matchAll(/className="([^"]*)"/g)].map((m) => m[1] ?? '')
  return [...cnArgs, ...lookupValues, ...constants, ...attributes]
}

const UI_CLASSES = [
  ...new Set(
    COMPONENT_DIRS.flatMap((dir) =>
      readdirSync(dir)
        .filter((file) => file.endsWith('.tsx'))
        .map((file) => readFileSync(join(dir, file), 'utf8')),
    )
      .flatMap(classStringsOf)
      .flatMap((value) => value.split(/\s+/))
      .filter(Boolean),
  ),
].sort()

const selectorOf = (candidate: string): string => `.${candidate.replace(/[^a-zA-Z0-9_-]/g, '\\$&')}`
// A variant class carries its pseudo-class in the selector (`.hover\:x:hover {`, `.disabled\:x:disabled {`), so
// the selector may be followed by a pseudo or a brace, but not by more identifier characters (`.bg-border` must
// not be satisfied by `.bg-border-strong`).
const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const ruleFor = (candidate: string): RegExp => new RegExp(`${escapeRegExp(selectorOf(candidate))}(?![\\w-])[^{,]*\\{`)
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

  it('finds the class strings of the M2 button, input and site header', () => {
    expect(UI_CLASSES).toEqual(
      expect.arrayContaining(['disabled:bg-surface-muted', 'placeholder:text-muted-foreground', 'underline-offset-8']),
    )
    expect(UI_CLASSES).not.toContain('button')
  })

  it('finds the class strings of the M2 product listing', () => {
    expect(UI_CLASSES).toEqual(
      expect.arrayContaining([
        'aria-[current=true]:before:size-2',
        'aria-[current=page]:bg-foreground',
        'underline-offset-6',
        'border-dashed',
      ]),
    )
  })

  it.each(UI_CLASSES)('emits a rule for %s', (candidate) => {
    expect(css).toMatch(ruleFor(candidate))
  })

  it('stops the cursor blink under prefers-reduced-motion', () => {
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{ \.cursor-block--blink \{ animation: none; \}/)
  })

  it('overrides the colour tokens on :root for the dark scheme', () => {
    expect(css).toMatch(/@media \(prefers-color-scheme: dark\) \{ :root \{[^}]*--color-background: #0c0f12;/)
    expect(css).toMatch(/@media \(prefers-color-scheme: dark\) \{ :root \{[^}]*--color-accent: #2ee6ea;/)
  })
})
