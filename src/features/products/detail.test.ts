import { cacheLife, cacheTag } from 'next/cache'
import { readFileSync } from 'node:fs'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/db'
import { runMigrations } from '@/db/migrate'
import { seed } from '@/db/seed'
import { getAllProductSlugs, getProductBySlug, isKnownProductSlug } from '@/features/products'
import { resetKnownProductSlugs } from './slug-guard'

// cacheTag() throws outside a cacheComponents build; Vitest also ignores 'use cache', so these tests cover the
// query and the guard in front of it. The directive's effect is checked by the build of the detail page (Task 11).
vi.mock('next/cache', () => ({ cacheTag: vi.fn(), cacheLife: vi.fn() }))

beforeAll(async () => {
  await runMigrations()
  await seed()
})
beforeEach(() => {
  vi.clearAllMocks()
  resetKnownProductSlugs()
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
  it('tags the cache entry with product:<slug> and an hours lifetime', async () => {
    await getProductBySlug('sticker-git')
    expect(cacheTag).toHaveBeenCalledWith('product:sticker-git')
    expect(cacheLife).toHaveBeenCalledWith('hours')
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

describe('isKnownProductSlug', () => {
  it('is true for a seeded slug and false for an unknown or malformed one', async () => {
    expect(await isKnownProductSlug('coc-merge-conflict')).toBe(true)
    expect(await isKnownProductSlug('khong-ton-tai')).toBe(false)
    expect(await isKnownProductSlug('Sai_Dang')).toBe(false)
  })
  it('queries the database once per known slug and every time for an unknown one', async () => {
    const select = vi.spyOn(db, 'select')
    await isKnownProductSlug('coc-merge-conflict')
    await isKnownProductSlug('coc-merge-conflict')
    expect(select).toHaveBeenCalledTimes(1)
    await isKnownProductSlug('khong-ton-tai')
    await isKnownProductSlug('khong-ton-tai')
    expect(select).toHaveBeenCalledTimes(3)
    await isKnownProductSlug('Sai_Dang')
    expect(select).toHaveBeenCalledTimes(3)
  })
  it('lets a database error reach the caller', async () => {
    vi.spyOn(db, 'select').mockImplementationOnce(() => {
      throw new Error('db down')
    })
    await expect(isKnownProductSlug('sticker-vit-cao-su')).rejects.toThrow('db down')
  })
  it('does not remember a slug whose lookup failed', async () => {
    vi.spyOn(db, 'select').mockImplementationOnce(() => {
      throw new Error('db down')
    })
    await expect(isKnownProductSlug('sticker-vit-cao-su')).rejects.toThrow('db down')
    expect(await isKnownProductSlug('sticker-vit-cao-su')).toBe(true)
  })
  it('answers a malformed slug without the database even when the database is down', async () => {
    const select = vi.spyOn(db, 'select').mockImplementation(() => {
      throw new Error('db down')
    })
    expect(await isKnownProductSlug('Sai_Dang')).toBe(false)
    expect(await isKnownProductSlug('khong%2Dton%2Dtai')).toBe(false)
    expect(select).not.toHaveBeenCalled()
  })
  it('shares one query between concurrent lookups of the same slug', async () => {
    const select = vi.spyOn(db, 'select')
    const results = await Promise.all([
      isKnownProductSlug('khong-ton-tai'),
      isKnownProductSlug('khong-ton-tai'),
      isKnownProductSlug('khong-ton-tai'),
    ])
    expect(results).toEqual([false, false, false])
    expect(select).toHaveBeenCalledTimes(1)
    // Settled lookups are not kept: the next request for an unknown slug asks the database again.
    await isKnownProductSlug('khong-ton-tai')
    expect(select).toHaveBeenCalledTimes(2)
  })
  it('shares a failed lookup with concurrent callers, then forgets it', async () => {
    vi.spyOn(db, 'select').mockImplementationOnce(() => {
      throw new Error('db down')
    })
    const results = await Promise.allSettled([isKnownProductSlug('sticker-git'), isKnownProductSlug('sticker-git')])
    expect(results.map((result) => result.status)).toEqual(['rejected', 'rejected'])
    expect(await isKnownProductSlug('sticker-git')).toBe(true)
  })
  it('never touches the cache, so the proxy can call it (K6)', async () => {
    await isKnownProductSlug('coc-merge-conflict')
    expect(cacheTag).not.toHaveBeenCalled()
    expect(cacheLife).not.toHaveBeenCalled()
    const source = readFileSync(new URL('./slug-guard.ts', import.meta.url), 'utf8')
    expect(source).not.toMatch(/^\s*['"]use cache/m)
    expect(source).not.toMatch(/from ['"]next\/cache['"]/)
  })
})
