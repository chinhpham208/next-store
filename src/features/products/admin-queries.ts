import 'server-only'
import { asc, eq } from 'drizzle-orm'
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

export async function getProductForAdmin(slug: string): Promise<AdminProductForm | null> {
  if (!(await hasAdminSession())) throw new Error('admin: no session')
  if (!isProductSlug(slug)) return null
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
}
