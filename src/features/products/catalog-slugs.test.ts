import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { PRODUCT_SEEDS } from '@/db/seed-data'
import { isCatalogSlug, PRODUCT_SLUGS } from '@/features/products/catalog-slugs'
import { isProductSlug } from '@/features/products/slug'

// The proxy answers product slugs from this registry, never from the database (ADR-0017, NS-79). The seed and the
// registry change in the same PR; these tests stop the two from drifting apart.
describe('catalog-slugs', () => {
  it('PRODUCT_SLUGS equals the seed slugs', () => {
    expect([...PRODUCT_SLUGS]).toEqual(PRODUCT_SEEDS.map((seed) => seed.slug))
  })

  it('every registry slug passes isProductSlug', () => {
    for (const slug of PRODUCT_SLUGS) expect(isProductSlug(slug)).toBe(true)
  })

  it('has no duplicates', () => {
    expect(new Set(PRODUCT_SLUGS).size).toBe(PRODUCT_SLUGS.length)
  })

  it('isCatalogSlug is true for every registry slug', () => {
    for (const slug of PRODUCT_SLUGS) expect(isCatalogSlug(slug)).toBe(true)
  })

  it('isCatalogSlug is false for a well-formed unknown slug', () => {
    expect(isProductSlug('khong-ton-tai')).toBe(true)
    expect(isCatalogSlug('khong-ton-tai')).toBe(false)
  })

  it.each(['', 'AO-GIT-PUSH-FORCE', 'ao%2Dgit%2Dpush%2Dforce', 'ao-git-push-force ', 'constructor', '__proto__', 'toString'])(
    'isCatalogSlug is false for %j',
    (slug) => {
      expect(isCatalogSlug(slug)).toBe(false)
    },
  )

  it('catalog-slugs.ts imports nothing, so the proxy can use it', () => {
    expect(readFileSync('src/features/products/catalog-slugs.ts', 'utf8')).not.toMatch(/^\s*(import|export .* from)\s/m)
  })
})
