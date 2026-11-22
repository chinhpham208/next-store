import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { it, expect } from 'vitest'

// Contract statements remove or change something that release N-1 code may still read or write (conventions §10).
// Patterns use [\s\S] where a statement spans lines, so multi-line ALTER TABLE statements are still caught.
const CONTRACT_PATTERNS: RegExp[] = [
  /\bDROP\s+TABLE\b/i,
  /\bALTER\s+TABLE\b[\s\S]*?\bDROP\s+(?:COLUMN\s+)?(?!(?:CONSTRAINT|DEFAULT|NOT|IDENTITY|EXPRESSION)\b)\S/i,
  /\bALTER\s+TABLE\b[\s\S]*?\bALTER\s+(?:COLUMN\s+)?\S+\s+(?:SET\s+DATA\s+)?TYPE\b/i,
  /\bALTER\s+TABLE\b[\s\S]*?\bALTER\s+(?:COLUMN\s+)?\S+\s+DROP\s+DEFAULT\b/i,
  /\bSET\s+NOT\s+NULL\b/i,
  /\bRENAME\b/i,
  /\bTRUNCATE\b/i,
  /\bDROP\s+(?:INDEX|CONSTRAINT|TYPE|SCHEMA|VIEW|SEQUENCE)\b/i,
  /\bSET\s+SCHEMA\b/i,
  /\bREVOKE\b/i,
  // Dynamic SQL is built at run time and cannot be read here. Triggers use `EXECUTE FUNCTION` / `PROCEDURE`.
  /\bEXECUTE\b(?!\s+(?:FUNCTION|PROCEDURE)\b)/i,
]

// The keyword that starts a DELETE or UPDATE statement, wherever it sits (CTE, DO block). `ON UPDATE` (foreign key),
// `DO UPDATE` (ON CONFLICT), `FOR UPDATE` (row lock), trigger events and privilege lists are not statements.
const ROW_WRITE = /\bDELETE\s+FROM\b|(?<!(?:\b(?:ON|DO|FOR|OR|BEFORE|AFTER|GRANT)|,)\s*)\bUPDATE\b(?=[\s\S]*?\bSET\b)/gi

// True when WHERE appears after `start` at the same parenthesis depth, before the group around `start` closes.
// A WHERE inside a subquery belongs to that subquery and does not limit the outer statement.
const hasOwnWhere = (statement: string, start: number) => {
  let depth = 0
  for (let index = start; index < statement.length; index++) {
    const char = statement[index]
    if (char === '(') depth++
    else if (char === ')') {
      if (depth === 0) return false
      depth--
    } else if (depth === 0 && /^WHERE\b/i.test(statement.slice(index, index + 6)) && !/\w/.test(statement[index - 1] ?? '')) {
      return true
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

// ADD COLUMN NOT NULL (or PRIMARY KEY, which implies it) is safe only when existing rows get a value: DEFAULT,
// a generated column, or a serial type. Each ALTER TABLE action is checked on its own, so one column's DEFAULT does
// not cover another. Table constraints (`ADD CONSTRAINT`, `ADD CHECK`, ...) are not columns and are excluded.
const isUnsafeAddNotNull = (statement: string) =>
  /\bALTER\s+TABLE\b/i.test(statement) &&
  splitTopLevel(statement).some(
    (action) =>
      /\bADD\s+(?!(?:CONSTRAINT|CHECK|UNIQUE|PRIMARY|FOREIGN|EXCLUDE)\b)(?:COLUMN\s+)?[\s\S]*?\b(?:NOT\s+NULL|PRIMARY\s+KEY)\b/i.test(
        action,
      ) && !/\b(?:DEFAULT|GENERATED|(?:big|small)?serial)\b/i.test(action),
  )

const isContractStatement = (statement: string) =>
  CONTRACT_PATTERNS.some((pattern) => pattern.test(statement)) ||
  hasRowWriteWithoutWhere(statement) ||
  isUnsafeAddNotNull(statement)

// Reads SQL the way Postgres tokenizes it, so a keyword, `;` or `--` inside a literal is not code:
// - string literals become `''` and quoted names become `"_"` (`E'…'` strings honour backslash escapes);
// - comments become a space, and block comments nest as in Postgres, so `DROP /* x */ TABLE` is still one statement;
// - a dollar-quote tag becomes a space and its body is read as code, because DO blocks and function bodies hold
//   statements. A dollar-quoted plain string is therefore checked too, which errs on the side of flagging.
const DOLLAR_TAG = /\$(?:[A-Za-z_]\w*)?\$/y

const normalizeSql = (sql: string) => {
  let out = ''
  let index = 0
  while (index < sql.length) {
    DOLLAR_TAG.lastIndex = index
    const dollarTag = DOLLAR_TAG.exec(sql)
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
      index++
      out += quote === "'" ? "''" : '"_"'
    } else if (dollarTag) {
      index += dollarTag[0].length
      out += ' '
    } else {
      out += sql[index]
      index++
    }
  }
  return out
}

const findContractStatements = (sql: string): string[] =>
  normalizeSql(sql)
    .split(';')
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0 && isContractStatement(statement))

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
  ['/* outer /* inner */ DROP TABLE x; */ CREATE TABLE y (id integer);', 0],
  ['CREATE TABLE a (id integer); -- DROP TABLE old;', 0],
])('reads string literals, quoted names and comments as SQL does in %j', (sql, count) => {
  expect(findContractStatements(sql)).toHaveLength(count)
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
