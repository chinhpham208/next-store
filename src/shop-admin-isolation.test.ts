import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// Audit PR #124 M2: what the shop reaches must not reach the admin UI. The build check is `npm run check:bundle`
// (scripts/check-admin-bundle.mjs); dependency-cruiser `shop-not-to-admin-components` checks the graph; this walks the
// imports of the entries `/cart` and `/checkout/*` use, so a barrel that grows a component fails in Vitest too.

const SHOP_ENTRIES = [
  'src/features/checkout/index.ts',
  'src/features/orders/index.ts',
  'src/features/cart/index.ts',
]

const resolve = (specifier: string): string | undefined => {
  if (!specifier.startsWith('@/')) return undefined
  const base = `src/${specifier.slice(2)}`
  return [`${base}.ts`, `${base}.tsx`, `${base}/index.ts`].find((path) => existsSync(path))
}

const importsOf = (source: string): string[] =>
  [...source.matchAll(/(?:from|import\()\s*['"]([^'"]+)['"]/g)].map((match) => match[1] ?? '')

const reachable = (entries: readonly string[]): Set<string> => {
  const seen = new Set<string>()
  const queue = [...entries]
  for (let file = queue.pop(); file !== undefined; file = queue.pop()) {
    if (seen.has(file)) continue
    seen.add(file)
    for (const specifier of importsOf(readFileSync(file, 'utf8'))) {
      const next = resolve(specifier)
      if (next !== undefined) queue.push(next)
    }
  }
  return seen
}

describe('shop-reachable code and the admin UI', () => {
  it('the entries of checkout, orders and cart reach no admin component and not admin/ui.ts', () => {
    const files = [...reachable(SHOP_ENTRIES)]
    expect(files.filter((file) => file.startsWith('src/features/admin/'))).not.toContain('src/features/admin/ui.ts')
    expect(files.filter((file) => file.startsWith('src/features/admin/components/'))).toEqual([])
    // Not green for being empty: the walk does reach the session read.
    expect(files).toContain('src/features/admin/cookie.ts')
  })

  it('no file reachable from them is a Client Component of admin', () => {
    const clients = [...reachable(SHOP_ENTRIES)].filter(
      (file) => file.startsWith('src/features/admin/') && /^['"]use client['"]/.test(readFileSync(file, 'utf8')),
    )
    expect(clients).toEqual([])
  })

  it('admin/index.ts exports the session reads and types, no component', () => {
    const exported = importsOf(readFileSync('src/features/admin/index.ts', 'utf8'))
    expect(exported.filter((specifier) => specifier.includes('/components/'))).toEqual([])
    expect(exported).toContain('@/features/admin/cookie')
  })
})
