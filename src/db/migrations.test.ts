import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { it, expect } from 'vitest'

// Contract statements remove or change something that release N-1 code may still read or write (conventions §10).
// Patterns use [\s\S] where a statement spans lines, so multi-line ALTER TABLE statements are still caught.
// DROP is not listed here: every DROP is contract unless DROP_ALLOWLIST says otherwise (audit PR #46 M2).
const CONTRACT_PATTERNS: RegExp[] = [
  /\bALTER\s+TABLE\b[\s\S]*?\bALTER\s+(?:COLUMN\s+)?\S+\s+(?:SET\s+DATA\s+)?TYPE\b/i,
  /\bSET\s+NOT\s+NULL\b/i,
  /\bRENAME\b/i,
  /\bTRUNCATE\b/i,
  /\bSET\s+SCHEMA\b/i,
  /\bREVOKE\b/i,
  // MERGE can delete or update every row it matches, or every row the source lacks (`NOT MATCHED BY SOURCE`).
  /\bMERGE\b[\s\S]*?\bTHEN\s+(?:DELETE|UPDATE)\b/i,
]

// The only DROPs that are expand, read right after the DROP keyword. Keep the list narrow: an entry belongs here
// only when release N-1 code cannot notice the change.
// - `NOT NULL` (`ALTER COLUMN … DROP NOT NULL`, `ALTER DOMAIN … DROP NOT NULL`): loosens a constraint, so every
//   read and write that worked before still works.
// Deliberately not allowlisted, because N-1 code that INSERTs without naming the column relied on what is dropped:
// `DROP DEFAULT`, `DROP IDENTITY` and `DROP EXPRESSION` (the column then gets NULL, or the INSERT fails on NOT NULL).
const DROP_ALLOWLIST: RegExp[] = [/^\s*NOT\s+NULL\b/i]

const hasContractDrop = (statement: string) =>
  [...statement.matchAll(/\bDROP\b/gi)].some(
    (match) => !DROP_ALLOWLIST.some((allowed) => allowed.test(statement.slice(match.index + match[0].length))),
  )

// `EXECUTE FUNCTION` / `PROCEDURE` is the action of a trigger and runs no SQL of its own. Anywhere else EXECUTE runs
// dynamic SQL, built at run time and unreadable here, even when the variable is named `function` (audit PR #46 L3).
const TRIGGER_STATEMENT = /\bCREATE\s+(?:OR\s+REPLACE\s+)?(?:CONSTRAINT\s+|EVENT\s+)?TRIGGER\b/i

const hasDynamicSql = (statement: string) =>
  [...statement.matchAll(/\bEXECUTE\b/gi)].some(
    (match) =>
      !(
        /^\s+(?:FUNCTION|PROCEDURE)\b/i.test(statement.slice(match.index + match[0].length)) &&
        TRIGGER_STATEMENT.test(statement.slice(0, match.index))
      ),
  )

// The keyword that starts a DELETE or UPDATE statement, wherever it sits (CTE, DO block, `CREATE RULE … DO [ALSO |
// INSTEAD] UPDATE`). `ON UPDATE` (foreign key), `ON CONFLICT … DO UPDATE` (upsert), `FOR UPDATE` (row lock),
// trigger events and privilege lists are not statements.
const ROW_WRITE =
  /\bDELETE\s+FROM\b|(?<!(?:\b(?:ON|FOR|OR|BEFORE|AFTER|GRANT)|,|\bCONFLICT\b[\s\S]*\bDO)\s*)\bUPDATE\b(?=[\s\S]*?\bSET\b)/gi

// A WHERE that keeps every row (`WHERE true`, `WHERE 1 = 1`) limits nothing (audit PR #46 L2).
const ALWAYS_TRUE_WHERE = /^WHERE\s+(?:TRUE|1\s*=\s*1)\b(?!\s*AND\b)/i

// True when a limiting WHERE appears after `start` at the same parenthesis depth, before the group around `start`
// closes. A WHERE inside a subquery belongs to that subquery and does not limit the outer statement.
const hasOwnWhere = (statement: string, start: number) => {
  let depth = 0
  for (let index = start; index < statement.length; index++) {
    const char = statement[index]
    if (char === '(') depth++
    else if (char === ')') {
      if (depth === 0) return false
      depth--
    } else if (depth === 0 && /^WHERE\b/i.test(statement.slice(index, index + 6)) && !/\w/.test(statement[index - 1] ?? '')) {
      return !ALWAYS_TRUE_WHERE.test(statement.slice(index))
    }
  }
  return false
}

const hasRowWriteWithoutWhere = (statement: string) =>
  [...statement.matchAll(ROW_WRITE)].some((match) => !hasOwnWhere(statement, match.index + match[0].length))

// Splits on commas outside parentheses, so `ADD COLUMN a int NOT NULL, ADD COLUMN b int DEFAULT 1` is two actions.
const splitTopLevel = (statement: string) => {
  const parts: string[] = []
  let depth = 0
  let from = 0
  for (let index = 0; index < statement.length; index++) {
    const char = statement[index]
    if (char === '(') depth++
    else if (char === ')') depth--
    else if (char === ',' && depth === 0) {
      parts.push(statement.slice(from, index))
      from = index + 1
    }
  }
  return [...parts, statement.slice(from)]
}

// `ADD [COLUMN] [IF NOT EXISTS] <name> <type> <constraints>`. Table constraints (`ADD CONSTRAINT`, `ADD CHECK`, ...)
// are not columns and are excluded.
const ADD_COLUMN =
  /\bADD\s+(?!(?:CONSTRAINT|CHECK|UNIQUE|PRIMARY|FOREIGN|EXCLUDE)\b)(?:COLUMN\s+)?(?:IF\s+NOT\s+EXISTS\s+)?\S+\s+(\S+)([\s\S]*)/i

// Existing rows get a value from a DEFAULT other than NULL (`ON DELETE SET DEFAULT` is a foreign key action, not a
// default), from a generated column, or from a serial type, which must be the token right after the column name
// (audit PR #46 L1: a column named `serial` or `generated` gives no value).
const givesExistingRowsValue = (type: string, rest: string) =>
  /^(?:big|small)?serial\d?$/i.test(type) ||
  /(?<!\bSET\s+)\bDEFAULT\s+(?!NULL\b)/i.test(rest) ||
  /\bGENERATED\s+(?:ALWAYS|BY\s+DEFAULT)\b/i.test(rest)

// ADD COLUMN NOT NULL (or PRIMARY KEY, which implies it) is safe only when existing rows get a value. Each ALTER
// TABLE action is checked on its own, so one column's DEFAULT does not cover another.
const isUnsafeAddNotNull = (statement: string) =>
  /\bALTER\s+TABLE\b/i.test(statement) &&
  splitTopLevel(statement).some((action) => {
    const column = ADD_COLUMN.exec(action)
    if (!column) return false
    const [, type = '', rest = ''] = column
    return /\b(?:NOT\s+NULL|PRIMARY\s+KEY)\b/i.test(rest) && !givesExistingRowsValue(type, rest)
  })

const isContractStatement = (statement: string) =>
  CONTRACT_PATTERNS.some((pattern) => pattern.test(statement)) ||
  hasContractDrop(statement) ||
  hasDynamicSql(statement) ||
  hasRowWriteWithoutWhere(statement) ||
  isUnsafeAddNotNull(statement)

// Reads SQL the way Postgres tokenizes it, so a keyword, `;` or `--` inside a literal is not code:
// - string literals become `''` and quoted names become `"_"` (`E'…'` strings honour backslash escapes);
// - comments become a space, and block comments nest as in Postgres, so `DROP /* x */ TABLE` is still one statement;
// - a dollar-quoted body ends at its own closing tag, whatever it holds. It is read twice (audit PR #46 M1): as code,
//   because DO blocks and function bodies hold statements, and as a plain string. When it does not read as code
//   (`$$customer's table$$`, an opener of a string or comment that never closes inside the tags) it is a string and
//   becomes `''`. Otherwise its statements are checked, so a plain string such as `$$TRUNCATE$$` is flagged too.
// A string, quoted name, block comment or dollar quote still open at the end of the input is reported in
// `unterminated`: Postgres would reject the file, and what follows the opener cannot be read.
type ReadSql = { text: string; unterminated?: string }

const DOLLAR_TAG = /\$(?:[A-Za-z_]\w*)?\$/y

const readSql = (sql: string): ReadSql => {
  let out = ''
  let index = 0
  while (index < sql.length) {
    DOLLAR_TAG.lastIndex = index
    // A `$` right after a name character continues the name (`a$b$`), as in Postgres.
    const dollarTag = /[\w$]/.test(sql[index - 1] ?? '') ? null : DOLLAR_TAG.exec(sql)
    if (sql.startsWith('--', index)) {
      const end = sql.indexOf('\n', index)
      index = end === -1 ? sql.length : end
    } else if (sql.startsWith('/*', index)) {
      let depth = 0
      do {
        if (sql.startsWith('/*', index)) {
          depth++
          index += 2
        } else if (sql.startsWith('*/', index)) {
          depth--
          index += 2
        } else index++
      } while (depth > 0 && index < sql.length)
      if (depth > 0) return { text: out, unterminated: 'block comment' }
      out += ' '
    } else if (sql[index] === "'" || sql[index] === '"') {
      const quote = sql[index]
      const backslashEscapes = quote === "'" && /[Ee]/.test(sql[index - 1] ?? '') && !/\w/.test(sql[index - 2] ?? '')
      index++
      while (index < sql.length) {
        if (backslashEscapes && sql[index] === '\\') index += 2
        else if (sql[index] === quote && sql[index + 1] === quote) index += 2
        else if (sql[index] === quote) break
        else index++
      }
      if (index >= sql.length) return { text: out, unterminated: quote === "'" ? 'string' : 'quoted name' }
      index++
      out += quote === "'" ? "''" : '"_"'
    } else if (dollarTag) {
      const tag = dollarTag[0]
      const close = sql.indexOf(tag, index + tag.length)
      if (close === -1) return { text: out, unterminated: 'dollar quote' }
      const body = readSql(sql.slice(index + tag.length, close))
      out += body.unterminated ? " '' " : ` ${body.text} `
      index = close + tag.length
    } else {
      out += sql[index]
      index++
    }
  }
  return { text: out }
}

const findContractStatements = (sql: string): string[] => {
  const { text, unterminated } = readSql(sql)
  const statements = text
    .split(';')
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0 && isContractStatement(statement))
  return unterminated ? [...statements, `unterminated ${unterminated}`] : statements
}

const readMigrations = () =>
  readdirSync('drizzle', { recursive: true, encoding: 'utf8' })
    .filter((name) => name.endsWith('.sql'))
    .map((file) => ({ file, sql: readFileSync(join('drizzle', file), 'utf8') }))

it.each([
  ['ALTER TABLE "products" DROP COLUMN "image";', 1],
  ['alter table products rename column name to title;', 1],
  ['ALTER TABLE orders ALTER COLUMN total TYPE bigint;', 1],
  ['ALTER TABLE orders ALTER COLUMN total\n  TYPE bigint;', 1],
  ['ALTER TABLE orders ALTER total TYPE bigint;', 1],
  ['ALTER TABLE products DROP image;', 1],
  ['ALTER TABLE products\n  DROP COLUMN image;', 1],
  ['ALTER TABLE products ALTER COLUMN price DROP DEFAULT;', 1],
  ['TRUNCATE carts;', 1],
  ['DELETE FROM carts;', 1],
  ['DELETE FROM carts WHERE created_at < now() - interval \'30 days\';', 0],
  ['-- DROP TABLE old;\nCREATE TABLE "carts" ("id" uuid PRIMARY KEY);', 0],
  ['ALTER TABLE "products" ADD COLUMN "sku" text;', 0],
])('counts contract statements in %j', (sql, count) => {
  expect(findContractStatements(sql)).toHaveLength(count)
})

it.each([
  ['ALTER TABLE "products" ADD COLUMN "sku" text NOT NULL;', 1],
  ['ALTER TABLE "products" ADD "sku" text NOT NULL;', 1],
  ['ALTER TABLE "products" ADD COLUMN "sku" text DEFAULT \'\' NOT NULL;', 0],
  ['ALTER TABLE "products" ADD COLUMN "id" serial NOT NULL;', 0],
  ['ALTER TABLE "products" ADD COLUMN "sku" text GENERATED ALWAYS AS (lower(name)) STORED NOT NULL;', 0],
  ['ALTER TABLE "orders" ADD CONSTRAINT "orders_total_check" CHECK ("total" IS NOT NULL);', 0],
])('flags ADD NOT NULL without a value for existing rows in %j', (sql, count) => {
  expect(findContractStatements(sql)).toHaveLength(count)
})

it.each([
  ['DROP /* x */ TABLE carts;', 1],
  ['DELETE FROM carts /* WHERE */;', 1],
  ['DELETE FROM carts -- WHERE clause', 1],
])('ignores block and trailing comments in %j', (sql, count) => {
  expect(findContractStatements(sql)).toHaveLength(count)
})

it.each([
  ['DROP INDEX products_slug_idx;', 1],
  ['ALTER TABLE cart_items DROP CONSTRAINT cart_items_cart_id_fk;', 1],
  ['DROP TYPE order_status;', 1],
  ['DROP SCHEMA old CASCADE;', 1],
  ['DROP VIEW v_orders;', 1],
  ['DROP SEQUENCE orders_id_seq;', 1],
  ['ALTER TABLE orders SET SCHEMA archive;', 1],
  ['REVOKE ALL ON products FROM app;', 1],
  ['UPDATE products SET price = 0;', 1],
  ['UPDATE products SET price = 0 WHERE id = 1;', 0],
  ['WITH gone AS (DELETE FROM carts RETURNING id) SELECT * FROM gone;', 1],
  ['CREATE TABLE "t" ("a" integer REFERENCES "x" ("id") ON UPDATE CASCADE);', 0],
])('counts the remaining contract shapes in %j', (sql, count) => {
  expect(findContractStatements(sql)).toHaveLength(count)
})

it.each([
  ['UPDATE products p SET price = 0;', 1],
  ['UPDATE products AS p SET price = 0;', 1],
  ['UPDATE ONLY products SET price = 0;', 1],
  ['UPDATE "my table" SET price = 0;', 1],
  ['UPDATE products p SET price = 0 WHERE p.id = 1;', 0],
  ['INSERT INTO products (slug) VALUES (\'a\') ON CONFLICT (slug) DO UPDATE SET slug = excluded.slug;', 0],
])('flags UPDATE without WHERE whatever names the table in %j', (sql, count) => {
  expect(findContractStatements(sql)).toHaveLength(count)
})

it.each([
  ['UPDATE orders SET total = (SELECT max(total) FROM orders o WHERE o.id = 1);', 1],
  ['DELETE FROM carts USING (SELECT id FROM users WHERE banned) b;', 1],
  ['WITH gone AS (DELETE FROM carts RETURNING id) SELECT * FROM gone WHERE id > 0;', 1],
  ['UPDATE orders SET total = 0 WHERE id IN (SELECT id FROM refunds WHERE done);', 0],
  ['WITH gone AS (DELETE FROM carts WHERE created_at < now() RETURNING id) SELECT * FROM gone;', 0],
])('only counts a WHERE at the level of its own UPDATE or DELETE in %j', (sql, count) => {
  expect(findContractStatements(sql)).toHaveLength(count)
})

it.each([
  ["ALTER TABLE a ADD COLUMN s text DEFAULT '--'; DROP TABLE b;", 1],
  ["ALTER TABLE a ADD COLUMN s text DEFAULT '/*'; DROP TABLE b; -- */", 1],
  ["INSERT INTO settings (k, v) VALUES ('note', 'DROP TABLE y; TRUNCATE z');", 0],
  ["ALTER TABLE products ADD COLUMN status text DEFAULT 'RENAME';", 0],
  ['ALTER TABLE products ADD COLUMN "rename" text;', 0],
  ["INSERT INTO notes (body) VALUES (E'it\\'s DELETE FROM carts');", 0],
  ["INSERT INTO notes (body) VALUES ('''a;'); DROP TABLE b;", 1],
  ['CREATE TABLE "a""" (id integer); DROP TABLE b;', 1],
  ['/* outer /* inner */ DROP TABLE x; */ CREATE TABLE y (id integer);', 0],
  ['CREATE TABLE a (id integer); -- DROP TABLE old;', 0],
])('reads string literals, quoted names and comments as SQL does in %j', (sql, count) => {
  expect(findContractStatements(sql)).toHaveLength(count)
})

// Audit PR #46 M1: a dollar-quoted body may be a plain string, so a quote or comment opener inside it must not run
// past its closing tag and hide the statements after it.
it.each([
  ["COMMENT ON TABLE t IS $$customer's table$$;\nDROP TABLE b;\nALTER TABLE c DROP COLUMN d;", 2],
  ['COMMENT ON TABLE t IS $c$see /* note$c$;\nDROP TABLE b;\nTRUNCATE c;', 2],
  ['COMMENT ON TABLE t IS $$a -- b$$; DROP TABLE b;', 1],
  ['COMMENT ON TABLE t IS $$say "hi$$; DROP TABLE b;', 1],
  ['COMMENT ON TABLE t IS $x$ends $$ here$x$; DROP TABLE b;', 1],
  ["DO $f$ BEGIN RAISE NOTICE $m$can't$m$; DELETE FROM carts; RAISE NOTICE 'ok'; END $f$;", 1],
  ["COMMENT ON TABLE t IS $$customer's table$$;", 0],
  ["DO $f$ BEGIN RAISE NOTICE $m$can't$m$; END $f$;", 0],
])('keeps a dollar-quoted body inside its tags in %j', (sql, count) => {
  expect(findContractStatements(sql)).toHaveLength(count)
})

// Postgres would reject such a file, and whatever follows the opener cannot be read: fail closed.
it.each([
  ["INSERT INTO t VALUES ('open);\nDROP TABLE b;"],
  ['CREATE TABLE "open (id integer);'],
  ['CREATE TABLE a (id integer); /* never closed'],
  ['DO $$ BEGIN NULL; END;'],
])('reports an unterminated string, name, comment or dollar quote in %j', (sql) => {
  expect(findContractStatements(sql)).toContainEqual(expect.stringMatching(/^unterminated /))
})

it.each([
  ['ALTER TABLE a ADD COLUMN x integer NOT NULL, ADD COLUMN y integer DEFAULT 1;', 1],
  ['ALTER TABLE a ADD COLUMN y integer DEFAULT 1, ADD COLUMN x integer NOT NULL;', 1],
  ['ALTER TABLE a ADD COLUMN k integer PRIMARY KEY;', 1],
  ['ALTER TABLE a ADD COLUMN x integer DEFAULT 0 NOT NULL, ADD COLUMN y text;', 0],
  ['ALTER TABLE a ADD COLUMN k serial PRIMARY KEY;', 0],
  ['ALTER TABLE a ADD CHECK (x IS NOT NULL);', 0],
])('checks each action of a multi-action ALTER TABLE in %j', (sql, count) => {
  expect(findContractStatements(sql)).toHaveLength(count)
})

it.each([
  ["DO $$ BEGIN EXECUTE 'DROP TABLE ' || 'old'; END $$;", 1],
  ["DO $$ BEGIN EXECUTE format('TRUNCATE %I', 'carts'); END $$;", 1],
  ["DO $$ BEGIN EXECUTE 'DROP ' || 'TABLE old'; END $$;", 1],
  ["DO $$ DECLARE stmt text := 'select 1'; BEGIN EXECUTE stmt; END $$;", 1],
  ['DO $$ BEGIN DELETE FROM carts; END $$;', 1],
  ['CREATE TRIGGER t BEFORE UPDATE ON products FOR EACH ROW EXECUTE FUNCTION touch();', 0],
])('flags dynamic SQL the checker cannot read in %j', (sql, count) => {
  expect(findContractStatements(sql)).toHaveLength(count)
})

it.each([
  ['CREATE TABLE "carts" ("id" uuid PRIMARY KEY, "user_id" text NOT NULL);', 0],
  ['CREATE INDEX "products_slug_idx" ON "products" ("slug");', 0],
  ['ALTER TABLE "orders" ADD COLUMN "email" text;', 0],
  ['ALTER TABLE "orders" ADD CONSTRAINT "orders_user_fk" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE no action;', 0],
  ['GRANT SELECT, UPDATE ON products TO app;', 0],
  ['ALTER TABLE products ALTER COLUMN price SET DEFAULT 0;', 0],
  ['CREATE FUNCTION touch() RETURNS trigger AS $$ BEGIN NEW.updated_at := now(); RETURN NEW; END $$ LANGUAGE plpgsql;', 0],
  ['SELECT * FROM carts FOR UPDATE;', 0],
])('does not flag expand statements in %j', (sql, count) => {
  expect(findContractStatements(sql)).toHaveLength(count)
})

// Audit PR #46 M2: every DROP is contract except the narrow allowlist in DROP_ALLOWLIST.
it.each([
  ['ALTER TABLE "orders" ALTER COLUMN "id" DROP IDENTITY;', 1],
  ['ALTER TABLE "orders" ALTER COLUMN "id" DROP IDENTITY IF EXISTS;', 1],
  ['ALTER TABLE "products" ALTER COLUMN "search" DROP EXPRESSION;', 1],
  ['DROP MATERIALIZED VIEW "sales_by_day";', 1],
  ['DROP POLICY "orders_owner" ON "orders";', 1],
  ['DROP ROLE "app_readonly";', 1],
  ['DROP FUNCTION touch();', 1],
  ['DROP TRIGGER products_touch ON products;', 1],
  ['DROP DOMAIN price;', 1],
  ['DROP EXTENSION pgcrypto;', 1],
  ['DROP TABLE IF EXISTS old;', 1],
  ['DROP OWNED BY app;', 1],
  ['ALTER TYPE address DROP ATTRIBUTE zip;', 1],
  ['ALTER TABLE products ALTER COLUMN image DROP NOT NULL, DROP COLUMN legacy;', 1],
  ['ALTER TABLE products ALTER COLUMN image DROP NOT NULL, ALTER COLUMN price DROP DEFAULT;', 1],
  ['ALTER TABLE products DROP COLUMN legacy, ALTER COLUMN image DROP NOT NULL;', 1],
  ['DO $$ BEGIN DROP TABLE tmp; END $$;', 1],
])('treats every DROP outside the allowlist as contract in %j', (sql, count) => {
  expect(findContractStatements(sql)).toHaveLength(count)
})

it.each([
  ['ALTER TABLE "products" ALTER COLUMN "image" DROP NOT NULL;', 0],
  ['ALTER TABLE products ALTER image DROP /* loosen */ NOT NULL;', 0],
  ['ALTER TABLE products ALTER COLUMN image DROP NOT NULL, ALTER COLUMN name DROP NOT NULL;', 0],
  ['ALTER DOMAIN price DROP NOT NULL;', 0],
  ["COMMENT ON COLUMN products.image IS 'drop after NS-90';", 0],
  ['ALTER TABLE orders ADD COLUMN dropped_at timestamp with time zone;', 0],
  ['CREATE EVENT TRIGGER audit_ddl ON sql_drop EXECUTE FUNCTION log_drop();', 0],
])('does not flag the allowlisted or DROP-free statements in %j', (sql, count) => {
  expect(findContractStatements(sql)).toHaveLength(count)
})

// Audit PR #46 L1: DEFAULT, GENERATED and serial count only where they give existing rows a value.
it.each([
  ['ALTER TABLE a ADD COLUMN x integer NOT NULL REFERENCES b (id) ON DELETE SET DEFAULT;', 1],
  ['ALTER TABLE a ADD COLUMN x integer NOT NULL REFERENCES b (id) ON UPDATE SET DEFAULT;', 1],
  ['ALTER TABLE a ADD COLUMN x integer NOT NULL REFERENCES b (id) ON DELETE SET DEFAULT ON UPDATE CASCADE;', 1],
  ['ALTER TABLE a ADD COLUMN x integer NOT NULL REFERENCES b (generated);', 1],
  ['ALTER TABLE a ADD COLUMN x integer DEFAULT NULL NOT NULL;', 1],
  ['ALTER TABLE a ADD COLUMN x integer NOT NULL DEFAULT null;', 1],
  ['ALTER TABLE a ADD COLUMN serial text NOT NULL;', 1],
  ['ALTER TABLE a ADD serial text NOT NULL;', 1],
  ['ALTER TABLE a ADD COLUMN IF NOT EXISTS serial text NOT NULL;', 1],
  ['ALTER TABLE a ADD COLUMN generated text NOT NULL;', 1],
  ['ALTER TABLE a ADD COLUMN serial serial NOT NULL;', 0],
  ['ALTER TABLE a ADD COLUMN IF NOT EXISTS n bigserial NOT NULL;', 0],
  ['ALTER TABLE a ADD COLUMN n serial8 NOT NULL;', 0],
  ['ALTER TABLE a ADD COLUMN x integer NOT NULL DEFAULT 1;', 0],
  ['ALTER TABLE a ADD COLUMN x integer DEFAULT 0 NOT NULL REFERENCES b (id) ON DELETE SET DEFAULT;', 0],
  ['ALTER TABLE a ADD COLUMN "id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY;', 0],
  ['ALTER TABLE a ADD COLUMN "id" integer GENERATED BY DEFAULT AS IDENTITY NOT NULL;', 0],
])('gives existing rows a value only through a real DEFAULT, GENERATED or serial type in %j', (sql, count) => {
  expect(findContractStatements(sql)).toHaveLength(count)
})

// Audit PR #46 L2: bulk writes that do not read as `UPDATE/DELETE … WHERE`.
it.each([
  ['MERGE INTO carts c USING stale s ON c.id = s.id WHEN MATCHED THEN DELETE;', 1],
  ['MERGE INTO carts c USING active a ON c.id = a.id WHEN NOT MATCHED BY SOURCE THEN DELETE;', 1],
  ['MERGE INTO products p USING prices s ON p.id = s.id WHEN MATCHED THEN UPDATE SET price = s.price;', 1],
  ['CREATE RULE r AS ON INSERT TO orders DO UPDATE products SET stock = 0;', 1],
  ['CREATE RULE r AS ON INSERT TO orders DO ALSO UPDATE products SET stock = 0;', 1],
  ['CREATE OR REPLACE RULE r AS ON INSERT TO orders DO INSTEAD UPDATE products SET stock = 0;', 1],
  ['UPDATE products SET price = 0 WHERE true;', 1],
  ['UPDATE products SET price = 0 WHERE TRUE RETURNING id;', 1],
  ['DELETE FROM carts WHERE true;', 1],
  ['UPDATE products SET price = 0 WHERE 1 = 1;', 1],
  ['MERGE INTO products p USING seed s ON p.slug = s.slug WHEN NOT MATCHED THEN INSERT (slug) VALUES (s.slug);', 0],
  ['INSERT INTO products (slug) VALUES (\'a\') ON CONFLICT ON CONSTRAINT products_slug_unique DO UPDATE SET slug = excluded.slug;', 0],
  ['UPDATE products SET price = 0 WHERE true AND id = 1;', 0],
  ['UPDATE products SET price = 0 WHERE truthy;', 0],
  ['UPDATE products SET price = 0 WHERE 1 = 10;', 0],
])('flags bulk writes without a limiting WHERE in %j', (sql, count) => {
  expect(findContractStatements(sql)).toHaveLength(count)
})

// Audit PR #46 L3: `EXECUTE FUNCTION` / `PROCEDURE` is a trigger clause only inside CREATE … TRIGGER.
it.each([
  ["DO $$ DECLARE function text := 'select 1'; BEGIN EXECUTE function; END $$;", 1],
  ["DO $$ DECLARE procedure text := 'select 1'; BEGIN EXECUTE procedure; END $$;", 1],
  ['CREATE TRIGGER t BEFORE UPDATE ON products FOR EACH ROW EXECUTE FUNCTION touch($$EXECUTE stmt$$);', 1],
  ['CREATE OR REPLACE TRIGGER t BEFORE UPDATE ON products FOR EACH ROW EXECUTE FUNCTION touch();', 0],
  ['CREATE CONSTRAINT TRIGGER t AFTER INSERT ON orders DEFERRABLE FOR EACH ROW EXECUTE PROCEDURE check_stock();', 0],
])('allows EXECUTE FUNCTION only as the action of CREATE TRIGGER in %j', (sql, count) => {
  expect(findContractStatements(sql)).toHaveLength(count)
})

it.each([
  ['CREATE TYPE "public"."order_status" AS ENUM(\'pending\', \'paid\');', 0],
  ['ALTER TYPE "public"."order_status" ADD VALUE \'refunded\';', 0],
  ['ALTER TABLE "orders" ADD COLUMN "status" "order_status" DEFAULT \'pending\' NOT NULL;', 0],
  ['CREATE UNIQUE INDEX "orders_number_idx" ON "orders" USING btree ("number");', 0],
  ['CREATE MATERIALIZED VIEW "sales_by_day" AS (SELECT 1);', 0],
  ['CREATE POLICY "orders_owner" ON "orders" AS PERMISSIVE FOR SELECT TO public USING (true);', 0],
  ['ALTER TABLE "orders" ENABLE ROW LEVEL SECURITY;', 0],
  ['CREATE EXTENSION IF NOT EXISTS pgcrypto;', 0],
  ['CREATE SEQUENCE "public"."order_number_seq" INCREMENT BY 1 START WITH 1000;', 0],
  ['ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_quantity_positive" CHECK ("cart_items"."quantity" > 0);', 0],
])('does not flag other expand statements drizzle-kit generates in %j', (sql, count) => {
  expect(findContractStatements(sql)).toHaveLength(count)
})

it('does not flag the existing drizzle/0000_*.sql', () => {
  const initial = readMigrations().filter(({ file }) => /^0000_.*\.sql$/.test(file))
  expect(initial).toHaveLength(1)
  for (const { file, sql } of initial) expect(findContractStatements(sql), file).toEqual([])
})

it('every migration with a contract statement names the ticket of its expand step', () => {
  for (const { file, sql } of readMigrations()) {
    if (findContractStatements(sql).length > 0) expect(sql, file).toMatch(/^-- contract: NS-\d+$/m)
  }
})

it('scans every migration file under drizzle/ and matches the journal entries', () => {
  const journal: { entries: { tag: string }[] } = JSON.parse(
    readFileSync(join('drizzle', 'meta', '_journal.json'), 'utf8'),
  )
  const files = readMigrations().map(({ file }) => file)
  expect(files).toHaveLength(journal.entries.length)
  for (const entry of journal.entries) expect(files).toContain(`${entry.tag}.sql`)
})
