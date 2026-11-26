// The admin entry of monitoring (ADR-0022, ADR-0023): only src/app/admin/** imports it (dependency-cruiser
// `admin-entries-only-from-admin`), as for products. index.ts is the entry of what the shop side reaches
// (instrumentation, the webhook); nothing of the admin is re-exported there. scripts/check-admin-bundle.mjs checks
// the build after `next build`.
export { countRecentErrorsForAdmin, listErrorEventsForAdmin } from '@/features/monitoring/admin-queries'
export {
  ErrorEventsTable,
  ErrorEventsTableSkeleton,
  ErrorEventsTableView,
} from '@/features/monitoring/components/error-events-table'
export type { AdminErrorRow } from '@/features/monitoring/types'
