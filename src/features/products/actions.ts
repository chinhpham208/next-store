'use server'

import { and, eq, sql } from 'drizzle-orm'
import { updateTag } from 'next/cache'
import { dbQuery, products } from '@/db'
import { hasAdminSession } from '@/features/admin'
import { tagsForProductWrite } from '@/features/products/cache-tags'
import { parseProductEdit } from '@/features/products/schema'
import type { ProductEdit, ProductEditState } from '@/features/products/types'
import { UPDATED_AT_TEXT } from '@/features/products/updated-at-text'

// Every product write lives in features/products (ADR-0003); this is the admin edit of ADR-0019 3A, 13A. The action
// is a public POST and its id is global, so it can be posted to /admin/login where the proxy lets everything through
// (ADR-0018 "Sửa theo audit PR #106" L1): it checks the session itself, first, before reading the form. Its result
// is a ProductEditState, never a row. Nothing here logs the input: only the fixed line below.

const UPDATE_FAILED_LOG = 'products: admin product update failed'

type SaveResult = { status: 'saved'; updatedAt: string } | { status: 'error'; error: 'conflict' | 'not-found' }

// One UPDATE, only if updated_at is still what the form loaded (13A): a save from a stale tab never overwrites a
// newer one. updated_at is set here, not left to $onUpdate or a trigger (ADR-0014, NS-101). Slug, image,
// category and featured are never written.
const save = async (edit: ProductEdit): Promise<SaveResult> => {
  const [row] = await dbQuery({
    name: 'products.admin-update',
    run: (db) =>
      db
        .update(products)
        .set({
          name: edit.name,
          description: edit.description,
          price: edit.price,
          stock: edit.stock,
          updatedAt: sql`now()`,
        })
        .where(and(eq(products.slug, edit.slug), sql`${products.updatedAt} = ${edit.expectedUpdatedAt}::timestamptz`))
        .returning({ updatedAt: UPDATED_AT_TEXT }),
  })
  if (row !== undefined) return { status: 'saved', updatedAt: row.updatedAt }
  // Nothing written: either someone saved since the form loaded, or the slug does not exist.
  const [found] = await dbQuery({
    name: 'products.admin-exists',
    run: (db) => db.select({ id: products.id }).from(products).where(eq(products.slug, edit.slug)).limit(1),
  })
  return found === undefined ? { status: 'error', error: 'not-found' } : { status: 'error', error: 'conflict' }
}

const invalidate = (slug: string): void => {
  for (const tag of tagsForProductWrite({ slug, change: 'fields' })) updateTag(tag)
}

export async function updateProductAction(_previous: ProductEditState, formData: FormData): Promise<ProductEditState> {
  if (!(await hasAdminSession())) return { status: 'error', error: 'unauthorized' }
  const parsed = parseProductEdit(formData)
  if (!parsed.ok) {
    return parsed.formError === undefined
      ? { status: 'invalid', fieldErrors: parsed.fieldErrors }
      : { status: 'invalid', fieldErrors: parsed.fieldErrors, formError: parsed.formError }
  }

  let result: SaveResult
  try {
    result = await save(parsed.value)
  } catch {
    // Failed or timed out: the UPDATE may have committed (ADR-0011), so refresh as if it had (a spare render costs
    // little; a stale price would stay for the cache's `hours`). Never retried: the admin reloads and decides.
    console.error(UPDATE_FAILED_LOG)
    invalidate(parsed.value.slug)
    return { status: 'error', error: 'unavailable' }
  }
  if (result.status === 'saved') invalidate(parsed.value.slug)
  return result
}
