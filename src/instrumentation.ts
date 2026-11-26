import type { Instrumentation } from 'next'
import { formatErrorLogLine, toErrorReport } from '@/features/monitoring/report'

// Server error tracking (ADR-0022, plan M6 Task 12). This file is bundled for the Node.js runtime and for the edge
// runtime (the proxy), so what it imports at the top is the pure `report.ts` only: no database, no `server-only`, no
// zod. The part that writes (`@/features/monitoring`, with `@/db`) is loaded with import() when the code runs on the
// Node.js runtime for a request that is not the proxy's. dependency-cruiser `instrumentation-narrow` and
// `monitoring-report-pure` check the imports; `npm run check:bundle` check 4 checks the built proxy and edge bundles,
// since a bundler may merge a module that a condition keeps from running.
//
// Of the request only `method` is read. `request.headers` carries the cookies (the admin session, the cart) and
// `request.path` the query; neither is passed on, so neither can be stored or logged (the signature of
// `toErrorReport` has no field for them).
export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  const input = {
    error,
    method: request.method,
    routeType: context.routeType,
    routePath: context.routePath,
  }
  try {
    if (process.env.NEXT_RUNTIME === 'nodejs' && context.routeType !== 'proxy') {
      const { reportRequestError } = await import('@/features/monitoring')
      await reportRequestError(input)
      return
    }
    // The proxy (and the edge runtime): the one fixed line, no database (ADR-0009, ADR-0017).
    console.error(formatErrorLogLine(await toErrorReport(input)))
  } catch {
    // An error while reporting an error must not become a second one: Next.js would report that in turn.
    console.error('monitoring: reporting failed')
  }
}
