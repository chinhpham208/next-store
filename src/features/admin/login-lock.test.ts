import { count } from 'drizzle-orm'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { adminLoginFailures } from '@/db'
import { db } from '@/db/client'
import { runMigrations } from '@/db/migrate'
import { loginAction } from '@/features/admin/actions'
import type { LoginState } from '@/features/admin/types'

// NS-132 (audit M5 M1): loginAction with the real lock on PGlite, from x-forwarded-for to the stored rows. The audit
// measured that 10 addresses of one IPv6 /64, 5 wrong passwords each, kept the admin out from every other address
// (the global limit), and could keep doing so for as long as the attacker kept sending. Now the lock is per IPv4
// address or IPv6 /64 only (ADR-0018 "Sửa theo audit M5 (NS-132)").

const request = vi.hoisted(() => ({ headers: new Headers(), set: vi.fn() }))
vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({ get: () => undefined, set: request.set, delete: vi.fn() })),
  headers: vi.fn(async () => request.headers),
}))
vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT ${url}`)
  }),
}))
vi.mock('next/server', () => ({ connection: vi.fn(async () => {}) }))

// Fake values, test only.
const PASSWORD = 'test-admin-password-0123'
const SECRET = 'test-session-secret-0123456789abcdef'
const IDLE: LoginState = { status: 'idle' }
const WRONG = { status: 'error', error: 'wrong-password' }
const LOCKED = { status: 'error', error: 'locked' }

const attempt = async (ip: string, password: string): Promise<LoginState | 'signed-in'> => {
  request.headers = new Headers({ 'x-forwarded-for': ip })
  const data = new FormData()
  data.set('password', password)
  try {
    return await loginAction(IDLE, data)
  } catch (error) {
    if (error instanceof Error && error.message === 'NEXT_REDIRECT /admin/products') return 'signed-in'
    throw error
  }
}

const rows = async () => (await db.select({ n: count() }).from(adminLoginFailures))[0]?.n

beforeAll(async () => {
  await runMigrations()
})

beforeEach(async () => {
  await db.delete(adminLoginFailures)
  vi.stubEnv('ADMIN_PASSWORD', PASSWORD)
  vi.stubEnv('SESSION_SECRET', SECRET)
  vi.stubEnv('SITE_URL', 'http://localhost:3100')
  request.set.mockClear()
})

describe('login lock per IPv4 address or IPv6 /64 (NS-132)', () => {
  it('10 addresses of one /64 share 5 tries, and the 11th is locked too', async () => {
    const answers = []
    for (let host = 1; host <= 10; host += 1) {
      for (let n = 0; n < 5; n += 1) answers.push(await attempt(`2001:db8:abcd:12::${host.toString(16)}`, 'wrong'))
    }
    expect(answers.slice(0, 5)).toEqual(Array(5).fill(WRONG))
    expect(answers.slice(5)).toEqual(Array(45).fill(LOCKED))
    // Locked tries are not recorded: the /64 wrote 5 rows, not 50.
    expect(await rows()).toBe(5)
    // The right password from an 11th address of the same /64, in another spelling: locked, never compared.
    expect(await attempt('2001:0DB8:ABCD:0012:0000:0000:0000:0011', PASSWORD)).toEqual(LOCKED)
    expect(request.set).not.toHaveBeenCalled()
  })

  it('another /64 and another IPv4 address still sign in with the right password', async () => {
    for (let host = 1; host <= 10; host += 1) {
      for (let n = 0; n < 5; n += 1) await attempt(`2001:db8:abcd:12::${host}`, 'wrong')
    }
    expect(await attempt('2001:db8:abcd:13::1', PASSWORD)).toBe('signed-in')
    expect(await attempt('192.0.2.200', PASSWORD)).toBe('signed-in')
    expect(await attempt('198.51.100.250', PASSWORD)).toBe('signed-in')
  })

  it('60 wrong passwords from 12 addresses do not lock the admin out of a new address', async () => {
    const sources = [
      ...Array.from({ length: 6 }, (_, n) => `203.0.113.${n + 1}`),
      ...Array.from({ length: 6 }, (_, n) => `2001:db8:${n + 1}::1`),
    ]
    for (const ip of sources) {
      for (let n = 0; n < 5; n += 1) expect(await attempt(ip, 'wrong')).toEqual(WRONG)
    }
    expect(await rows()).toBe(60)
    // Each source is locked on its own…
    for (const ip of sources) expect(await attempt(ip, PASSWORD)).toEqual(LOCKED)
    // …and nobody else is: there is no global lock any more.
    expect(await attempt('192.0.2.200', PASSWORD)).toBe('signed-in')
    expect(await attempt('2001:db8:ffff:1::1', PASSWORD)).toBe('signed-in')
  })

  it('an IPv4-mapped IPv6 address counts as the IPv4 address', async () => {
    for (let n = 0; n < 5; n += 1) await attempt('::ffff:192.0.2.7', 'wrong')
    expect(await attempt('192.0.2.7', PASSWORD)).toEqual(LOCKED)
    expect(await attempt('::FFFF:C000:0207', PASSWORD)).toEqual(LOCKED)
    expect(await attempt('192.0.2.8', PASSWORD)).toBe('signed-in')
  })
})
