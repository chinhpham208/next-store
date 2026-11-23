import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { isCacheCount, rejectCacheArguments, SKIP_CACHE_ENTRY } from '@/lib/cache-args'

const SRC = fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, '')

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = `${dir}/${entry.name}`
    if (entry.isDirectory()) return sourceFiles(path)
    return /\.(ts|tsx|js|jsx|mdx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : []
  })

describe('rejectCacheArguments', () => {
  it('throws a fixed message naming the function, never the arguments', () => {
    expect(() => rejectCacheArguments('products.detail')).toThrow(/^invalid arguments for cached products\.detail$/)
  })
})

describe('isCacheCount', () => {
  it.each([1, 8, 9999])('accepts %j', (value) => {
    expect(isCacheCount(value, 9999)).toBe(true)
  })
  it.each([0, -1, 1.5, 10_000, Number.NaN, Number.POSITIVE_INFINITY, -0, '1', null, undefined, [1], { valueOf: () => 1 }])(
    'refuses %j',
    (value) => {
      expect(isCacheCount(value, 9999)).toBe(false)
    },
  )
})

it('SKIP_CACHE_ENTRY expires at once, so Next does not store the entry (production default handler)', () => {
  expect(SKIP_CACHE_ENTRY).toEqual({ revalidate: 0, expire: 0 })
})

// Next registers every 'use cache' function as a Server Function, so each one is reachable with arguments chosen by
// the caller (NS-105, conventions §2). A new file with the directive must be reviewed for that and added here.
it('NS-105: only the reviewed files use the cache directive', () => {
  const withDirective = sourceFiles(SRC)
    .filter((path) => /^\s*['"]use cache[^'"]*['"]/m.test(readFileSync(path, 'utf8')))
    .map((path) => path.slice(SRC.length + 1))
  expect(withDirective).toEqual(['features/products/queries.ts'])
})
