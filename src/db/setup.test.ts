import { count, eq, sql } from 'drizzle-orm'
import { afterEach, beforeAll, expect, it, vi } from 'vitest'
import { categories, db, products } from '@/db'
import { connection } from '@/db/client'
import { runMigrations } from '@/db/migrate'
import { seed } from '@/db/seed'

beforeAll(async () => {
  // vitest.config.mts blanks DATABASE_URL; if that ever regresses, stop before touching a real database.
  expect(connection.target).toEqual({ kind: 'pglite', dataDir: 'memory://' })
  await runMigrations()
  await seed()
})
afterEach(() => vi.unstubAllEnvs())

it('runs against in-memory PGlite regardless of the shell environment', () => {
  expect(connection.kind).toBe('pglite')
})
it('seeds 4 categories with 6 products each', async () => {
  expect(await db.$count(categories)).toBe(4)
  expect(await db.$count(products)).toBe(24)
  const perCategory = await db.select({ n: count() }).from(products).groupBy(products.categoryId)
  expect(perCategory.map((row) => row.n)).toEqual([6, 6, 6, 6])
})
it('seeds exactly 6 featured and at least 2 out-of-stock products', async () => {
  expect(await db.$count(products, eq(products.featured, true))).toBe(6)
  expect(await db.$count(products, eq(products.stock, 0))).toBeGreaterThanOrEqual(2)
})
it('seed is idempotent', async () => {
  await seed()
  expect(await db.$count(products)).toBe(24)
})
it('seeds PGlite even when VERCEL_ENV=production', async () => {
  vi.stubEnv('VERCEL_ENV', 'production')
  await expect(seed()).resolves.toBeUndefined()
})
it('rejects a negative price or stock', async () => {
  await expect(db.update(products).set({ price: -1 }).where(eq(products.slug, 'sticker-git'))).rejects.toThrow()
  await expect(db.update(products).set({ stock: -1 }).where(eq(products.slug, 'sticker-git'))).rejects.toThrow()
})
it('bumps updated_at on update', async () => {
  const where = eq(products.slug, 'sticker-git')
  await db.update(products).set({ updatedAt: sql`now() - interval '1 day'` }).where(where)
  const [before] = await db.select({ at: products.updatedAt }).from(products).where(where)
  await db.update(products).set({ stock: 12 }).where(where)
  const [after] = await db.select({ at: products.updatedAt }).from(products).where(where)
  expect(after?.at.getTime()).toBeGreaterThan(before?.at.getTime() ?? Infinity)
})
