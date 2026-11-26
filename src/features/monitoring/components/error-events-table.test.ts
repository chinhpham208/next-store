import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { listErrorEventsForAdmin } from '@/features/monitoring/admin-queries'
import {
  ErrorEventsTable,
  ErrorEventsTableSkeleton,
  ErrorEventsTableView,
} from '@/features/monitoring/components/error-events-table'
import type { AdminErrorRow } from '@/features/monitoring/types'
import { formatDateTime } from '@/lib/format-date-time'

vi.mock('@/features/monitoring/admin-queries', () => ({ listErrorEventsForAdmin: vi.fn() }))

afterEach(() => {
  vi.clearAllMocks()
})

const LAST_SEEN = new Date('2026-11-26T03:04:00.000Z')
const ROWS: AdminErrorRow[] = [
  {
    fingerprint: 'f1',
    routeType: 'render',
    routePath: '/app/products/[slug]',
    method: 'GET',
    digest: '1234567890',
    errorName: 'Error',
    message: 'database query failed: products.list (08006)',
    count: 12,
    lastSeenAt: LAST_SEEN,
  },
  {
    fingerprint: 'f2',
    routeType: 'action',
    routePath: '/app/cart',
    method: 'POST',
    digest: null,
    errorName: 'TypeError',
    message: null,
    count: 1,
    lastSeenAt: LAST_SEEN,
  },
]

const render = (rows: AdminErrorRow[]): string => renderToStaticMarkup(createElement(ErrorEventsTableView, { rows }))
const tableOf = (html: string): string => /<table[\s\S]*<\/table>/.exec(html)?.[0] ?? ''
const listOf = (html: string): string => /<ul[\s\S]*<\/ul>/.exec(html)?.[0] ?? ''

describe('ErrorEventsTableView', () => {
  const html = render(ROWS)

  it('says what is stored, then shows a table from md and a list of cards under md', () => {
    expect(html).toMatch(
      /^<p class="max-w-xl text-muted-foreground md:text-lg">100 nhóm lỗi gần nhất, lỗi giống nhau gộp một dòng\. Chỉ lưu tên lỗi, route và thông điệp cố định; không lưu cookie, query hay header\.<\/p>/,
    )
    expect(tableOf(html)).toMatch(/^<table aria-labelledby="admin-errors-heading" class="hidden w-full [^"]*md:table"/)
    expect(listOf(html)).toMatch(/^<ul aria-labelledby="admin-errors-heading" class="[^"]*md:hidden"/)
  })

  it('has the five column headers', () => {
    const headers = [...tableOf(html).matchAll(/<th scope="col"[^>]*>([\s\S]*?)<\/th>/g)].map((match) => match[1])
    expect(headers).toEqual(['Lần cuối', 'Số lần', 'Loại', 'Route', 'Lỗi'])
  })

  it('shows every row in both blocks: time, count, type, method and route, name, message and digest', () => {
    for (const block of [tableOf(html), listOf(html)]) {
      expect(block).toContain(formatDateTime(LAST_SEEN))
      expect(block).toContain('/app/products/[slug]')
      expect(block).toContain('GET')
      expect(block).toContain('database query failed: products.list (08006)')
      expect(block).toContain('digest 1234567890')
      expect(block).toContain('TypeError')
      expect(block).toContain('render')
      expect(block).toContain('action')
    }
    expect(tableOf(html)).toContain('<b class="font-semibold">POST</b> /app/cart')
    expect(listOf(html)).toContain('12 lần')
    expect(listOf(html)).toContain('1 lần')
  })

  it('writes no message or digest line for a row that has none', () => {
    const second = /<tr>(?:(?!<tr>)[\s\S])*TypeError[\s\S]*?<\/tr>/.exec(tableOf(html))?.[0] ?? ''
    expect(second).not.toContain('digest')
    expect(second).not.toContain('database query')
  })

  it('has no link and no button: a lookup table', () => {
    expect(html).not.toMatch(/<a |<button/)
  })

  it('shows the empty state, with no table, for no rows', () => {
    const empty = render([])
    expect(empty).toContain('Chưa ghi nhận lỗi nào trong 30 ngày.')
    expect(empty).toContain('Lỗi mới sẽ hiện ở đây.')
    expect(empty).not.toMatch(/<table|<ul/)
  })
})

describe('ErrorEventsTable', () => {
  it('reads the rows with the admin read, which checks the session itself', async () => {
    vi.mocked(listErrorEventsForAdmin).mockResolvedValue(ROWS)
    const element = await ErrorEventsTable()
    expect(listErrorEventsForAdmin).toHaveBeenCalledTimes(1)
    expect(renderToStaticMarkup(element)).toContain('/app/products/[slug]')
  })
})

describe('ErrorEventsTableSkeleton', () => {
  it('is busy, announces loading and shows five rows and four cards without text of a row', () => {
    const html = renderToStaticMarkup(createElement(ErrorEventsTableSkeleton))
    expect(html).toContain('aria-busy="true"')
    expect(html).toContain('Đang tải…')
    expect(html.match(/<tr>/g)).toHaveLength(6)
    expect(html.match(/<li /g)).toHaveLength(4)
  })
})
