import { randomUUID } from 'node:crypto'
import type { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { closeConnection, createConnection, type Connection } from '@/db/client'
import { runMigrations } from '@/db/migrate'

// NS-88 (M4 Task 3, ADR-0014 1A): the constraints of carts / cart_items are the last line of defence behind the
// cart actions, and the tables must work for the DML-only app role (ADR-0010), so no sequence.
const sqlState = async (run: () => Promise<unknown>): Promise<string | undefined> => {
  try {
    await run()
    return undefined
  } catch (error) {
    return error instanceof Error && 'code' in error && typeof error.code === 'string' ? error.code : 'no code'
  }
}

describe('carts and cart_items (NS-88)', () => {
  let connection: Connection
  let client: PGlite
  let productId: number

  beforeAll(async () => {
    connection = createConnection({ kind: 'pglite', dataDir: 'memory://' })
    if (connection.kind !== 'pglite') throw new Error('expected PGlite')
    client = connection.db.$client
    await runMigrations(connection)
    const category = await client.query<{ id: number }>(
      "INSERT INTO categories (slug, name) VALUES ('cart-test', 'Cart') RETURNING id",
    )
    const product = await client.query<{ id: number }>(
      "INSERT INTO products (slug, name, description, price, image, category_id, stock) VALUES ('cart-p', 'P', 'd', 1000, '/i.svg', $1, 3) RETURNING id",
      [category.rows[0]?.id],
    )
    productId = product.rows[0]?.id ?? 0
  })
  afterAll(async () => closeConnection(connection))

  const newCart = async () => {
    const id = randomUUID()
    await client.query('INSERT INTO carts (id) VALUES ($1)', [id])
    return id
  }

  it('cart tables have no sequence', async () => {
    const { rows } = await client.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM pg_sequences WHERE sequencename LIKE 'cart%'",
    )
    expect(rows).toEqual([{ n: 0 }])
  })

  it('carts.id has no default: the server generates it', async () => {
    expect(await sqlState(() => client.query('INSERT INTO carts DEFAULT VALUES'))).toBe('23502')
  })

  it('fills created_at and updated_at by default', async () => {
    const id = await newCart()
    const { rows } = await client.query<{ ok: boolean }>(
      'SELECT created_at IS NOT NULL AND updated_at IS NOT NULL AS ok FROM carts WHERE id = $1',
      [id],
    )
    expect(rows).toEqual([{ ok: true }])
  })

  it.each([0, -1])('rejects a quantity of %i', async (quantity) => {
    const cartId = await newCart()
    expect(
      await sqlState(() =>
        client.query('INSERT INTO cart_items (cart_id, product_id, quantity) VALUES ($1, $2, $3)', [
          cartId,
          productId,
          quantity,
        ]),
      ),
    ).toBe('23514')
  })

  it('deleting a cart deletes its lines', async () => {
    const cartId = await newCart()
    await client.query('INSERT INTO cart_items (cart_id, product_id, quantity) VALUES ($1, $2, 2)', [cartId, productId])
    await client.query('DELETE FROM carts WHERE id = $1', [cartId])
    const { rows } = await client.query('SELECT 1 FROM cart_items WHERE cart_id = $1', [cartId])
    expect(rows).toEqual([])
  })

  it('one line per product per cart', async () => {
    const cartId = await newCart()
    const insert = () =>
      client.query('INSERT INTO cart_items (cart_id, product_id, quantity) VALUES ($1, $2, 1)', [cartId, productId])
    await insert()
    expect(await sqlState(insert)).toBe('23505')
  })

  it('refuses a line for a cart or a product that does not exist', async () => {
    const cartId = await newCart()
    expect(
      await sqlState(() =>
        client.query('INSERT INTO cart_items (cart_id, product_id, quantity) VALUES ($1, $2, 1)', [
          randomUUID(),
          productId,
        ]),
      ),
    ).toBe('23503')
    expect(
      await sqlState(() =>
        client.query('INSERT INTO cart_items (cart_id, product_id, quantity) VALUES ($1, -1, 1)', [cartId]),
      ),
    ).toBe('23503')
  })

  it('deleting a product deletes its cart lines', async () => {
    const categoryId = (await client.query<{ id: number }>("SELECT id FROM categories WHERE slug = 'cart-test'")).rows[0]
      ?.id
    const doomed = await client.query<{ id: number }>(
      "INSERT INTO products (slug, name, description, price, image, category_id) VALUES ('cart-doomed', 'D', 'd', 1, '/i.svg', $1) RETURNING id",
      [categoryId],
    )
    const doomedId = doomed.rows[0]?.id
    const cartId = await newCart()
    await client.query('INSERT INTO cart_items (cart_id, product_id, quantity) VALUES ($1, $2, 1)', [cartId, doomedId])
    await client.query('DELETE FROM products WHERE id = $1', [doomedId])
    const { rows } = await client.query('SELECT 1 FROM cart_items WHERE cart_id = $1', [cartId])
    expect(rows).toEqual([])
  })

  it('has the indexes for expiry and the product foreign key', async () => {
    const { rows } = await client.query<{ indexname: string; indexdef: string }>(
      "SELECT indexname, indexdef FROM pg_indexes WHERE tablename IN ('carts', 'cart_items') ORDER BY indexname",
    )
    const byName = Object.fromEntries(rows.map((row) => [row.indexname, row.indexdef]))
    expect(byName['carts_updated_at_idx']).toMatch(/\(updated_at\)/)
    expect(byName['cart_items_product_id_idx']).toMatch(/\(product_id\)/)
    expect(byName['cart_items_cart_id_product_id_pk']).toMatch(/UNIQUE.*\(cart_id, product_id\)/)
  })
})
