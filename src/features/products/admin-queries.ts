import 'server-only'
import { asc, eq } from 'drizzle-orm'
import { cache } from 'react'
import { dbQuery, products } from '@/db'
import { hasAdminSession } from '@/features/admin'
import { isProductSlug } from '@/features/products/slug'
import { UPDATED_AT_TEXT } from '@/features/products/updated-at-text'
import type { AdminProductForm, AdminProductRow } from '@/features/products/types'

// Reads of the admin area (M5 Task 9, ADR-0019): never cached, so an edit shows at once and no
// admin data ever sits in a shared entry. Each one checks the session itself, first (ADR-0018 "Sửa theo audit PR
// #106" H1): a layout does not keep a page from rendering, so a page that forgot requireAdminPage throws here
// instead of quietly showing the catalogue. src/admin-session-checks.test.ts reads this file.

export async function listProductsForAdmin(): Promise<AdminProductRow[]> {
  if (!(await hasAdminSession())) throw new Error('admin: no session')
  return dbQuery({
    name: 'products.admin-list',
    run: (db) =>
      db
        .select({ slug: products.slug, name: products.name, price: products.price, stock: products.stock })
        .from(products)
        .orderBy(asc(products.id)),
  })
}

// generateMetadata and the page of /admin/products/[slug] both read the product: React's cache() shares one query
// within the request and forgets it when the request ends (audit PR #108 nit), so it is no cache in the sense of
// ADR-0019. It wraps the inner read only: the session is checked on every call, first.
const readProductForAdmin = cache(async (slug: string): Promise<AdminProductForm | null> => {
  const [row] = await dbQuery({
    name: 'products.admin-get',
    run: (db) =>
      db
        .select({
          slug: products.slug,
          name: products.name,
          description: products.description,
          price: products.price,
          stock: products.stock,
          updatedAt: UPDATED_AT_TEXT,
        })
        .from(products)
        .where(eq(products.slug, slug)),
  })
  return row ?? null
})

export async function getProductForAdmin(slug: string): Promise<AdminProductForm | null> {
  if (!(await hasAdminSession())) throw new Error('admin: no session')
  if (!isProductSlug(slug)) return null
  return readProductForAdmin(slug)
}
