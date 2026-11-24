import 'server-only'
import { pathToFileURL } from 'node:url'
import { sql, type SQL } from 'drizzle-orm'
import type { PgTransactionConfig } from 'drizzle-orm/pg-core'
import { migrate as migratePglite } from 'drizzle-orm/pglite/migrator'
import { migrate as migratePostgres } from 'drizzle-orm/postgres-js/migrator'
import {
  closeConnection,
  connection,
  createConnection,
  describeError,
  describeTarget,
  parsePostgresUrl,
  resolveDatabaseTarget,
  resolveSsl,
  type Connection,
} from '@/db/client'

const MIGRATIONS_FOLDER = './drizzle'

// db:migrate runs in the build of every deploy, as the owner role, while the previous deployment still serves
// (conventions §10). An ALTER or CREATE INDEX queued behind a long app transaction would make every later query on
// that table wait behind it, so the migration gives up after MIGRATION_LOCK_TIMEOUT instead: the build fails and the
// old deployment keeps serving (NS-101, audit PR #69 L1). MIGRATION_STATEMENT_TIMEOUT bounds a statement that does
// get its locks; this schema's largest table is capped at MAX_CARTS rows (ADR-0014), far inside a minute.
// Written as Postgres prints them, so current_setting() reads back the same text.
export const MIGRATION_LOCK_TIMEOUT = '5s'
export const MIGRATION_STATEMENT_TIMEOUT = '1min'

// SET LOCAL, inside the migration's own transaction: a session-level SET through the Neon pooler (transaction mode)
// would stay on a server connection that the app's queries reuse. Startup parameters are not used for the same
// reason: the pooler may refuse them. Two statements: a prepared query holds only one.
const SET_MIGRATION_TIMEOUTS: readonly SQL[] = [
  sql.raw(`SET LOCAL lock_timeout = '${MIGRATION_LOCK_TIMEOUT}'`),
  sql.raw(`SET LOCAL statement_timeout = '${MIGRATION_STATEMENT_TIMEOUT}'`),
]

type Executor = { execute: (query: SQL) => Promise<unknown> }
// Method syntax on purpose: drizzle's sessions take a transaction callback of their own driver's type.
type TransactionRunner = {
  transaction<T>(run: (tx: Executor) => Promise<T>, config?: PgTransactionConfig): Promise<T>
}

// Drizzle's migrator runs every pending migration in one `db.session.transaction(…)` (pg-core dialect.migrate). This
// session starts that transaction with the timeouts; every other property is the real session's.
const withMigrationTimeouts = <S extends TransactionRunner>(session: S): S =>
  new Proxy(session, {
    get: (real, property, receiver) => {
      if (property !== 'transaction') return Reflect.get(real, property, receiver)
      const transaction: TransactionRunner['transaction'] = (run, config) =>
        real.transaction(async (tx) => {
          for (const statement of SET_MIGRATION_TIMEOUTS) await tx.execute(statement)
          return run(tx)
        }, config)
      return transaction
    },
  })

// The same database, whose `session` (what the migrator reads) is the one above.
const withTimeoutSession = <D extends { _: { session: TransactionRunner } }>(db: D): D =>
  new Proxy(db, {
    get: (real, property, receiver) =>
      property === 'session' ? withMigrationTimeouts(real._.session) : Reflect.get(real, property, receiver),
  })

export const runMigrations = async (target: Connection = connection, migrationsFolder = MIGRATIONS_FOLDER) => {
  const config = { migrationsFolder }
  if (target.kind === 'postgres') {
    await migratePostgres(withTimeoutSession(target.db), config)
    return
  }
  await migratePglite(withTimeoutSession(target.db), config)
}

// Fixed text on purpose: either URL carries a password, and the host alone already identifies the customer DB.
const UNPOOLED_MISMATCH_MESSAGE =
  'DATABASE_URL_UNPOOLED must point to the same database as DATABASE_URL (same decoded database name, same port ' +
  '(absent = 5432), same host without the Neon "-pooler" suffix, same options parameter or none on both); ' +
  'refusing to migrate.'
const UNPOOLED = 'DATABASE_URL_UNPOOLED'

// Neon: `ep-xxx-pooler.region.aws.neon.tech` is PgBouncer in front of `ep-xxx.region.aws.neon.tech`.
const withoutPoolerSuffix = (hostname: string): string => {
  const [first = '', ...rest] = hostname.toLowerCase().split('.')
  return [first.endsWith('-pooler') ? first.slice(0, -'-pooler'.length) : first, ...rest].join('.')
}

type MigrationUrls = { pooledUrl: string; unpooledUrl: string }

// The two variables are set independently (Vercel UI, Neon integration); a stale or copy-pasted
// DATABASE_URL_UNPOOLED must not run DDL against a database the app is not using. Both sides go through the
// same parser the client is built from, so what is compared here is exactly what migrate connects to.
export const resolveMigrationUrl = ({ pooledUrl, unpooledUrl }: MigrationUrls): string => {
  if (unpooledUrl === '' || unpooledUrl === pooledUrl) return pooledUrl
  const pooled = parsePostgresUrl(pooledUrl)
  const unpooled = parsePostgresUrl(unpooledUrl, UNPOOLED)
  // Checked here so a TLS refusal names DATABASE_URL_UNPOOLED, not DATABASE_URL.
  resolveSsl(unpooled, UNPOOLED)
  const sameDatabase = pooled.database === unpooled.database
  const samePort = pooled.port === unpooled.port
  const sameHost = withoutPoolerSuffix(pooled.host) === unpooled.host.toLowerCase()
  // `options=endpoint=<id>` routes to a Neon endpoint for clients without SNI, so it is part of the target too.
  const sameOptions = pooled.params.get('options') === unpooled.params.get('options')
  if (!sameDatabase || !samePort || !sameHost || !sameOptions) throw new Error(UNPOOLED_MISMATCH_MESSAGE)
  return unpooledUrl
}

type MigrationEnv = {
  DATABASE_URL_UNPOOLED?: string
  VERCEL?: string
  VERCEL_ENV?: string
  NEON_PRODUCTION_ENDPOINT?: string
}

// Explicit keys, tested: a variable forgotten here silently changes which checks the migration URL gets
// (review of PR #15). Nothing else from process.env reaches the migration target.
export const readMigrationEnv = (env: NodeJS.ProcessEnv): MigrationEnv => ({
  DATABASE_URL_UNPOOLED: env.DATABASE_URL_UNPOOLED,
  VERCEL: env.VERCEL,
  VERCEL_ENV: env.VERCEL_ENV,
  NEON_PRODUCTION_ENDPOINT: env.NEON_PRODUCTION_ENDPOINT,
})

type MigrationTargetInput = { pooledUrl: string; env: MigrationEnv }

// The URL migrate connects to goes through resolveDatabaseTarget again, so the Vercel checks (including the
// production endpoint guard) apply to the unpooled URL too, not only to the pooled one the runtime uses.
export const resolveMigrationTarget = ({ pooledUrl, env }: MigrationTargetInput) => {
  const url = resolveMigrationUrl({ pooledUrl, unpooledUrl: env.DATABASE_URL_UNPOOLED?.trim() ?? '' })
  const pooled = url === pooledUrl
  const target = resolveDatabaseTarget(
    {
      DATABASE_URL: url,
      VERCEL: env.VERCEL,
      VERCEL_ENV: env.VERCEL_ENV,
      NEON_PRODUCTION_ENDPOINT: env.NEON_PRODUCTION_ENDPOINT,
    },
    // The direct endpoint is the point of DATABASE_URL_UNPOOLED; DATABASE_URL itself must still be the pooler.
    { requirePooler: pooled },
  )
  // Errors while building the client (sslrootcert, driver) must name the variable the operator has to fix.
  return { target, name: pooled ? 'DATABASE_URL' : UNPOOLED }
}

// DDL goes over the direct (unpooled) endpoint when Neon provides one; PgBouncer in transaction mode is for
// short app queries. Only switch when runtime is already Postgres, so migrate never targets another database.
// createConnection builds the client with the same explicit-options builder as the runtime connection, but without
// the app role credentials: migrations run as the URL's owner role (ADR-0010 decision A).
export const openMigrationConnection = (): Connection => {
  if (connection.kind !== 'postgres') return connection
  const env = readMigrationEnv(process.env)
  const { target, name } = resolveMigrationTarget({ pooledUrl: connection.target.url, env })
  return createConnection(target, { max: 1, name })
}

const isDirectRun = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href

if (isDirectRun) {
  const main = async () => {
    const migration = openMigrationConnection()
    console.log(`db:migrate: ${describeTarget(migration.target)}`)
    await runMigrations(migration)
    console.log('db:migrate: xong')
    // postgres-js keeps the pool open and PGlite must flush to disk; close both before exiting.
    if (migration !== connection) await closeConnection(migration)
    await closeConnection()
  }
  main()
    .then(() => process.exit(0))
    .catch((error: unknown) => {
      console.error(`db:migrate: lỗi: ${describeError(error)}`)
      process.exit(1)
    })
}
