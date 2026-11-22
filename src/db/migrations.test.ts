import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { it, expect } from 'vitest'

// Contract statements remove or change something that release N-1 code may still read or write (conventions §10).
const CONTRACT_PATTERNS: RegExp[] = [
  /\bDROP\s+TABLE\b/i,
  /\bDROP\s+COLUMN\b/i,
  /\bRENAME\b/i,
  /\bALTER\s+COLUMN\b.*\bTYPE\b/i,
  /\bSET\s+NOT\s+NULL\b/i,
  /\bTRUNCATE\b/i,
]

const isContractStatement = (statement: string) => {
  if (/^DELETE\s+FROM\b/i.test(statement)) return !/\bWHERE\b/i.test(statement)
  return CONTRACT_PATTERNS.some((pattern) => pattern.test(statement))
}

// Comment lines are dropped first so a commented-out DROP does not count.
const findContractStatements = (sql: string): string[] =>
  sql
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n')
    .split(';')
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0 && isContractStatement(statement))

it.each([
  ['ALTER TABLE "products" DROP COLUMN "image";', 1],
  ['alter table products rename column name to title;', 1],
  ['ALTER TABLE orders ALTER COLUMN total TYPE bigint;', 1],
  ['TRUNCATE carts;', 1],
  ['DELETE FROM carts;', 1],
  ['DELETE FROM carts WHERE created_at < now() - interval \'30 days\';', 0],
  ['-- DROP TABLE old;\nCREATE TABLE "carts" ("id" uuid PRIMARY KEY);', 0],
  ['ALTER TABLE "products" ADD COLUMN "sku" text;', 0],
])('counts contract statements in %j', (sql, count) => {
  expect(findContractStatements(sql)).toHaveLength(count)
})

it('every migration with a contract statement names the ticket of its expand step', () => {
  for (const file of readdirSync('drizzle').filter((name) => name.endsWith('.sql'))) {
    const sql = readFileSync(join('drizzle', file), 'utf8')
    if (findContractStatements(sql).length > 0) expect(sql, file).toMatch(/^-- contract: NS-\d+$/m)
  }
})
