import 'server-only'
import { and, eq, gte, inArray, sql } from 'drizzle-orm'
import { products, type DbTx } from '@/db'

// The only stock decrement for orders (plan M6 Task 5, ADR-0019, ADR-0021); every product write lives in
// features/products (ADR-0003). It runs inside the caller's transaction and never touches the cache: the caller
// refreshes the tags of the returned slugs after commit.
//
// Every UPDATE sets updated_at = now(): the admin form carries updated_at (ADR-0019 13A), so a form opened before a
// checkout gets `conflict` instead of saving the old stock over the new one (audit PR #107 L-4).

export type StockLine = { productId: number; quantity: number }

export type StockDecrement = { ok: true; slugs: string[] } | { ok: false; shortProductIds: number[] }

const INVALID_LINES_MESSAGE = 'products: invalid stock lines'
const STOCK_CHANGED_MESSAGE = 'products: stock changed under lock'

// Fixed messages, never the ids or quantities: the caller merges duplicate lines first, so reaching either is a bug.
const assertValidLines = (lines: readonly StockLine[]): void => {
  const ids = new Set(lines.map((line) => line.productId))
  const valid =
    lines.length > 0 &&
    ids.size === lines.length &&
    lines.every((line) => Number.isInteger(line.productId) && Number.isInteger(line.quantity) && line.quantity > 0)
  if (!valid) throw new Error(INVALID_LINES_MESSAGE)
}

/**
 * Locks the product rows (ORDER BY id, so two orders always lock in the same order), then either decrements every
 * line or writes nothing. A line that is short, or whose product no longer exists, makes the whole call
 * `ok: false` with those product ids, before any UPDATE.
 */
export const decrementStockForOrder = async (tx: DbTx, lines: readonly StockLine[]): Promise<StockDecrement> => {
  assertValidLines(lines)
  const locked = await tx
    .select({ id: products.id, slug: products.slug, stock: products.stock })
    .from(products)
    .where(
      inArray(
        products.id,
        lines.map((line) => line.productId),
      ),
    )
    .orderBy(products.id)
    .for('update')

  const byId = new Map(locked.map((row) => [row.id, row]))
  const shortProductIds = lines
    .filter((line) => (byId.get(line.productId)?.stock ?? -1) < line.quantity)
    .map((line) => line.productId)
    .sort((a, b) => a - b)
  if (shortProductIds.length > 0) return { ok: false, shortProductIds }

  for (const { productId, quantity } of [...lines].sort((a, b) => a.productId - b.productId)) {
    const updated = await tx
      .update(products)
      .set({ stock: sql`${products.stock} - ${quantity}`, updatedAt: sql`now()` })
      .where(and(eq(products.id, productId), gte(products.stock, quantity)))
      .returning({ id: products.id })
    // The row is locked, so this cannot happen; if it does, roll the whole transaction back rather than half-sell.
    if (updated.length !== 1) throw new Error(STOCK_CHANGED_MESSAGE)
  }
  return { ok: true, slugs: locked.map((row) => row.slug) }
}
