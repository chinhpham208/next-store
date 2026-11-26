import { count, eq } from 'drizzle-orm'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { errorEvents } from '@/db'
import { db } from '@/db/client'
import { runMigrations } from '@/db/migrate'
import { toErrorReport, type ErrorReport } from '@/features/monitoring/report'
import {
  ERROR_RETENTION_DAYS,
  MAX_ERROR_EVENTS,
  MAX_PURGE_PER_RECORD,
  MAX_RECORDS_PER_MINUTE,
  recordErrorReport,
  recordHandledError,
} from '@/features/monitoring/store'

// The real dbQuery on PGlite; a test switches it to a failing database to see that nothing escapes.
const broken = vi.hoisted(() => ({ on: false }))
vi.mock('@/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/db')>()
  const dbQuery: typeof actual.dbQuery = (input) =>
    broken.on ? Promise.reject(new Error(`database query failed: ${input.name} (08006)`)) : actual.dbQuery(input)
  return { ...actual, dbQuery }
})

const DAY_MS = 86_400_000
const HOUR_MS = 3_600_000
// The per-minute counter lives in the memory of the module and tests share it, so each test starts at its own hour:
// an earlier test's records are more than a minute old by then.
let hour = 0
let now = new Date(0)
const daysAgo = (days: number) => new Date(now.getTime() - days * DAY_MS)

const reportFor = async (routePath: string, error: unknown = new Error('x')): Promise<ErrorReport> =>
  toErrorReport({ error, method: 'GET', routeType: 'render', routePath })

const rowOf = async (fingerprint: string) => {
  const [row] = await db.select().from(errorEvents).where(eq(errorEvents.fingerprint, fingerprint))
  return row
}

const rowCount = async () => {
  const [row] = await db.select({ total: count() }).from(errorEvents)
  return row?.total ?? 0
}

// Straight into the table: the store's own writes are what the tests below check.
const fillRows = async (total: number, lastSeenAt: Date, prefix: string) => {
  await db.insert(errorEvents).values(
    Array.from({ length: total }, (_, index) => ({
      fingerprint: `${prefix}-${index}`,
      routeType: 'render',
      routePath: '/app/x',
      method: 'GET',
      errorName: 'Error',
      lastSeenAt,
      firstSeenAt: lastSeenAt,
    })),
  )
}

beforeAll(async () => {
  await runMigrations()
})

beforeEach(async () => {
  hour += 1
  now = new Date(Date.UTC(2026, 10, 26) + hour * 2 * HOUR_MS)
  broken.on = false
  await db.delete(errorEvents)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('recordErrorReport', () => {
  it('records a new fingerprint and counts repeats', async () => {
    const first = await reportFor('/app/products/[slug]', Object.assign(new Error('x'), { digest: '111' }))
    expect(await recordErrorReport({ report: first, now })).toBe('recorded')
    const stored = await rowOf(first.fingerprint)
    expect(stored).toMatchObject({
      routeType: 'render',
      routePath: '/app/products/[slug]',
      method: 'GET',
      errorName: 'Error',
      message: null,
      digest: '111',
      count: 1,
    })
    expect(stored?.firstSeenAt).toEqual(now)

    // The same error again, later, with another digest and a different message: one row, count up, newest digest.
    const later = new Date(now.getTime() + 5000)
    const again = await reportFor('/app/products/[slug]', Object.assign(new Error('y'), { digest: '222' }))
    expect(await recordErrorReport({ report: again, now: later })).toBe('recorded')
    expect(await rowCount()).toBe(1)
    expect(await rowOf(first.fingerprint)).toMatchObject({ count: 2, digest: '222' })
    expect((await rowOf(first.fingerprint))?.lastSeenAt).toEqual(later)
    expect((await rowOf(first.fingerprint))?.firstSeenAt).toEqual(now)
  })

  it('keeps the last digest when the repeat has none', async () => {
    const first = await reportFor('/app/a', Object.assign(new Error('x'), { digest: '111' }))
    await recordErrorReport({ report: first, now })
    await recordErrorReport({ report: await reportFor('/app/a'), now })
    expect(await rowOf(first.fingerprint)).toMatchObject({ count: 2, digest: '111' })
  })

  it('purges old rows even when the table is full', async () => {
    // 500 rows, five of them past 30 days: a table that is full of live rows is the case this must not stick on.
    await fillRows(MAX_ERROR_EVENTS - 5, daysAgo(1), 'live')
    await fillRows(5, daysAgo(ERROR_RETENTION_DAYS + 1), 'old')
    expect(await rowCount()).toBe(MAX_ERROR_EVENTS)
    const report = await reportFor('/app/new')
    expect(await recordErrorReport({ report, now })).toBe('recorded')
    expect(await rowOf(report.fingerprint)).toMatchObject({ count: 1 })
    expect(await rowCount()).toBe(MAX_ERROR_EVENTS - 5 + 1)
  })

  it('purges old rows before it decides the table is full, even for a row only old rows could make room for', async () => {
    await fillRows(MAX_ERROR_EVENTS, daysAgo(ERROR_RETENTION_DAYS + 2), 'old')
    const report = await reportFor('/app/new')
    expect(await recordErrorReport({ report, now })).toBe('recorded')
    expect(await rowCount()).toBe(MAX_ERROR_EVENTS - MAX_PURGE_PER_RECORD + 1)
  })

  it('purges at most 50 rows older than 30 days', async () => {
    await fillRows(60, daysAgo(ERROR_RETENTION_DAYS + 1), 'old')
    await fillRows(3, daysAgo(ERROR_RETENTION_DAYS - 1), 'fresh')
    expect(await recordErrorReport({ report: await reportFor('/app/new'), now })).toBe('recorded')
    const rows = await db.select({ fingerprint: errorEvents.fingerprint }).from(errorEvents)
    expect(rows.filter(({ fingerprint }) => fingerprint.startsWith('old-'))).toHaveLength(10)
    expect(rows.filter(({ fingerprint }) => fingerprint.startsWith('fresh-'))).toHaveLength(3)
    expect(rows).toHaveLength(14)
  })

  it('purges the oldest rows first', async () => {
    await fillRows(MAX_PURGE_PER_RECORD, daysAgo(ERROR_RETENTION_DAYS + 5), 'oldest')
    await fillRows(1, daysAgo(ERROR_RETENTION_DAYS + 1), 'old')
    await recordErrorReport({ report: await reportFor('/app/new'), now })
    expect(await rowOf('old-0')).toBeDefined()
    expect(await rowOf('oldest-0')).toBeUndefined()
  })

  it('inserts no new fingerprint past 500 rows but still counts known ones', async () => {
    await fillRows(MAX_ERROR_EVENTS - 1, daysAgo(1), 'live')
    const known = await reportFor('/app/known')
    expect(await recordErrorReport({ report: known, now })).toBe('recorded')
    expect(await rowCount()).toBe(MAX_ERROR_EVENTS)

    const fresh = await reportFor('/app/fresh')
    expect(await recordErrorReport({ report: fresh, now })).toBe('full')
    expect(await rowOf(fresh.fingerprint)).toBeUndefined()
    expect(await rowCount()).toBe(MAX_ERROR_EVENTS)

    expect(await recordErrorReport({ report: known, now })).toBe('recorded')
    expect(await rowOf(known.fingerprint)).toMatchObject({ count: 2 })
    expect(await rowCount()).toBe(MAX_ERROR_EVENTS)
  })

  it('stops writing after 30 records a minute in one instance', async () => {
    const report = await reportFor('/app/burst')
    const results: string[] = []
    for (let index = 0; index < MAX_RECORDS_PER_MINUTE + 5; index += 1) {
      results.push(await recordErrorReport({ report, now: new Date(now.getTime() + index * 100) }))
    }
    expect(results.filter((result) => result === 'recorded')).toHaveLength(MAX_RECORDS_PER_MINUTE)
    expect(results.slice(MAX_RECORDS_PER_MINUTE)).toEqual(Array(5).fill('throttled'))
    expect(await rowOf(report.fingerprint)).toMatchObject({ count: MAX_RECORDS_PER_MINUTE })
    // A minute later the instance writes again.
    const later = new Date(now.getTime() + 61_000)
    expect(await recordErrorReport({ report, now: later })).toBe('recorded')
  })

  it('counts a failed attempt against the limit: a dead database is not tried more than 30 times a minute', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    broken.on = true
    const report = await reportFor('/app/dead')
    const results: string[] = []
    for (let index = 0; index < MAX_RECORDS_PER_MINUTE + 3; index += 1) {
      results.push(await recordErrorReport({ report, now }))
    }
    expect(results.filter((result) => result === 'failed')).toHaveLength(MAX_RECORDS_PER_MINUTE)
    expect(results.filter((result) => result === 'throttled')).toHaveLength(3)
  })

  it('returns failed instead of throwing when the database fails', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    broken.on = true
    await expect(recordErrorReport({ report: await reportFor('/app/x'), now })).resolves.toBe('failed')
    // A fixed line, nothing of the error that was thrown.
    expect(log.mock.calls).toEqual([['monitoring: recording failed']])
  })
})

describe('recordHandledError', () => {
  it('recordHandledError stores only the fixed route path', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    await recordHandledError({
      routePath: '/api/webhooks/payment',
      method: 'POST',
      error: new Error('failed for ?ref=bi-mat cookie=ns_cart'),
    })
    const rows = await db.select().from(errorEvents)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      routeType: 'route',
      routePath: '/api/webhooks/payment',
      method: 'POST',
      errorName: 'Error',
      message: null,
      count: 1,
    })
    expect(JSON.stringify(rows)).not.toMatch(/bi-mat|ns_cart/)
    // Logged like any other error, with the same fixed line.
    expect(vi.mocked(console.error).mock.calls).toEqual([
      ['monitoring: request error {"routeType":"route","routePath":"/api/webhooks/payment","digest":null,"errorName":"Error"}'],
    ])
  })

  it('never throws, whatever the database does', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    broken.on = true
    await expect(
      recordHandledError({ routePath: '/api/webhooks/payment', method: 'POST', error: new Error('x') }),
    ).resolves.toBeUndefined()
  })
})
