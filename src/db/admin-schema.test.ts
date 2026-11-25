import { randomUUID } from 'node:crypto'
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { closeConnection, createConnection, type Connection } from '@/db/client'
import { runMigrations } from '@/db/migrate'

// NS-120 (M5 Task 5, ADR-0018): the failed-login limit of the admin area writes this table on every wrong password,
// as the DML-only app role (ADR-0010), so the table has no sequence and the server generates the id.
const APP_ROLE_SQL = readFileSync('scripts/sql/app-role.sql', 'utf8')
const CHECK_SQL = readFileSync('scripts/sql/app-role-check.sql', 'utf8')

const sqlState = async (run: () => Promise<unknown>): Promise<string | undefined> => {
  try {
    await run()
    return undefined
  } catch (error) {
    return error instanceof Error && 'code' in error && typeof error.code === 'string' ? error.code : 'no code'
  }
}

describe('admin_login_failures (NS-120)', () => {
  let connection: Connection
  let client: PGlite

  beforeAll(async () => {
    connection = createConnection({ kind: 'pglite', dataDir: 'memory://' })
    if (connection.kind !== 'pglite') throw new Error('expected PGlite')
    client = connection.db.$client
    await client.exec('CREATE ROLE next_store_app NOLOGIN')
    await runMigrations(connection)
    await client.exec(APP_ROLE_SQL)
  })
  afterAll(async () => closeConnection(connection))

  const asApp = async <T,>(run: () => Promise<T>): Promise<T> => {
    await client.exec('SET ROLE next_store_app')
    try {
      return await run()
    } finally {
      await client.exec('RESET ROLE')
    }
  }

  it('admin_login_failures has no sequence', async () => {
    const { rows } = await client.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM pg_depend d JOIN pg_class s ON s.oid = d.objid
       WHERE s.relkind = 'S' AND d.refobjid = 'admin_login_failures'::regclass`,
    )
    expect(rows).toEqual([{ n: 0 }])
    const { rows: columns } = await client.query<{ column_name: string; column_default: string | null }>(
      `SELECT column_name, column_default FROM information_schema.columns
       WHERE table_name = 'admin_login_failures' ORDER BY ordinal_position`,
    )
    expect(columns).toEqual([
      { column_name: 'id', column_default: null },
      { column_name: 'ip_hash', column_default: null },
      { column_name: 'failed_at', column_default: 'now()' },
    ])
  })

  it('id has no default: the server generates it', async () => {
    expect(
      await sqlState(() => client.query("INSERT INTO admin_login_failures (ip_hash) VALUES ('h')")),
    ).toBe('23502')
  })

  it('has the indexes for the per-IP window and the purge by age', async () => {
    const { rows } = await client.query<{ indexname: string; indexdef: string }>(
      "SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'admin_login_failures' ORDER BY indexname",
    )
    const byName = Object.fromEntries(rows.map((row) => [row.indexname, row.indexdef]))
    expect(byName['admin_login_failures_ip_failed_at_idx']).toMatch(/\(ip_hash, failed_at\)/)
    expect(byName['admin_login_failures_failed_at_idx']).toMatch(/\(failed_at\)/)
    expect(byName['admin_login_failures_pkey']).toMatch(/UNIQUE.*\(id\)/)
  })

  // The statements of the failed-login limit (plan M5 Task 7): record, count in the window, purge old rows.
  it('admin queries run as a DML-only role', async () => {
    const ipHash = 'a'.repeat(64)
    await asApp(async () => {
      await client.query('INSERT INTO admin_login_failures (id, ip_hash) VALUES ($1, $2)', [randomUUID(), ipHash])
      await client.query(
        "INSERT INTO admin_login_failures (id, ip_hash, failed_at) VALUES ($1, $2, now() - interval '2 days')",
        [randomUUID(), ipHash],
      )
      const { rows } = await client.query<{ per_ip: number; global: number }>(
        `SELECT count(*) FILTER (WHERE ip_hash = $1)::int AS per_ip, count(*)::int AS global
         FROM admin_login_failures WHERE failed_at > now() - interval '15 minutes'`,
        [ipHash],
      )
      expect(rows).toEqual([{ per_ip: 1, global: 1 }])
      await client.query(
        `DELETE FROM admin_login_failures WHERE id IN (
           SELECT id FROM admin_login_failures WHERE failed_at < now() - interval '24 hours' ORDER BY failed_at LIMIT 100)`,
      )
      expect((await client.query('SELECT 1 FROM admin_login_failures')).rows).toHaveLength(1)
      await client.query('DELETE FROM admin_login_failures WHERE ip_hash = $1', [ipHash])
      for (const statement of ['TRUNCATE admin_login_failures', 'ALTER TABLE admin_login_failures ADD COLUMN x int']) {
        expect(await sqlState(() => client.exec(statement)), statement).toBe('42501')
      }
    })
    const { rows } = await client.query<{ can_dml: boolean; can_truncate: boolean }>(CHECK_SQL)
    expect(rows[0]).toMatchObject({ can_dml: true, can_truncate: false })
  })
})

// NS-120 (ADR-0019 11A): rows that exist before 0002 get the migration's now() as created_at, which is later than
// their real creation; 0003 moves it back to updated_at (the creation time while nothing edits products).
describe('products.created_at backfill (NS-120)', () => {
  const backfillFile = readdirSync('drizzle').find((file) => /^0003_.*\.sql$/.test(file))
  if (backfillFile === undefined) throw new Error('drizzle/0003_*.sql not found')
  const BACKFILL_SQL = readFileSync(join('drizzle', backfillFile), 'utf8')
  // The migrations folder as it was at M4 (0000, 0001): what Production holds before this release.
  const m4Folder = () => {
    const folder = mkdtempSync(join(tmpdir(), 'ns120-migrations-'))
    cpSync('drizzle', folder, { recursive: true })
    const journalPath = join(folder, 'meta', '_journal.json')
    const journal: { entries: { idx: number }[] } = JSON.parse(readFileSync(journalPath, 'utf8'))
    writeFileSync(journalPath, JSON.stringify({ ...journal, entries: journal.entries.filter((entry) => entry.idx < 2) }))
    return folder
  }

  it('sets created_at to updated_at on rows created before the migration, and can run again', async () => {
    const folder = m4Folder()
    const target = createConnection({ kind: 'pglite', dataDir: 'memory://' })
    if (target.kind !== 'pglite') throw new Error('expected PGlite')
    const client = target.db.$client
    try {
      await runMigrations(target, folder)
      const category = await client.query<{ id: number }>(
        "INSERT INTO categories (slug, name) VALUES ('backfill', 'B') RETURNING id",
      )
      await client.query(
        `INSERT INTO products (slug, name, description, price, image, category_id, updated_at)
         VALUES ('old', 'O', 'd', 1, '/i.svg', $1, '2026-11-01T00:00:00Z')`,
        [category.rows[0]?.id],
      )
      await runMigrations(target)
      const createdAt = async () =>
        (
          await client.query<{ slug: string; same: boolean }>(
            'SELECT slug, created_at = updated_at AS same FROM products ORDER BY id',
          )
        ).rows
      expect(await createdAt()).toEqual([{ slug: 'old', same: true }])
      // Old code (M4) inserts without created_at and keeps working; the row gets the default.
      await client.query(
        `INSERT INTO products (slug, name, description, price, image, category_id)
         VALUES ('new', 'N', 'd', 1, '/i.svg', $1)`,
        [category.rows[0]?.id],
      )
      await client.exec(BACKFILL_SQL)
      expect(await createdAt()).toEqual([
        { slug: 'old', same: true },
        { slug: 'new', same: true },
      ])
      const { rows } = await client.query<{ created_at: Date }>("SELECT created_at FROM products WHERE slug = 'old'")
      expect(rows[0]?.created_at.toISOString()).toBe('2026-11-01T00:00:00.000Z')
    } finally {
      await closeConnection(target)
      rmSync(folder, { recursive: true, force: true })
    }
  })
})
