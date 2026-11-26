import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// Every file allowed to say "use client", and what each may import (conventions.md §2). Moved here from
// src/features/cart/components/cart-ui.test.ts in M5 Task 10, when the list stopped being the cart's alone.
const CART_CLIENT_FILES = [
  'src/features/cart/components/cart-provider.tsx',
  'src/features/cart/components/cart-link.tsx',
  'src/features/cart/components/add-to-cart-form.tsx',
  'src/features/cart/components/cart-line-controls.tsx',
]
// M5 (ADR-0018, plan M5 Task 7): the login form and the logout button.
const ADMIN_CLIENT_FILES = ['src/features/admin/components/login-form.tsx', 'src/features/admin/components/logout-button.tsx']
// M5 Task 10: the edit form lives with its action in features/products (audit PR #107 M-2; ticket NS-125): from
// features/admin it would need the products index, which pulls 'use cache' and server-only files into the client
// graph, and products → admin → products is a cycle.
const PRODUCTS_CLIENT_FILES = ['src/features/products/components/product-edit-form.tsx']
// Error boundaries are Client Components by Next.js's rule; the admin one is Gate 2 M5 decision 5.
const APP_CLIENT_FILES = ['src/app/(shop)/error.tsx', 'src/app/admin/(protected)/error.tsx']
const ALLOWED_CLIENT_FILES = [...APP_CLIENT_FILES, ...CART_CLIENT_FILES, ...ADMIN_CLIENT_FILES, ...PRODUCTS_CLIENT_FILES]

const listSources = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return listSources(path)
    return /\.(tsx|ts|jsx|js)$/.test(path) && !/\.test\.tsx?$/.test(path) ? [path.split('\\').join('/')] : []
  })

const USE_CLIENT = /^\s*(?:\/\/[^\n]*\n|\/\*[\s\S]*?\*\/\s*)*\s*['"]use client['"]/

const importsOf = (source: string): string[] =>
  [...source.matchAll(/^\s*(?:import|export)\s[\s\S]*?\sfrom\s+['"]([^'"]+)['"]/gm), ...source.matchAll(/\bimport\(\s*['"]([^'"]+)['"]/g)].map(
    (match) => match[1] ?? '',
  )

const BASE_CLIENT_IMPORT = (specifier: string): boolean =>
  specifier === 'react' ||
  specifier === 'next/link' ||
  /^@\/components\/ui\/[a-z-]+$/.test(specifier) ||
  specifier === '@/lib/cn' ||
  specifier === '@/lib/format-price' ||
  // NS-113 (plan M5 Task 11): the NS-107 title workaround, one place for every form (NS-114 removes it).
  specifier === '@/lib/use-held-title'

// The cart: the action reference and the import-free modules; the four cart client files may use one another.
const isAllowedCartImport = (specifier: string): boolean =>
  BASE_CLIENT_IMPORT(specifier) ||
  /^@\/features\/cart\/(actions|messages|types|limits)$/.test(specifier) ||
  /^@\/features\/cart\/components\/(cart-provider|cart-link|add-to-cart-form|cart-line-controls)$/.test(specifier)

// Admin and products forms: the same base, their own action reference and text / type modules, and next/navigation
// for unstable_rethrow (a redirect thrown by an action must reach the router, Gate 2 decision 6).
const isAllowedAdminImport = (specifier: string): boolean =>
  BASE_CLIENT_IMPORT(specifier) ||
  specifier === 'next/navigation' ||
  /^@\/features\/admin\/(actions|messages|types|limits)$/.test(specifier)

const isAllowedProductsImport = (specifier: string): boolean =>
  BASE_CLIENT_IMPORT(specifier) ||
  specifier === 'next/navigation' ||
  /^@\/features\/products\/(actions|edit-messages|types)$/.test(specifier)

// Error boundaries: fixed text and shared layout pieces only (src/admin-session-checks.test.ts holds the admin one
// to the same rule as a static route file).
const isAllowedAppImport = (specifier: string): boolean =>
  specifier === 'react' || specifier === 'next/link' || /^@\/components\/(ui|layout)\/[a-z-]+$/.test(specifier) || specifier === '@/lib/cn'

const RULES: [readonly string[], (specifier: string) => boolean][] = [
  [CART_CLIENT_FILES, isAllowedCartImport],
  [ADMIN_CLIENT_FILES, isAllowedAdminImport],
  [PRODUCTS_CLIENT_FILES, isAllowedProductsImport],
  [APP_CLIENT_FILES, isAllowedAppImport],
]

// conventions.md §2: from next/navigation, only unstable_rethrow. Returns every other binding (default, namespace,
// named, renamed) or '(side effect)' for a bare import; type-only imports are not used and count as bindings too.
const ALLOWED_NAVIGATION_NAMES = new Set(['unstable_rethrow'])
const disallowedNavigationImports = (source: string): string[] =>
  [...source.matchAll(/^\s*import\s+(?:([^'"]*?)\s+from\s+)?['"]next\/navigation['"]/gm)].flatMap((match) => {
    const clause = match[1]?.trim()
    if (clause === undefined) return ['(side effect)']
    const named = /\{([\s\S]*)\}/.exec(clause)?.[1] ?? ''
    const outside = clause
      .replace(/\{[\s\S]*\}/, '')
      .split(',')
      .map((part) => part.trim())
      .filter((part) => part !== '')
    const names = named
      .split(',')
      .map((part) => part.trim())
      .filter((part) => part !== '' && !ALLOWED_NAVIGATION_NAMES.has(part))
    return [...outside, ...names]
  })

describe('client boundary', () => {
  it('only the listed files use "use client"', () => {
    const found = listSources('src')
      .filter((path) => USE_CLIENT.test(readFileSync(path, 'utf8')))
      .sort()
    expect(found).toEqual([...ALLOWED_CLIENT_FILES].sort())
  })

  it.each(RULES.flatMap(([files, allowed]) => files.map((file) => [file, allowed] as const)))(
    '%s imports only allowed modules, nothing server-only',
    (path, allowed) => {
      const source = readFileSync(path, 'utf8')
      expect(source).not.toContain('server-only')
      expect(importsOf(source).filter((specifier) => !allowed(specifier))).toEqual([])
      expect(disallowedNavigationImports(source)).toEqual([])
    },
  )

  it('product-edit-form imports only allowed modules', () => {
    const source = readFileSync('src/features/products/components/product-edit-form.tsx', 'utf8')
    expect(importsOf(source).filter((specifier) => !isAllowedProductsImport(specifier))).toEqual([])
    // Never the products index: it re-exports 'use cache' queries and server-only reads (audit PR #107 M-2).
    expect(importsOf(source)).not.toContain('@/features/products')
  })

  // Audit PR #108 M-1: a client file re-exported by the shop's entry ships its chunk (and the id of the action it
  // calls) with every shop page that imports the entry. The admin part of products has its own entry, admin.ts,
  // which only src/app/admin/** may import (dependency-cruiser `products-admin-entry-only-from-admin`).
  it('the products index re-exports no client file and nothing of the admin area (audit PR #108 M-1)', () => {
    const exported = importsOf(readFileSync('src/features/products/index.ts', 'utf8'))
    const clientModules = ALLOWED_CLIENT_FILES.map((path) => path.replace(/^src\//, '@/').replace(/\.tsx?$/, ''))
    expect(exported.filter((specifier) => clientModules.includes(specifier))).toEqual([])
    expect(exported.filter((specifier) => /\/(admin-queries|actions|edit-messages|admin-product-table)$/.test(specifier))).toEqual([])
  })

  it('the products admin entry carries the admin part (audit PR #108 M-1)', () => {
    const exported = importsOf(readFileSync('src/features/products/admin.ts', 'utf8'))
    expect(exported).toEqual(
      expect.arrayContaining([
        '@/features/products/admin-queries',
        '@/features/products/components/product-edit-form',
        '@/features/products/components/admin-product-table',
      ]),
    )
    expect(exported).not.toContain('@/features/products/actions')
  })

  it('the import rules refuse what they must', () => {
    expect(isAllowedProductsImport('@/features/products')).toBe(false)
    expect(isAllowedProductsImport('@/features/products/queries')).toBe(false)
    expect(isAllowedProductsImport('@/features/products/admin-queries')).toBe(false)
    expect(isAllowedProductsImport('@/features/admin')).toBe(false)
    expect(isAllowedAdminImport('@/features/products/actions')).toBe(false)
    expect(isAllowedAppImport('@/features/admin')).toBe(false)
    expect(importsOf("export { x } from '@/db'\nconst y = import('@/db')")).toEqual(['@/db', '@/db'])
  })

  it('client files take only unstable_rethrow from next/navigation (audit PR #105 N2)', () => {
    expect(disallowedNavigationImports("import { unstable_rethrow } from 'next/navigation'")).toEqual([])
    expect(disallowedNavigationImports("import { redirect, unstable_rethrow } from 'next/navigation'")).toEqual([
      'redirect',
    ])
    expect(disallowedNavigationImports("import { useRouter as r } from 'next/navigation'")).toEqual(['useRouter as r'])
    expect(disallowedNavigationImports("import * as navigation from 'next/navigation'")).toEqual(['* as navigation'])
    expect(disallowedNavigationImports("import navigation from 'next/navigation'")).toEqual(['navigation'])
    expect(disallowedNavigationImports("import 'next/navigation'")).toEqual(['(side effect)'])
    expect(disallowedNavigationImports("import Link from 'next/link'\nimport { redirect } from 'next/navigation'")).toEqual([
      'redirect',
    ])
  })

  it('UI primitives used by client files stay free of hooks and "use client"', () => {
    for (const path of ['src/components/ui/cart-icon.tsx', 'src/components/ui/quantity-stepper.tsx', 'src/components/ui/input.tsx']) {
      const source = readFileSync(path, 'utf8')
      expect(source, path).not.toMatch(USE_CLIENT)
      expect(source, path).not.toMatch(/\buse[A-Z]\w*\(/)
    }
  })
})
