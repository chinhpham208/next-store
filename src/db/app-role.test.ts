import { readFileSync } from 'node:fs'
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
  can_setval: false,
  can_create_in_public: false,
  can_create_schema: false,
  rolsuper: false,
  rolcreatedb: false,
  rolcreaterole: false,
  rolbypassrls: false,
  rolreplication: false,
  owns_objects: false,
  is_neon_superuser: false,
  member_of_any_role: false,
  default_grants_too_much: false,
  can_dml: true,
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
      expect(await check(client)).toEqual({ ...DML_ONLY, can_dml: false })
      await runMigrations(connection)
      expect(await check(client)).toEqual(DML_ONLY)
      await asApp(client, () => client.exec("INSERT INTO categories (slug, name) VALUES ('x', 'X')"))
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
