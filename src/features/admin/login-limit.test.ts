import { count, lt } from 'drizzle-orm'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { adminLoginFailures } from '@/db'
import { db } from '@/db/client'
import { runMigrations } from '@/db/migrate'
import {
  FAILURE_RETENTION_HOURS,
  isLoginLocked,
  LOGIN_WINDOW_MINUTES,
  MAX_FAILURES_GLOBAL,
  MAX_FAILURES_PER_IP,
  purgeLoginFailures,
  recordLoginFailure,
} from '@/features/admin/login-limit'

// The real dbQuery on PGlite, wrapped only to see the names and the kind of work each call sends.
const calls = vi.hoisted(() => ({ log: [] as { name: string; transaction: boolean }[] }))
vi.mock('@/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/db')>()
  const dbQuery: typeof actual.dbQuery = (input) => {
    calls.log.push({ name: input.name, transaction: input.transaction !== undefined })
    return actual.dbQuery(input)
  }
  return { ...actual, dbQuery }
})

const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS
const NOW = new Date('2026-11-25T08:00:00.000Z')
const minutesAgo = (minutes: number) => new Date(NOW.getTime() - minutes * MINUTE_MS)
const hoursAgo = (hours: number) => new Date(NOW.getTime() - hours * HOUR_MS)

// HMAC hex digests in production; any 64-hex string here.
const hashOf = (n: number) => n.toString(16).padStart(64, '0')
const IP = hashOf(1)
const OTHER_IP = hashOf(2)

const insertFailures = async (rows: { ipHash: string; failedAt: Date }[]) => {
  if (rows.length === 0) return
  await db.insert(adminLoginFailures).values(rows.map((row) => ({ id: crypto.randomUUID(), ...row })))
}

const total = async () => (await db.select({ n: count() }).from(adminLoginFailures))[0]?.n
const olderThan = async (date: Date) =>
  (await db.select({ n: count() }).from(adminLoginFailures).where(lt(adminLoginFailures.failedAt, date)))[0]?.n

beforeAll(async () => {
  await runMigrations()
})

beforeEach(async () => {
  await db.delete(adminLoginFailures)
  calls.log = []
})

describe('limits (ADR-0018 8A)', () => {
  it('are 5 per IP and 50 overall in 15 minutes, kept for 24 hours', () => {
    expect({ LOGIN_WINDOW_MINUTES, MAX_FAILURES_PER_IP, MAX_FAILURES_GLOBAL, FAILURE_RETENTION_HOURS }).toEqual({
      LOGIN_WINDOW_MINUTES: 15,
      MAX_FAILURES_PER_IP: 5,
      MAX_FAILURES_GLOBAL: 50,
      FAILURE_RETENTION_HOURS: 24,
    })
  })
})

describe('isLoginLocked', () => {
  it('locks an IP after 5 failures in 15 minutes', async () => {
    for (let n = 0; n < 4; n += 1) await recordLoginFailure({ ipHash: IP, now: minutesAgo(10 - n) })
    expect(await isLoginLocked({ ipHash: IP, now: NOW })).toBe(false)
    await recordLoginFailure({ ipHash: IP, now: minutesAgo(1) })
    expect(await isLoginLocked({ ipHash: IP, now: NOW })).toBe(true)
    // Another address is not locked by them: 5 is far below the global limit.
    expect(await isLoginLocked({ ipHash: OTHER_IP, now: NOW })).toBe(false)
  })

  it('does not lock after 5 failures spread over more than 15 minutes', async () => {
    await insertFailures([
      { ipHash: IP, failedAt: minutesAgo(LOGIN_WINDOW_MINUTES + 1) },
      ...[12, 9, 6, 3].map((minutes) => ({ ipHash: IP, failedAt: minutesAgo(minutes) })),
    ])
    expect(await isLoginLocked({ ipHash: IP, now: NOW })).toBe(false)
  })

  it('locks everyone after 50 failures in 15 minutes', async () => {
    // 50 addresses with one failure each: no address reaches its own limit.
    await insertFailures(Array.from({ length: 49 }, (_, n) => ({ ipHash: hashOf(100 + n), failedAt: minutesAgo(5) })))
    expect(await isLoginLocked({ ipHash: IP, now: NOW })).toBe(false)
    await insertFailures([{ ipHash: hashOf(200), failedAt: minutesAgo(2) }])
    expect(await isLoginLocked({ ipHash: IP, now: NOW })).toBe(true)
  })

  it('counts both limits in one query named admin.login-lock', async () => {
    await isLoginLocked({ ipHash: IP, now: NOW })
    expect(calls.log).toEqual([{ name: 'admin.login-lock', transaction: false }])
  })
})

describe('recordLoginFailure', () => {
  it('inserts one row with a server-made id, the hash and the time', async () => {
    await recordLoginFailure({ ipHash: IP, now: NOW })
    const rows = await db.select().from(adminLoginFailures)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ ipHash: IP, failedAt: NOW })
    expect(rows[0]?.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(calls.log).toEqual([{ name: 'admin.login-failure', transaction: true }])
  })

  it('purges failures older than one day, at most 100 per call', async () => {
    await insertFailures(
      Array.from({ length: 130 }, (_, n) => ({ ipHash: hashOf(n), failedAt: hoursAgo(FAILURE_RETENTION_HOURS + 1 + n) })),
    )
    // Inside the day: kept.
    await insertFailures([{ ipHash: OTHER_IP, failedAt: hoursAgo(FAILURE_RETENTION_HOURS - 1) }])
    await recordLoginFailure({ ipHash: IP, now: NOW })
    expect(await olderThan(hoursAgo(FAILURE_RETENTION_HOURS))).toBe(30)
    expect(await total()).toBe(30 + 1 + 1)
    // The oldest go first: what is left are the 30 most recent of the old rows.
    expect(await olderThan(hoursAgo(FAILURE_RETENTION_HOURS + 1 + 100))).toBe(0)
  })
})

describe('purgeLoginFailures (audit PR #103 L2)', () => {
  it('deletes at most 100 failures older than one day and nothing newer', async () => {
    await insertFailures(
      Array.from({ length: 120 }, (_, n) => ({ ipHash: hashOf(n), failedAt: hoursAgo(FAILURE_RETENTION_HOURS + 1) })),
    )
    await insertFailures([{ ipHash: IP, failedAt: minutesAgo(1) }])
    await purgeLoginFailures(NOW)
    expect(await total()).toBe(20 + 1)
    await purgeLoginFailures(NOW)
    expect(await total()).toBe(1)
    expect(calls.log.map((call) => call.name)).toEqual(['admin.login-purge', 'admin.login-purge'])
  })
})
