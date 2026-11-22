import 'server-only'
import { pathToFileURL } from 'node:url'
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

export const runMigrations = async (target: Connection = connection): Promise<void> => {
  if (target.kind === 'postgres') {
    await migratePostgres(target.db, { migrationsFolder: MIGRATIONS_FOLDER })
    return
  }
  await migratePglite(target.db, { migrationsFolder: MIGRATIONS_FOLDER })
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
type MigrationTargetInput = { pooledUrl: string; env: MigrationEnv }

// The URL migrate connects to goes through resolveDatabaseTarget again, so the Vercel checks (including the
// production endpoint guard) apply to the unpooled URL too, not only to the pooled one the runtime uses.
export const resolveMigrationTarget = ({ pooledUrl, env }: MigrationTargetInput) => {
  const url = resolveMigrationUrl({ pooledUrl, unpooledUrl: env.DATABASE_URL_UNPOOLED?.trim() ?? '' })
  const target = resolveDatabaseTarget({
    DATABASE_URL: url,
    VERCEL: env.VERCEL,
    VERCEL_ENV: env.VERCEL_ENV,
    NEON_PRODUCTION_ENDPOINT: env.NEON_PRODUCTION_ENDPOINT,
  })
  // Errors while building the client (sslrootcert, driver) must name the variable the operator has to fix.
  return { target, name: url === pooledUrl ? 'DATABASE_URL' : UNPOOLED }
}

// DDL goes over the direct (unpooled) endpoint when Neon provides one; PgBouncer in transaction mode is for
// short app queries. Only switch when runtime is already Postgres, so migrate never targets another database.
// createConnection builds the client with the same explicit-options builder as the runtime connection.
const openMigrationConnection = (): Connection => {
  if (connection.kind !== 'postgres') return connection
  const env = {
    DATABASE_URL_UNPOOLED: process.env.DATABASE_URL_UNPOOLED,
    VERCEL: process.env.VERCEL,
    VERCEL_ENV: process.env.VERCEL_ENV,
    NEON_PRODUCTION_ENDPOINT: process.env.NEON_PRODUCTION_ENDPOINT,
  }
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
