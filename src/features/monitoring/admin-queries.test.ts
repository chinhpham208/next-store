import { readFileSync } from 'node:fs'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { errorEvents } from '@/db'
import { db } from '@/db/client'
import { runMigrations } from '@/db/migrate'
import { countRecentErrorsForAdmin, listErrorEventsForAdmin } from '@/features/monitoring/admin-queries'

const session = vi.hoisted(() => ({ hasAdminSession: vi.fn<() => Promise<boolean>>() }))
vi.mock('@/features/admin', () => ({ hasAdminSession: session.hasAdminSession }))

// The real dbQuery on PGlite, wrapped only to see which queries run.
const calls = vi.hoisted(() => ({ names: [] as string[] }))
vi.mock('@/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/db')>()
  const dbQuery: typeof actual.dbQuery = (input) => {
    calls.names.push(input.name)
    return actual.dbQuery(input)
  }
  return { ...actual, dbQuery }
})

const HOUR_MS = 3_600_000
const NOW = new Date('2026-11-26T03:00:00.000Z')
const hoursAgo = (hours: number) => new Date(NOW.getTime() - hours * HOUR_MS)

const insertRows = (rows: { key: string; lastSeenAt: Date; count?: number }[]) =>
  db.insert(errorEvents).values(
    rows.map(({ key, lastSeenAt, count }) => ({
      fingerprint: key,
      routeType: 'render',
      routePath: `/app/${key}`,
      method: 'GET',
      errorName: 'Error',
      count: count ?? 1,
      firstSeenAt: lastSeenAt,
      lastSeenAt,
    })),
  )

beforeAll(async () => {
  await runMigrations()
})

beforeEach(async () => {
  calls.names = []
  await db.delete(errorEvents)
  session.hasAdminSession.mockResolvedValue(true)
  vi.useFakeTimers({ toFake: ['Date'], now: NOW })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('listErrorEventsForAdmin', () => {
  it('listErrorEventsForAdmin throws without a session before any query', async () => {
    session.hasAdminSession.mockResolvedValue(false)
    await expect(listErrorEventsForAdmin()).rejects.toThrow('admin: no session')
    expect(calls.names).toEqual([])
  })

  it('lists the newest 100 by last seen', async () => {
    await insertRows(Array.from({ length: 105 }, (_, index) => ({ key: `e${String(index).padStart(3, '0')}`, lastSeenAt: hoursAgo(index + 1) })))
    const rows = await listErrorEventsForAdmin()
    expect(rows).toHaveLength(100)
    expect(rows[0]?.fingerprint).toBe('e000')
    expect(rows.at(-1)?.fingerprint).toBe('e099')
    expect(rows.map((row) => row.lastSeenAt.getTime())).toEqual(rows.map((row) => row.lastSeenAt.getTime()).sort((a, b) => b - a))
    expect(calls.names).toEqual(['monitoring.admin-list'])
  })

  it('returns every field the table shows', async () => {
    await insertRows([{ key: 'one', lastSeenAt: hoursAgo(1), count: 7 }])
    expect(await listErrorEventsForAdmin()).toEqual([
      {
        fingerprint: 'one',
        routeType: 'render',
        routePath: '/app/one',
        method: 'GET',
        digest: null,
        errorName: 'Error',
        message: null,
        count: 7,
        lastSeenAt: hoursAgo(1),
      },
    ])
  })
})

describe('countRecentErrorsForAdmin', () => {
  it('throws without a session before any query', async () => {
    session.hasAdminSession.mockResolvedValue(false)
    await expect(countRecentErrorsForAdmin()).rejects.toThrow('admin: no session')
    expect(calls.names).toEqual([])
  })

  it('counts the groups seen in the last 24 hours, not the sum of their counts', async () => {
    await insertRows([
      { key: 'a', lastSeenAt: hoursAgo(1), count: 40 },
      { key: 'b', lastSeenAt: hoursAgo(23), count: 5 },
      { key: 'c', lastSeenAt: hoursAgo(25), count: 9 },
    ])
    expect(await countRecentErrorsForAdmin()).toBe(2)
  })

  it('is 0 for an empty table', async () => {
    expect(await countRecentErrorsForAdmin()).toBe(0)
  })
})

describe('the admin reads of monitoring', () => {
  it('start with the session check (the static net of admin-session-checks.test.ts reads this file)', () => {
    const source = readFileSync('src/features/monitoring/admin-queries.ts', 'utf8')
    expect(source.match(/if \(!\(await hasAdminSession\(\)\)\) throw new Error\('admin: no session'\)/g)).toHaveLength(2)
  })
})
