import 'server-only'
import { formatErrorLogLine, isRecordable, toErrorReport, type ErrorReportInput } from '@/features/monitoring/report'
import { recordErrorReport } from '@/features/monitoring/store'

// The public API of monitoring for the shop side: reporting and nothing of the admin (that is admin.ts, which only
// src/app/admin/** imports). src/instrumentation.ts loads this file with import() at run time, on the Node.js runtime
// and not for the proxy, so the database is not in the bundle of either (ADR-0022, C4).
export { recordHandledError, type HandledRoutePath } from '@/features/monitoring/store'

/** The one fixed log line first (it survives a dead database), then the table; the proxy and an unknown type only log. */
export const reportRequestError = async (input: ErrorReportInput): Promise<void> => {
  const report = await toErrorReport(input)
  console.error(formatErrorLogLine(report))
  if (!isRecordable(report)) return
  await recordErrorReport({ report, now: new Date() })
}
