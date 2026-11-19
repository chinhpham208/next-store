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
  resolveDatabaseTarget,
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

// DDL goes over the direct (unpooled) endpoint when Neon provides one; PgBouncer in transaction mode is for
// short app queries. Only switch when runtime is already Postgres, so migrate never targets another database.
const openMigrationConnection = (): Connection => {
  const unpooled = process.env.DATABASE_URL_UNPOOLED?.trim() ?? ''
  if (connection.kind !== 'postgres') return connection
  const target =
    unpooled === ''
      ? connection.target
      : resolveDatabaseTarget({ DATABASE_URL: unpooled, VERCEL: process.env.VERCEL, VERCEL_ENV: process.env.VERCEL_ENV })
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
