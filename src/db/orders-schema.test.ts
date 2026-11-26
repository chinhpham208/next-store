import { randomUUID } from 'node:crypto'
import type { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { closeConnection, createConnection, type Connection } from '@/db/client'
import { runMigrations } from '@/db/migrate'
import { ORDER_STATUSES, REFUND_REASONS } from '@/db/schema'

// NS-138 (M6 Task 4, ADR-0021 / ADR-0022): the constraints of orders are the last line of defence behind the order
// store, and error_events must work for the DML-only app role without a sequence of its own.
const sqlState = async (run: () => Promise<unknown>): Promise<string | undefined> => {
  try {
    await run()
    return undefined
  } catch (error) {
    return error instanceof Error && 'code' in error && typeof error.code === 'string' ? error.code : 'no code'
  }
}

const ITEMS = JSON.stringify([{ productId: 1, slug: 'a', name: 'A', price: 1500, quantity: 2 }])

describe('orders and error_events (NS-138)', () => {
  let connection: Connection
  let client: PGlite

  beforeAll(async () => {
    connection = createConnection({ kind: 'pglite', dataDir: 'memory://' })
    if (connection.kind !== 'pglite') throw new Error('expected PGlite')
    client = connection.db.$client
    await runMigrations(connection)
  })
  afterAll(async () => closeConnection(connection))

  const insertOrder = (
    fields: { total?: number; status?: string; refundReason?: string | null; paymentRef?: string | null; cartId?: string | null } = {},
  ) =>
    client.query<{ id: number }>(
      `INSERT INTO orders (items, total, status, refund_reason, provider, payment_ref, cart_id)
       VALUES ($1::jsonb, $2, $3, $4, 'fake', $5, $6) RETURNING id`,
      [
        ITEMS,
        fields.total ?? 3000,
        fields.status ?? 'pending',
        fields.refundReason ?? null,
        fields.paymentRef ?? null,
        fields.cartId ?? null,
      ],
    )

  it('exposes the status and refund reason lists the code and the checks share', () => {
    expect(ORDER_STATUSES).toEqual(['pending', 'paid', 'needs_refund', 'cancelled'])
    expect(REFUND_REASONS).toEqual(['out-of-stock', 'amount-mismatch'])
  })

  it('orders rejects a zero or negative total', async () => {
    expect(await sqlState(() => insertOrder({ total: 0 }))).toBe('23514')
    expect(await sqlState(() => insertOrder({ total: -1 }))).toBe('23514')
  })

  it('orders rejects an unknown status', async () => {
    expect(await sqlState(() => insertOrder({ status: 'shipped' }))).toBe('23514')
  })

  it('refund_reason is required with needs_refund and refused otherwise', async () => {
    expect(await sqlState(() => insertOrder({ status: 'needs_refund' }))).toBe('23514')
    expect(await sqlState(() => insertOrder({ status: 'paid', refundReason: 'out-of-stock' }))).toBe('23514')
    expect(await sqlState(() => insertOrder({ status: 'needs_refund', refundReason: 'lost' }))).toBe('23514')
    expect(await sqlState(() => insertOrder({ status: 'needs_refund', refundReason: 'amount-mismatch' }))).toBeUndefined()
    expect(await sqlState(() => insertOrder({ status: 'paid' }))).toBeUndefined()
  })

  it('payment_ref is unique but many orders may have none', async () => {
    await insertOrder()
    await insertOrder()
    await insertOrder({ paymentRef: 'ref-unique' })
    expect(await sqlState(() => insertOrder({ paymentRef: 'ref-unique' }))).toBe('23505')
  })

  it('deleting a cart keeps its orders with cart_id null', async () => {
    const cartId = randomUUID()
    await client.query('INSERT INTO carts (id) VALUES ($1)', [cartId])
    const orderId = (await insertOrder({ cartId })).rows[0]?.id
    await client.query('DELETE FROM carts WHERE id = $1', [cartId])
    const { rows } = await client.query<{ cart_id: string | null }>('SELECT cart_id FROM orders WHERE id = $1', [orderId])
    expect(rows).toEqual([{ cart_id: null }])
  })

  it('items round-trips as jsonb', async () => {
    const orderId = (await insertOrder()).rows[0]?.id
    const { rows } = await client.query<{ items: unknown }>('SELECT items FROM orders WHERE id = $1', [orderId])
    expect(rows[0]?.items).toEqual([{ productId: 1, slug: 'a', name: 'A', price: 1500, quantity: 2 }])
  })

  it('fills status, created_at and updated_at by default', async () => {
    const { rows } = await client.query<{ status: string; ok: boolean }>(
      `INSERT INTO orders (items, total, provider) VALUES ('[]'::jsonb, 1, 'fake')
       RETURNING status, created_at IS NOT NULL AND updated_at IS NOT NULL AS ok`,
    )
    expect(rows).toEqual([{ status: 'pending', ok: true }])
  })

  it('has the list and filter indexes', async () => {
    const { rows } = await client.query<{ indexname: string }>(
      "SELECT indexname FROM pg_indexes WHERE tablename IN ('orders', 'error_events') ORDER BY indexname",
    )
    expect(rows.map((row) => row.indexname)).toEqual(
      expect.arrayContaining(['orders_created_at_idx', 'orders_status_created_at_idx', 'error_events_last_seen_at_idx']),
    )
  })

  it('indexes orders.cart_id, which every cart deletion looks up through ON DELETE SET NULL', async () => {
    const { rows } = await client.query<{ indexdef: string }>(
      "SELECT indexdef FROM pg_indexes WHERE indexname = 'orders_cart_id_idx'",
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]?.indexdef).toMatch(/\(cart_id\)/)
  })

  // Audit PR #122 M1: Postgres reads a bare DESC as DESC NULLS FIRST, so an index written NULLS LAST cannot serve
  // ORDER BY created_at DESC, id DESC.
  it('the list indexes are DESC (NULLS FIRST), never NULLS LAST', async () => {
    const { rows } = await client.query<{ indexname: string; indexdef: string }>(
      "SELECT indexname, indexdef FROM pg_indexes WHERE indexname IN ('orders_created_at_idx', 'orders_status_created_at_idx') ORDER BY indexname",
    )
    expect(rows).toHaveLength(2)
    for (const { indexdef } of rows) expect(indexdef).not.toMatch(/NULLS LAST/)
    // pg_get_indexdef leaves out NULLS FIRST because it is what DESC means.
    expect(rows[0]?.indexdef).toMatch(/\(created_at DESC, id DESC\)/)
    expect(rows[1]?.indexdef).toMatch(/\(status, created_at DESC, id DESC\)/)
  })

  it('ORDER BY created_at DESC, id DESC LIMIT 50 needs no Sort node, with or without a status', async () => {
    await client.exec(
      `INSERT INTO orders (items, total, provider, status, created_at)
       SELECT '[]'::jsonb, 1000, 'fake', (ARRAY['pending', 'paid', 'cancelled'])[1 + g % 3], now() - g * interval '1 minute'
       FROM generate_series(1, 3000) g`,
    )
    await client.exec('ANALYZE orders')
    await client.exec('SET enable_seqscan = off; SET enable_bitmapscan = off')
    try {
      for (const where of ['', "WHERE status = 'paid'"]) {
        const { rows } = await client.query<{ 'QUERY PLAN': string }>(
          `EXPLAIN SELECT id FROM orders ${where} ORDER BY created_at DESC, id DESC LIMIT 50`,
        )
        const plan = rows.map((row) => row['QUERY PLAN']).join('\n')
        expect(plan, where).toMatch(/Index/)
        expect(plan, where).not.toMatch(/Sort/)
      }
    } finally {
      await client.exec('RESET enable_seqscan; RESET enable_bitmapscan')
    }
  })

  it('items must be a JSON array', async () => {
    for (const items of ['{}', '"x"', '1', 'null']) {
      expect(
        await sqlState(() => client.query("INSERT INTO orders (items, total, provider) VALUES ($1::jsonb, 1, 'fake')", [items])),
        items,
      ).toBe('23514')
    }
  })

  it('error_events has no sequence', async () => {
    const { rows } = await client.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM pg_sequences WHERE sequencename LIKE 'error_events%'",
    )
    expect(rows).toEqual([{ n: 0 }])
  })

  it('error_events keeps the digest in its own column and counts from 1', async () => {
    await client.query(
      `INSERT INTO error_events (fingerprint, route_type, route_path, method, digest, error_name)
       VALUES ('f1', 'render', '/app/x', 'GET', 'abc', 'Error')`,
    )
    const { rows } = await client.query<{ digest: string | null; message: string | null; count: number }>(
      "SELECT digest, message, count FROM error_events WHERE fingerprint = 'f1'",
    )
    expect(rows).toEqual([{ digest: 'abc', message: null, count: 1 }])
    expect(await sqlState(() => client.query(
      "INSERT INTO error_events (fingerprint, route_type, route_path, method, error_name) VALUES ('f1', 'render', '/app/x', 'GET', 'Error')",
    ))).toBe('23505')
  })

  it('error_events caps the fields it stores (ADR-0022)', async () => {
    const insert = (fields: { routePath?: string; errorName?: string; digest?: string | null; count?: number }) =>
      client.query(
        `INSERT INTO error_events (fingerprint, route_type, route_path, method, digest, error_name, count)
         VALUES ($1, 'render', $2, 'GET', $3, $4, $5)`,
        [randomUUID(), fields.routePath ?? '/app/x', fields.digest ?? null, fields.errorName ?? 'Error', fields.count ?? 1],
      )
    expect(await sqlState(() => insert({ routePath: '/'.repeat(200) }))).toBeUndefined()
    expect(await sqlState(() => insert({ routePath: '/'.repeat(201) }))).toBe('23514')
    expect(await sqlState(() => insert({ errorName: 'A'.repeat(40) }))).toBeUndefined()
    expect(await sqlState(() => insert({ errorName: 'A'.repeat(41) }))).toBe('23514')
    expect(await sqlState(() => insert({ errorName: 'Type Error' }))).toBe('23514')
    expect(await sqlState(() => insert({ errorName: '' }))).toBe('23514')
    expect(await sqlState(() => insert({ digest: 'a_B-9'.repeat(12) }))).toBeUndefined()
    expect(await sqlState(() => insert({ digest: 'a'.repeat(65) }))).toBe('23514')
    expect(await sqlState(() => insert({ digest: 'ab cd' }))).toBe('23514')
    expect(await sqlState(() => insert({ digest: '' }))).toBe('23514')
    expect(await sqlState(() => insert({ count: 0 }))).toBe('23514')
  })
})
