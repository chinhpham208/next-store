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
  '(absent = 5432), same host without the Neon "-pooler" suffix); refusing to migrate.'
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
  if (!sameDatabase || !samePort || !sameHost) throw new Error(UNPOOLED_MISMATCH_MESSAGE)
  return unpooledUrl
}

// DDL goes over the direct (unpooled) endpoint when Neon provides one; PgBouncer in transaction mode is for
// short app queries. Only switch when runtime is already Postgres, so migrate never targets another database.
// createConnection builds the client with the same explicit-options builder as the runtime connection.
const openMigrationConnection = (): Connection => {
  if (connection.kind !== 'postgres') return connection
  const url = resolveMigrationUrl({
    pooledUrl: connection.target.url,
    unpooledUrl: process.env.DATABASE_URL_UNPOOLED?.trim() ?? '',
  })
  const target = resolveDatabaseTarget({ DATABASE_URL: url, VERCEL: process.env.VERCEL, VERCEL_ENV: process.env.VERCEL_ENV })
  return createConnection(target, { max: 1 })
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
