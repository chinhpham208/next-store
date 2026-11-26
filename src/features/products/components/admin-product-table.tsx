import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { buttonVariants } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { listProductsForAdmin } from '@/features/products/admin-queries'
import { renderProductName } from '@/features/products/components/product-name'
import type { AdminProductRow } from '@/features/products/types'
import { formatPrice } from '@/lib/format-price'

// /admin/products (US-13, plan M5 Task 10, design-system "Component M5"). A table from md and a list of cards under
// md (Gate 2 decision 7): two DOM blocks, the hidden one under display:none, so it is out of the accessibility tree
// and there is exactly one "Sửa {tên}" link per product on screen. The h1 it is labelled by is the page's.

const HEADING_ID = 'admin-products-heading'
const NUMBER_HEAD = 'border-b border-border-strong pb-3 pl-8 text-right text-sm font-medium text-muted-foreground'
const CELL = 'border-b border-border py-3 align-middle'
const NUMBER_CELL = `${CELL} pl-8 text-right`

const EditLink = ({ row }: { row: AdminProductRow }) => (
  <Link
    href={`/admin/products/${row.slug}`}
    aria-label={`Sửa ${row.name}`}
    className={buttonVariants({ variant: 'secondary', className: 'px-4' })}
  >
    Sửa
  </Link>
)

const NameAndSlug = ({ row }: { row: AdminProductRow }) => (
  <>
    <p className="font-semibold text-pretty break-words">{renderProductName(row.name)}</p>
    <p className="font-mono text-sm break-all text-muted-foreground">{row.slug}</p>
  </>
)

const Stock = ({ stock }: { stock: number }) =>
  stock > 0 ? <span className="font-mono font-medium">{stock}</span> : <Badge variant="sold-out">Hết hàng</Badge>

export type AdminProductTableViewProps = { rows: AdminProductRow[] }

export const AdminProductTableView = ({ rows }: AdminProductTableViewProps) => (
  <>
    <p className="max-w-xl text-muted-foreground md:text-lg">
      {`${rows.length} sản phẩm. Sửa được tên, giá, mô tả, tồn kho; ảnh, danh mục và slug đổi qua mã nguồn.`}
    </p>
    <table aria-labelledby={HEADING_ID} className="hidden w-full border-collapse text-left md:table">
      <thead>
        <tr>
          <th scope="col" className="w-full border-b border-border-strong pb-3 text-sm font-medium text-muted-foreground">
            Sản phẩm
          </th>
          <th scope="col" className={NUMBER_HEAD}>
            Giá
          </th>
          <th scope="col" className={NUMBER_HEAD}>
            Tồn kho
          </th>
          <th scope="col" className={NUMBER_HEAD}>
            <span className="sr-only">Thao tác</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.slug}>
            <td className={CELL}>
              <NameAndSlug row={row} />
            </td>
            <td className={NUMBER_CELL}>
              <span className="font-mono font-medium whitespace-nowrap">{formatPrice(row.price)}</span>
            </td>
            {/* nowrap: the column is as narrow as its header, and "Hết hàng" broke onto two lines (NS-125, vs the mock). */}
            <td className={`${NUMBER_CELL} whitespace-nowrap`}>
              <Stock stock={row.stock} />
            </td>
            <td className={NUMBER_CELL}>
              <EditLink row={row} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
    <ul aria-labelledby={HEADING_ID} className="flex flex-col border-b border-border md:hidden">
      {rows.map((row) => (
        <li key={row.slug} className="flex items-start justify-between gap-4 border-t border-border py-4">
          <div className="flex min-w-0 flex-col gap-1">
            <NameAndSlug row={row} />
            <p className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
              <span className="font-mono font-medium whitespace-nowrap">{formatPrice(row.price)}</span>
              {row.stock > 0 ? (
                <span>
                  Tồn kho <span className="font-mono font-medium">{row.stock}</span>
                </span>
              ) : (
                <Badge variant="sold-out">Hết hàng</Badge>
              )}
            </p>
          </div>
          <EditLink row={row} />
        </li>
      ))}
    </ul>
  </>
)

/** Reads the rows (the read checks the session itself, ADR-0018) inside the page's <Suspense>. */
export const AdminProductTable = async () => <AdminProductTableView rows={await listProductsForAdmin()} />

const SKELETON_ROWS = 5
const SKELETON_CARDS = 4

export const AdminProductTableSkeleton = () => (
  <div aria-busy="true" className="flex flex-col gap-6 md:gap-8">
    <p className="sr-only">Đang tải…</p>
    <Skeleton className="h-6 w-80 max-w-full md:h-7 md:w-140" />
    <table aria-hidden="true" className="hidden w-full border-collapse md:table">
      <thead>
        <tr>
          <th className="w-full border-b border-border-strong pb-3 text-left text-sm font-medium text-muted-foreground">
            Sản phẩm
          </th>
          <th className={NUMBER_HEAD}>Giá</th>
          <th className={NUMBER_HEAD}>Tồn kho</th>
          <th className={NUMBER_HEAD} />
        </tr>
      </thead>
      <tbody>
        {Array.from({ length: SKELETON_ROWS }, (_, index) => (
          <tr key={index}>
            <td className={CELL}>
              <div className="flex flex-col gap-1">
                <Skeleton className="h-6 w-3/5" />
                <Skeleton className="h-5 w-1/3" />
              </div>
            </td>
            <td className={NUMBER_CELL}>
              <Skeleton className="ml-auto h-6 w-24" />
            </td>
            <td className={NUMBER_CELL}>
              <Skeleton className="ml-auto h-6 w-8" />
            </td>
            <td className={NUMBER_CELL}>
              <Skeleton className="ml-auto h-11 w-16 rounded-md" />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
    <ul aria-hidden="true" className="flex flex-col border-b border-border md:hidden">
      {Array.from({ length: SKELETON_CARDS }, (_, index) => (
        <li key={index} className="flex items-start justify-between gap-4 border-t border-border py-4">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <Skeleton className="h-6 w-4/5" />
            <Skeleton className="h-5 w-1/2" />
            <Skeleton className="mt-1 h-5 w-3/5" />
          </div>
          <Skeleton className="h-11 w-16 rounded-md" />
        </li>
      ))}
    </ul>
  </div>
)
