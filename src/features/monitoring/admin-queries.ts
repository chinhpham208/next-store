import 'server-only'
import { count, desc, gte } from 'drizzle-orm'
import { dbQuery, errorEvents } from '@/db'
import { hasAdminSession } from '@/features/admin'
import type { AdminErrorRow } from '@/features/monitoring/types'

// Reads of the admin area for monitoring (ADR-0022, ADR-0023): never cached, and each one checks the session itself,
// first (ADR-0018 "Sửa theo audit PR #106" H1). src/admin-session-checks.test.ts reads this file.

const ADMIN_LIST_LIMIT = 100
const RECENT_WINDOW_MS = 24 * 3_600_000

/** The 100 groups seen most recently, newest first; the fingerprint breaks ties so the order is stable. */
export async function listErrorEventsForAdmin(): Promise<AdminErrorRow[]> {
  if (!(await hasAdminSession())) throw new Error('admin: no session')
  return dbQuery({
    name: 'monitoring.admin-list',
    run: (db) =>
      db
        .select({
          fingerprint: errorEvents.fingerprint,
          routeType: errorEvents.routeType,
          routePath: errorEvents.routePath,
          method: errorEvents.method,
          digest: errorEvents.digest,
          errorName: errorEvents.errorName,
          message: errorEvents.message,
          count: errorEvents.count,
          lastSeenAt: errorEvents.lastSeenAt,
        })
        .from(errorEvents)
        .orderBy(desc(errorEvents.lastSeenAt), desc(errorEvents.fingerprint))
        .limit(ADMIN_LIST_LIMIT),
  })
}

/** For the chip of the admin bar: the number of groups (not the sum of their counts) seen in the last 24 hours. */
export async function countRecentErrorsForAdmin(): Promise<number> {
  if (!(await hasAdminSession())) throw new Error('admin: no session')
  const since = new Date(Date.now() - RECENT_WINDOW_MS)
  const [row] = await dbQuery({
    name: 'monitoring.admin-recent-count',
    run: (db) => db.select({ total: count() }).from(errorEvents).where(gte(errorEvents.lastSeenAt, since)),
  })
  return row?.total ?? 0
}
