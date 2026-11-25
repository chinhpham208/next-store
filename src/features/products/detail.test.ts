import { cacheLife, cacheTag } from 'next/cache'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/db/client'
import { runMigrations } from '@/db/migrate'
import { seed } from '@/db/seed'
import { getAllProductSlugs, getProductBySlug } from '@/features/products'
import { SKIP_CACHE_ENTRY } from '@/lib/cache-args'
import { getCachedProductBySlug } from './queries'

// cacheTag() throws outside a cacheComponents build; Vitest also ignores 'use cache', so these tests cover the
// query and the guard in front of it. The directive's effect is checked by the build of the detail page (Task 11).
vi.mock('next/cache', () => ({ cacheTag: vi.fn(), cacheLife: vi.fn() }))

beforeAll(async () => {
  await runMigrations()
  await seed()
})
beforeEach(() => {
  vi.clearAllMocks()
})
afterEach(() => {
  vi.restoreAllMocks()
})

describe('getProductBySlug', () => {
  it('US-04: returns the full detail of a product in stock', async () => {
    expect(await getProductBySlug('ao-git-push-force')).toEqual({
      slug: 'ao-git-push-force',
      name: 'Áo thun git push --force',
      description:
        'Áo thun cotton 100% in dòng lệnh khiến cả team phải dừng lại. Form unisex, mặc thoải mái cả ngày.',
      price: 199000,
      image: '/images/ao-thun.svg',
      categorySlug: 'ao-thun',
      categoryName: 'Áo thun',
      stock: 12,
    })
  })
  it('US-04: returns stock 0 for a sold-out product', async () => {
    expect((await getProductBySlug('sach-clean-code'))?.stock).toBe(0)
  })
  it('US-05: returns null for an unknown slug', async () => {
    expect(await getProductBySlug('khong-ton-tai')).toBeNull()
  })
  // NS-109: an expire-0 read inside the ISR prerender of the Open Graph image route makes the route dynamic, and a
  // route handler then answers 500 instead of reaching notFound(). An unknown slug is answered from the cached list
  // of catalogue slugs (one fixed key), so it never opens a per-slug cached read at all.
  it('NS-109: answers an unknown slug without a per-slug cached read or a lifetime that skips the entry', async () => {
    const select = vi.spyOn(db, 'select')
    expect(await getProductBySlug('khong-ton-tai-ns109')).toBeNull()
    expect(cacheTag).not.toHaveBeenCalledWith('product:khong-ton-tai-ns109')
    expect(cacheLife).not.toHaveBeenCalledWith(SKIP_CACHE_ENTRY)
    // Only the slug list was read, never the detail columns.
    expect(select.mock.calls.some(([fields]) => typeof fields === 'object' && 'description' in fields)).toBe(false)
  })
  it('returns null for a malformed slug without creating a cache entry', async () => {
    expect(await getProductBySlug("x' or '1'='1")).toBeNull()
    expect(await getProductBySlug('a'.repeat(81))).toBeNull()
    expect(cacheTag).not.toHaveBeenCalled()
  })
  it.each(["x' or '1'='1", 'a'.repeat(81), 'Sai_Dang', 'a/b', '', '__proto__'])(
    'never queries the database for the malformed slug %j',
    async (slug) => {
      const select = vi.spyOn(db, 'select')
      expect(await getProductBySlug(slug)).toBeNull()
      expect(select).not.toHaveBeenCalled()
      expect(cacheTag).not.toHaveBeenCalled()
      expect(cacheLife).not.toHaveBeenCalled()
    },
  )
  it('NS-55: a failed detail query carries neither the SQL nor the slug', async () => {
    // The first select is the slug list (NS-109); the detail query is the second.
    const original = db.select.bind(db)
    const select = vi.spyOn(db, 'select')
    select.mockImplementationOnce(original)
    select.mockImplementationOnce(() => {
      throw Object.assign(new Error('Failed query: select "slug" from "products" params: sticker-git'), {
        cause: Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:9'), { code: 'ECONNREFUSED' }),
      })
    })
    const error: unknown = await getProductBySlug('sticker-git').catch((caught: unknown) => caught)
    expect(error).toMatchObject({ message: 'database query failed: products.detail (ECONNREFUSED)' })
    expect(error).not.toHaveProperty('cause')
  })
  it('tags the cache entry with product:<slug> and an hours lifetime', async () => {
    await getProductBySlug('sticker-git')
    expect(cacheTag).toHaveBeenCalledWith('product:sticker-git')
    expect(cacheLife).toHaveBeenCalledWith('hours')
  })
})

// NS-105: the cached query is a Server Function of its own, reachable without getProductBySlug's guard. Reflect.apply
// bypasses the static type, as an action request does.
describe('getCachedProductBySlug called directly (NS-105)', () => {
  it.each([123, null, undefined, ['ao-x'], 'A B', '../x', 'Sai_Dang', 'a'.repeat(81), ''])(
    'refuses %j before querying or tagging',
    async (slug) => {
      const select = vi.spyOn(db, 'select')
      await expect(Reflect.apply(getCachedProductBySlug, undefined, [slug])).rejects.toThrow(
        /^invalid arguments for cached products\.detail$/,
      )
      expect(select).not.toHaveBeenCalled()
      expect(cacheTag).not.toHaveBeenCalled()
      expect(cacheLife).not.toHaveBeenCalled()
    },
  )
  it('returns null for an unknown well-formed slug and expires the entry at once, so it is not stored', async () => {
    expect(await getCachedProductBySlug('x-khong-co-that')).toBeNull()
    expect(cacheLife).toHaveBeenLastCalledWith({ revalidate: 0, expire: 0 })
  })
  it('keeps the hours lifetime of a product that exists', async () => {
    expect((await getCachedProductBySlug('sticker-git'))?.slug).toBe('sticker-git')
    expect(vi.mocked(cacheLife).mock.calls).toEqual([['hours']])
  })
})

describe('getAllProductSlugs', () => {
  it('returns the 24 slugs in id order', async () => {
    const all = await getAllProductSlugs()
    expect(all).toHaveLength(24)
    expect(all[0]).toBe('ao-git-push-force')
    expect(all.at(-1)).toBe('sach-typescript-thuc-chien')
  })
  it('is not cached', async () => {
    await getAllProductSlugs()
    expect(cacheTag).not.toHaveBeenCalled()
  })
})
