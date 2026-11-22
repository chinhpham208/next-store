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
  /\bDELETE\s+FROM\b(?![\s\S]*\bWHERE\b)/i,
  // `ON UPDATE CASCADE` in a foreign key is not an UPDATE statement.
  /(?<!\bON\s)\bUPDATE\s+\S+\s+SET\b(?![\s\S]*\bWHERE\b)/i,
]

// ADD COLUMN NOT NULL is safe only when existing rows get a value: DEFAULT, a generated column, or a serial type.
// ADD CONSTRAINT is not a column and is excluded.
const isUnsafeAddNotNull = (statement: string) =>
  /\bALTER\s+TABLE\b[\s\S]*?\bADD\s+(?!CONSTRAINT\b)(?:COLUMN\s+)?[\s\S]*?\bNOT\s+NULL\b/i.test(statement) &&
  !/\b(?:DEFAULT|GENERATED|(?:big|small)?serial)\b/i.test(statement)

const isContractStatement = (statement: string) =>
  CONTRACT_PATTERNS.some((pattern) => pattern.test(statement)) || isUnsafeAddNotNull(statement)

// Block comments become a space so `DROP /* x */ TABLE` still reads as one statement; line comments run to end of line.
const stripComments = (sql: string) => sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, '')

const findContractStatements = (sql: string): string[] =>
  stripComments(sql)
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
