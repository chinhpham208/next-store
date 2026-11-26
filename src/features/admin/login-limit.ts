import 'server-only'
import { asc, count, gte, inArray, lt, sql } from 'drizzle-orm'
import { adminLoginFailures, dbQuery, type Db } from '@/db'
import {
  FAILURE_RETENTION_HOURS,
  LOGIN_WINDOW_MINUTES,
  MAX_FAILURES_GLOBAL,
  MAX_FAILURES_PER_IP,
} from '@/features/admin/limits'

// The failed-login limit of ADR-0018 8A, by IP hash and `now` only (no header, no cookie), so it runs on PGlite in
// tests (conventions.md §1). Rows hold an HMAC of the address, never the address; nothing here logs.

export { FAILURE_RETENTION_HOURS, LOGIN_WINDOW_MINUTES, MAX_FAILURES_GLOBAL, MAX_FAILURES_PER_IP }

const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS

// Most rows one purge deletes: the request that runs it stays quick, as with the cart purge (ADR-0014).
const PURGE_BATCH = 100

const windowStart = (now: Date): Date => new Date(now.getTime() - LOGIN_WINDOW_MINUTES * MINUTE_MS)
const retentionCutoff = (now: Date): Date => new Date(now.getTime() - FAILURE_RETENTION_HOURS * HOUR_MS)

/**
 * True when this address has MAX_FAILURES_PER_IP failures in the window, or everyone together MAX_FAILURES_GLOBAL.
 * One statement, both counts over the same rows (admin_login_failures_failed_at_idx). The caller treats a rejection
 * as locked (fail-closed): it never compares the password when this throws.
 */
export const isLoginLocked = async ({ ipHash, now }: { ipHash: string; now: Date }): Promise<boolean> => {
  const [row] = await dbQuery({
    name: 'admin.login-lock',
    run: (db) =>
      db
        .select({
          perIp: sql`count(*) filter (where ${adminLoginFailures.ipHash} = ${ipHash})`.mapWith(Number),
          global: count(),
        })
        .from(adminLoginFailures)
        .where(gte(adminLoginFailures.failedAt, windowStart(now))),
  })
  if (row === undefined) return true
  return row.perIp >= MAX_FAILURES_PER_IP || row.global >= MAX_FAILURES_GLOBAL
}

type LoginTx = Parameters<Parameters<Db['transaction']>[0]>[0]

// The oldest rows past the retention, at most PURGE_BATCH of them (cutoff index, oldest first).
const deleteOldFailures = (db: Db | LoginTx, now: Date) =>
  db.delete(adminLoginFailures).where(
    inArray(
      adminLoginFailures.id,
      db
        .select({ id: adminLoginFailures.id })
        .from(adminLoginFailures)
        .where(lt(adminLoginFailures.failedAt, retentionCutoff(now)))
        .orderBy(asc(adminLoginFailures.failedAt))
        .limit(PURGE_BATCH),
    ),
  )

/** One wrong password: one row, then the purge in the same transaction, so the table cannot grow without bound. */
export const recordLoginFailure = async ({ ipHash, now }: { ipHash: string; now: Date }): Promise<void> => {
  await dbQuery({
    name: 'admin.login-failure',
    transaction: async (tx) => {
      // No sequence on this table (ADR-0010: the app role is DML-only): the server makes the id.
      await tx.insert(adminLoginFailures).values({ id: crypto.randomUUID(), ipHash, failedAt: now })
      await deleteOldFailures(tx, now)
    },
  })
}

/**
 * The purge alone, run after a successful login (audit PR #103 L2): when a guessing run stops, no new failure comes
 * to purge its rows, so their IP hashes would stay past FAILURE_RETENTION_HOURS. The admin logging in clears them.
 */
export const purgeLoginFailures = async (now: Date): Promise<void> => {
  await dbQuery({ name: 'admin.login-purge', run: (db) => deleteOldFailures(db, now) })
}
