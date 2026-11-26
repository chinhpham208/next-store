import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { closeConnection, createConnection, type Connection } from '@/db/client'
import { runMigrations } from '@/db/migrate'

// PGlite runs as the superuser `postgres`, which here plays the migration (owner) role; SET ROLE switches to the app
// role without a password (K14). SET ROLE is checked against the session user, so "the app role cannot SET ROLE to
// the owner" only shows on a real login and is not tested here. Real Postgres 16 with a non-superuser owner is covered by hand (PR description).
const APP_ROLE_SQL = readFileSync('scripts/sql/app-role.sql', 'utf8')
const CHECK_SQL = readFileSync('scripts/sql/app-role-check.sql', 'utf8')

const openDatabase = async () => {
  const connection = createConnection({ kind: 'pglite', dataDir: 'memory://' })
  if (connection.kind !== 'pglite') throw new Error('expected PGlite')
  await connection.db.$client.exec('CREATE ROLE next_store_app NOLOGIN')
  return { connection, client: connection.db.$client }
}

const applyAppRole = async (client: PGlite) => {
  try {
    await client.exec(APP_ROLE_SQL)
  } catch (error) {
    // A failed statement leaves the script's explicit transaction aborted, as it would in the Neon SQL Editor.
    await client.exec('ROLLBACK')
    throw error
  }
}

const check = async (client: PGlite) => {
  const { rows } = await client.query<Record<string, boolean>>(CHECK_SQL)
  expect(rows).toHaveLength(1)
  return rows[0] ?? {}
}

const asApp = async <T,>(client: PGlite, run: () => Promise<T>): Promise<T> => {
  await client.exec('SET ROLE next_store_app')
  try {
    return await run()
  } finally {
    await client.exec('RESET ROLE')
  }
}

const sqlState = async (run: () => Promise<unknown>): Promise<string | undefined> => {
  try {
    await run()
    return undefined
  } catch (error) {
    return error instanceof Error && 'code' in error && typeof error.code === 'string' ? error.code : 'no code'
  }
}

const explicitGrants = async (client: PGlite, table: string) => {
  const { rows } = await client.query<{ privilege_type: string }>(
    `SELECT a.privilege_type FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) a
     WHERE c.oid = $1::regclass AND a.grantee = 'next_store_app'::regrole`,
    [table],
  )
  return rows.map((row) => row.privilege_type)
}

const DML_ONLY = {
  role_missing: false,
  can_truncate: false,
  can_reference: false,
  can_trigger: false,
  can_maintain: false,
  can_setval: false,
  can_create_in_public: false,
  can_create_schema: false,
  has_grant_option: false,
  rolsuper: false,
  rolcreatedb: false,
  rolcreaterole: false,
  rolbypassrls: false,
  rolreplication: false,
  owns_objects: false,
  is_neon_superuser: false,
  member_of_any_role: false,
  default_grants_too_much: false,
  missing_default_privileges: false,
  statement_timeout_not_6s: false,
  role_settings_not_exact: false,
  can_dml: true,
}

// A table created by the runner after the script: what a future migration gets from the default privileges.
const futureTablePrivileges = async (client: PGlite) => {
  await client.exec('CREATE TABLE future_t (id serial PRIMARY KEY)')
  try {
    return (await explicitGrants(client, 'future_t')).sort()
  } finally {
    await client.exec('DROP TABLE future_t')
  }
}

describe('scripts/sql/app-role.sql on a migrated database (NS-60)', () => {
  let connection: Connection
  let client: PGlite

  beforeAll(async () => {
    ;({ connection, client } = await openDatabase())
    await runMigrations(connection)
    await applyAppRole(client)
  })
  afterAll(async () => closeConnection(connection))

  it('lets the app role read and write the catalogue', async () => {
    await asApp(client, async () => {
      const inserted = await client.query<{ id: number }>(
        "INSERT INTO categories (slug, name) VALUES ('app-role', 'Role app') RETURNING id",
      )
      const id = inserted.rows[0]?.id
      expect(id).toBeTypeOf('number')
      await client.query(
        "INSERT INTO products (slug, name, description, price, image, category_id) VALUES ('p', 'P', 'd', 1, '/i.svg', $1)",
        [id],
      )
      await client.query("UPDATE products SET stock = 3 WHERE slug = 'p'")
      expect((await client.query("SELECT stock FROM products WHERE slug = 'p'")).rows).toEqual([{ stock: 3 }])
      await client.query("DELETE FROM products WHERE slug = 'p'")
      await client.query('DELETE FROM categories WHERE id = $1', [id])
    })
  })

  // NS-88 (M4 Task 3): every statement the cart code needs, as the DML-only role; the tables get their grant from
  // the script (and, on a new branch, from the default privileges: see the parent-branch describe below).
  it('cart queries run as a DML-only role', async () => {
    const cartId = '6f1c2a4e-8b3d-4f5a-9c7e-1d2b3a4c5e6f'
    const categoryId = (await client.query<{ id: number }>(
      "INSERT INTO categories (slug, name) VALUES ('cart-role', 'Cart') RETURNING id",
    )).rows[0]?.id
    const productId = (await client.query<{ id: number }>(
      "INSERT INTO products (slug, name, description, price, image, category_id) VALUES ('cart-role', 'C', 'd', 1, '/i.svg', $1) RETURNING id",
      [categoryId],
    )).rows[0]?.id
    try {
      await asApp(client, async () => {
        await client.query('INSERT INTO carts (id) VALUES ($1)', [cartId])
        const upsert = `INSERT INTO cart_items (cart_id, product_id, quantity) VALUES ($1, $2, 1)
          ON CONFLICT (cart_id, product_id) DO UPDATE SET quantity = cart_items.quantity + excluded.quantity`
        await client.query(upsert, [cartId, productId])
        await client.query(upsert, [cartId, productId])
        await client.query('UPDATE carts SET updated_at = now() WHERE id = $1', [cartId])
        expect((await client.query('SELECT id FROM carts WHERE id = $1 FOR UPDATE', [cartId])).rows).toHaveLength(1)
        expect(
          (await client.query('SELECT quantity FROM cart_items WHERE cart_id = $1', [cartId])).rows,
        ).toEqual([{ quantity: 2 }])
        await client.query("DELETE FROM carts WHERE id IN (SELECT id FROM carts WHERE updated_at < now() - interval '30 days' ORDER BY updated_at LIMIT 50)")
        // The eviction of the oldest carts (NS-104): one DELETE with an EXISTS … OFFSET gate, still DML only.
        await client.query(
          'DELETE FROM carts WHERE id IN (SELECT id FROM carts WHERE id <> $1 AND EXISTS (SELECT 1 FROM carts OFFSET 99999 LIMIT 1) ORDER BY updated_at LIMIT 50)',
          [cartId],
        )
        await client.query('DELETE FROM carts WHERE id = $1', [cartId])
        expect((await client.query('SELECT 1 FROM cart_items WHERE cart_id = $1', [cartId])).rows).toEqual([])
        for (const statement of ['TRUNCATE carts', 'TRUNCATE cart_items', 'ALTER TABLE carts ADD COLUMN x int']) {
          expect(await sqlState(() => client.exec(statement)), statement).toBe('42501')
        }
      })
      expect((await explicitGrants(client, 'carts')).sort()).toEqual(['DELETE', 'INSERT', 'SELECT', 'UPDATE'])
      expect((await explicitGrants(client, 'cart_items')).sort()).toEqual(['DELETE', 'INSERT', 'SELECT', 'UPDATE'])
      expect(await check(client)).toEqual(DML_ONLY)
    } finally {
      await client.query('DELETE FROM carts WHERE id = $1', [cartId])
      await client.query('DELETE FROM products WHERE id = $1', [productId])
      await client.query('DELETE FROM categories WHERE id = $1', [categoryId])
    }
  })

  // NS-138 (M6 Task 4): the statements the order store and the error recorder need, as the DML-only role. orders.id is
  // the one serial of the schema (ADR-0021), so the INSERT … RETURNING id proves the role may use its sequence.
  it('orders and error_events queries run as a DML-only role', async () => {
    await asApp(client, async () => {
      const id = (await client.query<{ id: number }>(
        "INSERT INTO orders (items, total, provider) VALUES ('[]'::jsonb, 1000, 'fake') RETURNING id",
      )).rows[0]?.id
      expect(id).toBeTypeOf('number')
      expect((await client.query('SELECT id FROM orders WHERE id = $1 FOR UPDATE', [id])).rows).toHaveLength(1)
      await client.query("UPDATE orders SET payment_ref = 'role-ref', updated_at = now() WHERE id = $1", [id])
      const upsert = `INSERT INTO error_events (fingerprint, route_type, route_path, method, error_name)
        VALUES ('role', 'render', '/app/x', 'GET', 'Error')
        ON CONFLICT (fingerprint) DO UPDATE SET count = error_events.count + 1, last_seen_at = now()`
      await client.query(upsert)
      await client.query(upsert)
      expect((await client.query('SELECT count FROM error_events WHERE fingerprint = $1', ['role'])).rows).toEqual([{ count: 2 }])
      await client.query(
        "DELETE FROM error_events WHERE fingerprint IN (SELECT fingerprint FROM error_events WHERE last_seen_at < now() - interval '30 days' ORDER BY last_seen_at LIMIT 50)",
      )
      await client.query('DELETE FROM error_events WHERE fingerprint = $1', ['role'])
      await client.query('DELETE FROM orders WHERE id = $1', [id])
      for (const statement of ['TRUNCATE orders', 'TRUNCATE error_events', 'ALTER TABLE orders ADD COLUMN x int']) {
        expect(await sqlState(() => client.exec(statement)), statement).toBe('42501')
      }
    })
    expect((await explicitGrants(client, 'orders')).sort()).toEqual(['DELETE', 'INSERT', 'SELECT', 'UPDATE'])
    expect((await explicitGrants(client, 'error_events')).sort()).toEqual(['DELETE', 'INSERT', 'SELECT', 'UPDATE'])
    expect(await check(client)).toEqual(DML_ONLY)
  })

  it.each([
    ['TRUNCATE products'],
    ['DROP TABLE products'],
    ['ALTER TABLE products ADD COLUMN x int'],
    ['CREATE TABLE y (id int)'],
    ['CREATE SCHEMA s'],
    ['CREATE INDEX products_x_idx ON products (name)'],
    ["SELECT setval('products_id_seq', 1)"],
    ['SELECT * FROM drizzle.__drizzle_migrations'],
  ])('refuses %s as the app role with 42501', async (statement) => {
    expect(await asApp(client, () => sqlState(() => client.exec(statement)))).toBe('42501')
  })

  it('covers tables and sequences created after the script ran', async () => {
    await client.exec('CREATE TABLE z (id serial PRIMARY KEY)')
    try {
      await asApp(client, async () => {
        await client.exec('INSERT INTO z DEFAULT VALUES')
        expect((await client.query('SELECT id FROM z')).rows).toEqual([{ id: 1 }])
        expect(await sqlState(() => client.exec('TRUNCATE z'))).toBe('42501')
      })
    } finally {
      await client.exec('DROP TABLE z')
    }
  })

  it('can be run twice', async () => {
    await applyAppRole(client)
    expect(await check(client)).toEqual(DML_ONLY)
  })

  it('the check script reports a DML-only role', async () => {
    expect(await check(client)).toEqual(DML_ONLY)
  })

  it('takes back extra table rights granted by hand', async () => {
    await client.exec('GRANT TRUNCATE, REFERENCES, TRIGGER ON products TO next_store_app')
    await client.exec('GRANT UPDATE ON SEQUENCE products_id_seq TO next_store_app')
    await client.exec('GRANT CREATE ON SCHEMA public TO next_store_app')
    expect(await check(client)).toMatchObject({
      can_truncate: true,
      can_reference: true,
      can_trigger: true,
      can_setval: true,
      can_create_in_public: true,
    })
    await applyAppRole(client)
    expect(await check(client)).toEqual(DML_ONLY)
  })

  it.each([
    ['SUPERUSER', 'ALTER ROLE next_store_app SUPERUSER', 'ALTER ROLE next_store_app NOSUPERUSER', 'rolsuper'],
    ['CREATEDB', 'ALTER ROLE next_store_app CREATEDB', 'ALTER ROLE next_store_app NOCREATEDB', 'rolcreatedb'],
    ['CREATEROLE', 'ALTER ROLE next_store_app CREATEROLE', 'ALTER ROLE next_store_app NOCREATEROLE', 'rolcreaterole'],
    ['BYPASSRLS', 'ALTER ROLE next_store_app BYPASSRLS', 'ALTER ROLE next_store_app NOBYPASSRLS', 'rolbypassrls'],
    ['REPLICATION', 'ALTER ROLE next_store_app REPLICATION', 'ALTER ROLE next_store_app NOREPLICATION', 'rolreplication'],
    [
      'membership of neon_superuser',
      'CREATE ROLE neon_superuser NOLOGIN; GRANT neon_superuser TO next_store_app',
      'DROP ROLE neon_superuser',
      'is_neon_superuser',
    ],
    ['membership of the owner', 'GRANT postgres TO next_store_app', 'REVOKE postgres FROM next_store_app', 'member_of_any_role'],
    [
      'ownership of a table',
      'CREATE TABLE owned (id int); ALTER TABLE owned OWNER TO next_store_app',
      'DROP TABLE owned',
      'owns_objects',
    ],
  ])('stops without granting anything when the role has %s', async (_label, breakIt, repair, column) => {
    await client.exec('REVOKE SELECT ON categories FROM next_store_app')
    await client.exec(breakIt)
    try {
      await expect(applyAppRole(client)).rejects.toThrow(/app-role\.sql: /)
      const report = await check(client)
      expect(report[column]).toBe(true)
      // The grant at the top of the script was rolled back with the rest (read from the ACL: a superuser or a
      // member of the owner passes has_table_privilege anyway).
      expect(await explicitGrants(client, 'categories')).not.toContain('SELECT')
    } finally {
      await client.exec(repair)
      await applyAppRole(client)
    }
    expect(await check(client)).toEqual(DML_ONLY)
  })

  it('sets a statement timeout just above the dbQuery limit and restores it when changed by hand', async () => {
    const { rows } = await client.query<{ setconfig: string[] }>(
      "SELECT setconfig FROM pg_db_role_setting WHERE setrole = 'next_store_app'::regrole AND setdatabase = 0",
    )
    expect(rows).toEqual([{ setconfig: ['statement_timeout=6s'] }])
    await client.exec("ALTER ROLE next_store_app SET statement_timeout = '0'")
    expect(await check(client)).toMatchObject({ statement_timeout_not_6s: true })
    await applyAppRole(client)
    expect(await check(client)).toEqual(DML_ONLY)
  })

  // Audit PR #39 L-A (NS-74): a per-database setting of the role outranks the role-wide one, and the app role may
  // set both on itself.
  it('reports and removes a per-database setting the app role made on itself', async () => {
    const db = (await client.query<{ db: string }>('SELECT current_database() AS db')).rows[0]?.db ?? ''
    await asApp(client, () => client.exec(`ALTER ROLE next_store_app IN DATABASE "${db}" SET statement_timeout = 0`))
    expect(await check(client)).toMatchObject({ statement_timeout_not_6s: false, role_settings_not_exact: true })
    await applyAppRole(client)
    expect(await check(client)).toEqual(DML_ONLY)
    const { rows } = await client.query(
      "SELECT setdatabase FROM pg_db_role_setting WHERE setrole = 'next_store_app'::regrole AND setdatabase <> 0",
    )
    expect(rows).toEqual([])
  })

  // Audit PR #43 L-1 (NS-75): pg_db_role_setting is shared by the cluster, so a setting the app role made for another
  // database must go too, not only the one of current_database(). PGlite ships template1 as that other database.
  it('reports and removes a setting the app role made for another database', async () => {
    await asApp(client, () => client.exec('ALTER ROLE next_store_app IN DATABASE template1 SET statement_timeout = 0'))
    const otherDatabaseSettings = async () =>
      (
        await client.query<{ datname: string; setconfig: string[] }>(
          `SELECT d.datname, s.setconfig FROM pg_db_role_setting s JOIN pg_database d ON d.oid = s.setdatabase
           WHERE s.setrole = 'next_store_app'::regrole AND d.datname <> current_database()`,
        )
      ).rows
    try {
      expect(await otherDatabaseSettings()).toEqual([{ datname: 'template1', setconfig: ['statement_timeout=0'] }])
      expect(await check(client)).toMatchObject({ statement_timeout_not_6s: false, role_settings_not_exact: true })
      await applyAppRole(client)
      expect(await otherDatabaseSettings()).toEqual([])
      expect(await check(client)).toEqual(DML_ONLY)
    } finally {
      // Left behind on failure, the row would make every later check in this file report role_settings_not_exact.
      await client.exec('ALTER ROLE next_store_app IN DATABASE template1 RESET ALL')
    }
  })

  it('reports and removes another role-wide setting the app role made on itself', async () => {
    await asApp(client, () => client.exec('ALTER ROLE next_store_app SET search_path = pg_temp, public'))
    expect(await check(client)).toMatchObject({ statement_timeout_not_6s: false, role_settings_not_exact: true })
    await applyAppRole(client)
    expect(await check(client)).toEqual(DML_ONLY)
  })

  // Audit PR #39 L2: grant options, MAINTAIN (Postgres 17+; PGlite is 18) and global default privileges.
  it('removes grant options and MAINTAIN that were granted by hand', async () => {
    await client.exec('GRANT SELECT ON products TO next_store_app WITH GRANT OPTION')
    await client.exec('GRANT MAINTAIN ON products TO next_store_app')
    await client.exec('GRANT USAGE ON SCHEMA public TO next_store_app WITH GRANT OPTION')
    expect(await check(client)).toMatchObject({ has_grant_option: true, can_maintain: true })
    await applyAppRole(client)
    expect(await check(client)).toEqual(DML_ONLY)
    expect((await explicitGrants(client, 'products')).sort()).toEqual(['DELETE', 'INSERT', 'SELECT', 'UPDATE'])
  })
  it('reports and removes global default privileges of the runner', async () => {
    await client.exec('ALTER DEFAULT PRIVILEGES GRANT ALL ON TABLES TO next_store_app')
    expect(await check(client)).toMatchObject({ default_grants_too_much: true })
    expect(await futureTablePrivileges(client)).toContain('TRUNCATE')
    await applyAppRole(client)
    expect(await check(client)).toEqual(DML_ONLY)
    expect(await futureTablePrivileges(client)).toEqual(['DELETE', 'INSERT', 'SELECT', 'UPDATE'])
  })
  it('reports default privileges granted with grant option', async () => {
    await client.exec('ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO next_store_app WITH GRANT OPTION')
    expect(await check(client)).toMatchObject({ has_grant_option: true })
    await applyAppRole(client)
    expect(await check(client)).toEqual(DML_ONLY)
  })

  // Audit PR #39 L1: rights through PUBLIC survive every REVOKE … FROM next_store_app.
  it.each([
    ['CREATE on schema public', 'GRANT CREATE ON SCHEMA public TO PUBLIC', 'REVOKE CREATE ON SCHEMA public FROM PUBLIC', /CREATE trên schema public/],
    ['CREATE on the database', 'GRANT CREATE ON DATABASE {db} TO PUBLIC', 'REVOKE CREATE ON DATABASE {db} FROM PUBLIC', /CREATE trên database/],
    ['TRUNCATE on a table', 'GRANT TRUNCATE ON products TO PUBLIC', 'REVOKE TRUNCATE ON products FROM PUBLIC', /TRUNCATE/],
    ['MAINTAIN on a table', 'GRANT MAINTAIN ON products TO PUBLIC', 'REVOKE MAINTAIN ON products FROM PUBLIC', /MAINTAIN/],
    ['UPDATE on a sequence', 'GRANT UPDATE ON SEQUENCE products_id_seq TO PUBLIC', 'REVOKE UPDATE ON SEQUENCE products_id_seq FROM PUBLIC', /sequence/],
  ])('stops when the app role still has %s through PUBLIC', async (_label, grant, revoke, message) => {
    const db = (await client.query<{ db: string }>('SELECT current_database() AS db')).rows[0]?.db ?? ''
    const named = (statement: string) => statement.replace('{db}', `"${db}"`)
    await client.exec(named(grant))
    try {
      await expect(applyAppRole(client)).rejects.toThrow(message)
    } finally {
      await client.exec(named(revoke))
    }
    await applyAppRole(client)
    expect(await check(client)).toEqual(DML_ONLY)
  })

  // Audit PR #39 L4: objects of an extension are owned by whoever installed it, not by the migration role.
  it('ignores objects that belong to an extension when checking ownership', async () => {
    await client.exec(`
      CREATE ROLE ext_owner NOLOGIN;
      CREATE TABLE ext_t (id int);
      ALTER TABLE ext_t OWNER TO ext_owner;
      ALTER EXTENSION plpgsql ADD TABLE ext_t;
    `)
    try {
      await applyAppRole(client)
      expect(await check(client)).toEqual(DML_ONLY)
    } finally {
      await client.exec('ALTER EXTENSION plpgsql DROP TABLE ext_t; DROP TABLE ext_t; DROP ROLE ext_owner')
    }
  })
  it('names the object that belongs to another role', async () => {
    await client.exec('CREATE ROLE other_owner NOLOGIN; CREATE TABLE foreign_t (id int); ALTER TABLE foreign_t OWNER TO other_owner')
    try {
      await expect(applyAppRole(client)).rejects.toThrow(/public\.foreign_t không thuộc role đang chạy/)
    } finally {
      await client.exec('DROP TABLE foreign_t; DROP ROLE other_owner')
    }
  })

  it('refuses to run as a role other than the one db:migrate uses', async () => {
    await client.exec('CREATE ROLE other_role NOLOGIN; GRANT ALL ON SCHEMA public TO other_role')
    await client.exec('SET ROLE other_role')
    try {
      await expect(applyAppRole(client)).rejects.toThrow(/db:migrate/)
    } finally {
      await client.exec('RESET ROLE')
      await client.exec('REVOKE ALL ON SCHEMA public FROM other_role; DROP ROLE other_role')
    }
  })

  it('refuses to run before the role exists', async () => {
    const fresh = createConnection({ kind: 'pglite', dataDir: 'memory://' })
    if (fresh.kind !== 'pglite') throw new Error('expected PGlite')
    try {
      await expect(applyAppRole(fresh.db.$client)).rejects.toThrow(/chưa tồn tại/)
      expect(await check(fresh.db.$client)).toMatchObject({ role_missing: true, can_dml: false })
    } finally {
      await closeConnection(fresh)
    }
  })
})

// ADR-0010 audit M3: the parent branch of resource 2 holds only the role and default privileges, no tables; every
// preview branch forks it and migrates from scratch as the owner.
describe('scripts/sql/app-role.sql on a parent branch without tables (NS-60)', () => {
  it('grants the tables a later migration creates', async () => {
    const { connection, client } = await openDatabase()
    try {
      await applyAppRole(client)
      // Every column false, can_dml included (no tables yet); missing_default_privileges false is what matters here.
      expect(await check(client)).toEqual({ ...DML_ONLY, can_dml: false })
      expect(Object.values(await check(client)).every((value) => value === false)).toBe(true)
      await runMigrations(connection)
      expect(await check(client)).toEqual(DML_ONLY)
      await asApp(client, () => client.exec("INSERT INTO categories (slug, name) VALUES ('x', 'X')"))
      // The cart tables (NS-88) get DML from the default privileges alone, as on a new preview branch.
      expect((await explicitGrants(client, 'carts')).sort()).toEqual(['DELETE', 'INSERT', 'SELECT', 'UPDATE'])
      expect((await explicitGrants(client, 'cart_items')).sort()).toEqual(['DELETE', 'INSERT', 'SELECT', 'UPDATE'])
      await asApp(client, () => client.exec("INSERT INTO carts (id) VALUES ('6f1c2a4e-8b3d-4f5a-9c7e-1d2b3a4c5e6f')"))
      // The failed-login table of M5 (NS-120) likewise, with no GRANT in its migration.
      expect((await explicitGrants(client, 'admin_login_failures')).sort()).toEqual(['DELETE', 'INSERT', 'SELECT', 'UPDATE'])
      await asApp(client, () =>
        client.exec("INSERT INTO admin_login_failures (id, ip_hash) VALUES ('0b6f7c1e-2d3a-4b5c-8d9e-0f1a2b3c4d5e', 'h')"),
      )
    } finally {
      await closeConnection(connection)
    }
  })
})

// Audit PR #39 L3: without tables the database owner check is the only guard against the wrong runner.
describe('scripts/sql/app-role.sql run by the wrong role on a database without tables (NS-60)', () => {
  it('refuses with the database owner message', async () => {
    const { connection, client } = await openDatabase()
    try {
      await client.exec('CREATE ROLE other_runner NOLOGIN; GRANT CREATE, USAGE ON SCHEMA public TO other_runner')
      await client.exec('SET ROLE other_runner')
      try {
        await expect(applyAppRole(client)).rejects.toThrow(/không phải chủ database/)
      } finally {
        await client.exec('RESET ROLE')
      }
      expect(await check(client)).toMatchObject({
        missing_default_privileges: true,
        statement_timeout_not_6s: true,
        role_settings_not_exact: true,
      })
    } finally {
      await closeConnection(connection)
    }
  })
})

describe('the SQL scripts carry no secrets', () => {
  it('contains no password and creates no role', () => {
    for (const script of [APP_ROLE_SQL, CHECK_SQL]) {
      expect(script).not.toMatch(/PASSWORD|CREATE\s+ROLE|CREATE\s+USER/i)
    }
  })
  it('the check script only reads', () => {
    expect(CHECK_SQL.replace(/--[^\n]*/g, '')).not.toMatch(/\b(?:GRANT|REVOKE|ALTER|CREATE|DROP|INSERT|UPDATE|DELETE)\b\s/)
  })
})

// Audit PR #122 L2: on Neon the order is the reverse of the describe above. app-role.sql already ran when a migration
// creates a table and its sequence, so their rights come from ALTER DEFAULT PRIVILEGES alone. orders_id_seq is the
// first sequence to travel that way.
describe('a table with a serial created after app-role.sql ran (NS-138)', () => {
  const copyMigrations = (upTo: number) => {
    const folder = mkdtempSync(join(tmpdir(), 'ns138-migrations-'))
    cpSync('drizzle', folder, { recursive: true })
    const journalPath = join(folder, 'meta', '_journal.json')
    const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as { entries: { idx: number }[] }
    journal.entries = journal.entries.filter((entry) => entry.idx <= upTo)
    writeFileSync(journalPath, JSON.stringify(journal))
    return folder
  }

  it('lets the app role insert into orders through the default privileges on its sequence', async () => {
    const { connection, client } = await openDatabase()
    const before = copyMigrations(3)
    try {
      await runMigrations(connection, before)
      await applyAppRole(client)
      expect((await client.query("SELECT to_regclass('orders') AS t")).rows).toEqual([{ t: null }])
      await runMigrations(connection)
      await asApp(client, async () => {
        const first = await client.query<{ id: number }>(
          "INSERT INTO orders (items, total, provider) VALUES ('[]'::jsonb, 1000, 'fake') RETURNING id",
        )
        expect(first.rows[0]?.id).toBeTypeOf('number')
        await client.query("INSERT INTO error_events (fingerprint, route_type, route_path, method, error_name) VALUES ('a', 'render', '/x', 'GET', 'Error')")
      })
      expect((await explicitGrants(client, 'orders_id_seq')).sort()).toEqual(['SELECT', 'USAGE'])
      expect(await check(client)).toEqual(DML_ONLY)
    } finally {
      rmSync(before, { recursive: true, force: true })
      await closeConnection(connection)
    }
  })
})
