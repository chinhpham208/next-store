import 'server-only'
import { asc, count, eq, inArray, lt, sql } from 'drizzle-orm'
import { dbQuery, errorEvents } from '@/db'
import { formatErrorLogLine, toErrorReport, type ErrorReport } from '@/features/monitoring/report'

// Writes of error_events (ADR-0022): grouped by fingerprint, capped, and never a cause of an error itself. The
// caller passes `now`, so a test sees one cutoff and the clock of the machine is read in one place only.

export const MAX_ERROR_EVENTS = 500
export const MAX_RECORDS_PER_MINUTE = 30
export const ERROR_RETENTION_DAYS = 30
/** Rows older than the retention that one record removes: enough to empty the table over time, bounded per request. */
export const MAX_PURGE_PER_RECORD = 50

const DAY_MS = 86_400_000
const MINUTE_MS = 60_000
// Arbitrary constant: serialises the writers, so two instances cannot both see 499 rows and both insert (the count
// below would then pass 500). Released at COMMIT; a pooled connection keeps no session state for it.
const WRITER_LOCK_KEY = 6_022_002

export type RecordResult = 'recorded' | 'throttled' | 'full' | 'failed'

// The attempts of the last minute, in this instance's memory (`Mỗi instance có bộ đếm riêng`, ADR-0022): a sliding
// window, so a burst across a minute boundary is not allowed twice the limit. An attempt counts whether or not the
// database answers, so a dead database is tried at most 30 times a minute and the rest only log.
const attempts: number[] = []

const takeWriteSlot = (nowMs: number): boolean => {
  while (attempts.length > 0 && attempts[0] !== undefined && attempts[0] <= nowMs - MINUTE_MS) attempts.shift()
  if (attempts.length >= MAX_RECORDS_PER_MINUTE) return false
  attempts.push(nowMs)
  return true
}

/**
 * Records one error, or says why not. Never throws: it runs while an error is being reported, and a second error
 * from here would be reported in turn (audit PR #120).
 *
 * One transaction: first the purge (so a table full of old rows makes room even for a new fingerprint, audit PR #120
 * M1), then a known fingerprint is counted, and only an unknown one meets the 500-row limit.
 */
export const recordErrorReport = async ({ report, now }: { report: ErrorReport; now: Date }): Promise<RecordResult> => {
  if (!takeWriteSlot(now.getTime())) return 'throttled'
  const cutoff = new Date(now.getTime() - ERROR_RETENTION_DAYS * DAY_MS)
  try {
    return await dbQuery({
      name: 'monitoring.record',
      transaction: async (tx): Promise<RecordResult> => {
        await tx.execute(sql`select pg_advisory_xact_lock(${WRITER_LOCK_KEY})`)
        await tx.delete(errorEvents).where(
          inArray(
            errorEvents.fingerprint,
            tx
              .select({ fingerprint: errorEvents.fingerprint })
              .from(errorEvents)
              .where(lt(errorEvents.lastSeenAt, cutoff))
              .orderBy(asc(errorEvents.lastSeenAt))
              .limit(MAX_PURGE_PER_RECORD),
          ),
        )
        // The digest of the latest occurrence, to find its log line; an occurrence without one keeps the old.
        const counted = await tx
          .update(errorEvents)
          .set({
            count: sql`${errorEvents.count} + 1`,
            lastSeenAt: now,
            digest: sql`coalesce(${report.digest}, ${errorEvents.digest})`,
          })
          .where(eq(errorEvents.fingerprint, report.fingerprint))
          .returning({ fingerprint: errorEvents.fingerprint })
        if (counted.length > 0) return 'recorded'

        const [rows] = await tx.select({ total: count() }).from(errorEvents)
        if ((rows?.total ?? 0) >= MAX_ERROR_EVENTS) return 'full'
        await tx.insert(errorEvents).values({
          fingerprint: report.fingerprint,
          routeType: report.routeType,
          routePath: report.routePath,
          method: report.method,
          digest: report.digest,
          errorName: report.errorName,
          message: report.message,
          firstSeenAt: now,
          lastSeenAt: now,
        })
        return 'recorded'
      },
    })
  } catch {
    // dbQuery's error text is fixed already, but nothing of it is needed here: the line says only that it failed.
    console.error('monitoring: recording failed')
    return 'failed'
  }
}

/** The only route paths that a handled error may be recorded for: constants, never `request.url` (it can carry a query). */
export type HandledRoutePath = '/api/webhooks/payment'

/**
 * For an error that was caught and answered (the webhook's 503, ADR-0021) and so never reaches onRequestError.
 * `routePath` is a constant of the type above; a new one is a change to the type.
 */
export const recordHandledError = async ({
  routePath,
  method,
  error,
}: {
  routePath: HandledRoutePath
  method: string
  error: unknown
}): Promise<void> => {
  try {
    const report = await toErrorReport({ error, method, routeType: 'route', routePath })
    console.error(formatErrorLogLine(report))
    await recordErrorReport({ report, now: new Date() })
  } catch {
    console.error('monitoring: recording failed')
  }
}
