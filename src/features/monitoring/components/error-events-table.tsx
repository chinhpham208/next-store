import { CursorBlock } from '@/components/ui/cursor-block'
import { Skeleton } from '@/components/ui/skeleton'
import { listErrorEventsForAdmin } from '@/features/monitoring/admin-queries'
import type { AdminErrorRow } from '@/features/monitoring/types'
import { formatDateTime } from '@/lib/format-date-time'

// /admin/errors (ADR-0022, design-system "Component M6"). A table from md and a list of cards under md, as for the
// products: two DOM blocks, the hidden one under display:none. A lookup table, so no link, no button, no accent: an
// error is not "red". The h1 it is labelled by is the page's.

const HEADING_ID = 'admin-errors-heading'
// The first column has no left padding; the others are 32 px apart (the same table as the products, M5).
const HEAD_FIRST = 'whitespace-nowrap border-b border-border-strong pb-3 text-sm font-medium text-muted-foreground'
const HEAD = `${HEAD_FIRST} pl-8`
const CELL_FIRST = 'border-b border-border py-4 align-top'
const CELL = `${CELL_FIRST} pl-8`

const Detail = ({ row }: { row: AdminErrorRow }) => (
  <>
    <p className="font-semibold">{row.errorName}</p>
    {row.message !== null && <p className="font-mono text-sm break-words text-muted-foreground">{row.message}</p>}
    {row.digest !== null && <p className="font-mono text-xs text-muted-foreground">{`digest ${row.digest}`}</p>}
  </>
)

const EmptyState = () => (
  <div className="flex flex-col items-start gap-4 rounded-md bg-surface-muted px-6 py-10 md:p-16">
    <CursorBlock className="size-8" />
    <p className="text-xl font-semibold md:text-2xl">Chưa ghi nhận lỗi nào trong 30 ngày.</p>
    <p className="text-muted-foreground">Lỗi mới sẽ hiện ở đây.</p>
  </div>
)

export type ErrorEventsTableViewProps = { rows: AdminErrorRow[] }

export const ErrorEventsTableView = ({ rows }: ErrorEventsTableViewProps) => (
  <>
    <p className="max-w-xl text-muted-foreground md:text-lg">
      100 nhóm lỗi gần nhất, lỗi giống nhau gộp một dòng. Chỉ lưu tên lỗi, route và thông điệp cố định; không lưu cookie,
      query hay header.
    </p>
    {rows.length === 0 ? (
      <EmptyState />
    ) : (
      <>
        <table aria-labelledby={HEADING_ID} className="hidden w-full border-collapse text-left md:table">
          <thead>
            <tr>
              <th scope="col" className={HEAD_FIRST}>
                Lần cuối
              </th>
              <th scope="col" className={`${HEAD} text-right`}>
                Số lần
              </th>
              <th scope="col" className={HEAD}>
                Loại
              </th>
              <th scope="col" className={HEAD}>
                Route
              </th>
              <th scope="col" className={`${HEAD} w-full`}>
                Lỗi
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.fingerprint}>
                <td className={`${CELL_FIRST} font-mono text-sm whitespace-nowrap`}>{formatDateTime(row.lastSeenAt)}</td>
                <td className={`${CELL} text-right font-mono font-medium`}>{row.count}</td>
                <td className={`${CELL} font-mono text-sm whitespace-nowrap`}>{row.routeType}</td>
                <td className={CELL}>
                  <span className="font-mono text-sm whitespace-nowrap">
                    <b className="font-semibold">{row.method}</b> {row.routePath}
                  </span>
                </td>
                <td className={CELL}>
                  <Detail row={row} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <ul aria-labelledby={HEADING_ID} className="flex flex-col border-b border-border md:hidden">
          {rows.map((row) => (
            <li key={row.fingerprint} className="flex flex-col gap-1 border-t border-border py-4">
              <p className="font-mono text-sm font-semibold break-all">{`${row.method} ${row.routePath}`}</p>
              <Detail row={row} />
              <p className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-sm">
                <span>{`${row.count} lần`}</span>
                <span>{row.routeType}</span>
                <span>{formatDateTime(row.lastSeenAt)}</span>
              </p>
            </li>
          ))}
        </ul>
      </>
    )}
  </>
)

/** Reads the rows (the read checks the session itself, ADR-0018) inside the page's <Suspense>. */
export const ErrorEventsTable = async () => <ErrorEventsTableView rows={await listErrorEventsForAdmin()} />

const SKELETON_ROWS = 5
const SKELETON_CARDS = 4

export const ErrorEventsTableSkeleton = () => (
  <div aria-busy="true" className="flex flex-col gap-6 md:gap-8">
    <p className="sr-only">Đang tải…</p>
    <Skeleton className="h-6 w-75 md:h-7 md:w-140" />
    <table aria-hidden="true" className="hidden w-full border-collapse md:table">
      <thead>
        <tr>
          <th className={HEAD_FIRST}>Lần cuối</th>
          <th className={`${HEAD} text-right`}>Số lần</th>
          <th className={HEAD}>Loại</th>
          <th className={HEAD}>Route</th>
          <th className={`${HEAD} w-full`}>Lỗi</th>
        </tr>
      </thead>
      <tbody>
        {Array.from({ length: SKELETON_ROWS }, (_, index) => (
          <tr key={index}>
            <td className={CELL_FIRST}>
              <Skeleton className="h-5 w-28" />
            </td>
            <td className={CELL}>
              <Skeleton className="ml-auto h-6 w-8" />
            </td>
            <td className={CELL}>
              <Skeleton className="h-5 w-14" />
            </td>
            <td className={CELL}>
              <Skeleton className="h-5 w-48" />
            </td>
            <td className={CELL}>
              <Skeleton className="h-6 w-3/5" />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
    <ul aria-hidden="true" className="flex flex-col border-b border-border md:hidden">
      {Array.from({ length: SKELETON_CARDS }, (_, index) => (
        <li key={index} className="flex flex-col gap-1 border-t border-border py-4">
          <Skeleton className="h-5 w-4/5" />
          <Skeleton className="h-6 w-2/5" />
          <Skeleton className="mt-1 h-5 w-3/5" />
        </li>
      ))}
    </ul>
  </div>
)
