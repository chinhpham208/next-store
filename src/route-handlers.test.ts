import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { describe, expect, it } from 'vitest'

// The payment webhook is the only route handler of the repo (ADR-0021). The metadata routes (sitemap, robots, OG
// images) are not route.* files. A second route handler needs an ADR and a change to this list.
const ROUTE_HANDLERS = ['src/app/api/webhooks/payment/route.ts']
const ROUTE_FILE = /(^|\/)route\.(ts|tsx|js|jsx)$/

const routeHandlersAmong = (paths: string[]) => paths.filter((path) => ROUTE_FILE.test(path))
const unexpected = (paths: string[]) => routeHandlersAmong(paths).filter((path) => !ROUTE_HANDLERS.includes(path))

const filesUnder = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? filesUnder(path) : [path]
  })

const appFiles = filesUnder('src/app').map((path) => relative('.', path).split(sep).join('/'))

describe('route handlers', () => {
  it('the payment webhook is the only route handler', () => {
    expect(routeHandlersAmong(appFiles)).toEqual(ROUTE_HANDLERS)
    // Nothing else lives under src/app/api.
    expect(appFiles.filter((path) => path.startsWith('src/app/api/'))).toEqual(ROUTE_HANDLERS)
  })

  it('exports POST only and imports only the checkout entry', () => {
    const text = readFileSync('src/app/api/webhooks/payment/route.ts', 'utf8')
    const exported = [...text.matchAll(/^export\s+(?:const|function|async function|let|var)\s+(\w+)/gm)].map((m) => m[1])
    expect(exported).toEqual(['POST'])
    expect(text).not.toMatch(/^export\s*(\{|\*|default)/m)
    const imports = [...text.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1])
    expect(imports).toEqual(['@/features/checkout'])
  })

  it('refuses a route handler anywhere else', () => {
    expect(
      unexpected([
        'src/app/api/webhooks/payment/route.ts',
        'src/app/api/x/route.ts',
        'src/app/(shop)/cart/route.ts',
        'src/app/admin/(protected)/orders/route.ts',
        'src/app/(shop)/page.tsx',
      ]),
    ).toEqual(['src/app/api/x/route.ts', 'src/app/(shop)/cart/route.ts', 'src/app/admin/(protected)/orders/route.ts'])
  })
})
