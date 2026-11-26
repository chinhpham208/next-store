import { readFileSync } from 'node:fs'
import { cookies } from 'next/headers'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  adminCookieName,
  adminCookieOptions,
  clearAdminSession,
  hasAdminSession,
  redirectSignedInAdmin,
  requireAdminPage,
  writeAdminSession,
} from '@/features/admin/cookie'
import { ADMIN_SESSION_TTL_SECONDS, signSession, verifySession } from '@/features/admin/session'

// The cookie store of the current request: get() reads the incoming cookies, set() / delete() record what the
// response would send.
const jar = vi.hoisted(() => ({ incoming: new Map<string, string>(), set: vi.fn(), delete: vi.fn() }))
vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({
    get: (name: string) => {
      const value = jar.incoming.get(name)
      return value === undefined ? undefined : { name, value }
    },
    set: jar.set,
    delete: jar.delete,
  })),
}))

const redirect = vi.hoisted(() =>
  vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT ${url}`)
  }),
)
vi.mock('next/navigation', () => ({ redirect }))

// Outside a request the real one throws; here it only marks the moment the clock may be read.
const connection = vi.hoisted(() => vi.fn(async () => {}))
vi.mock('next/server', () => ({ connection }))

// Fake values, test only.
const PASSWORD = 'test-admin-password-0123'
const SECRET = 'test-session-secret-0123456789abcdef'
const HTTPS_SITE = 'https://shop.example.vn'
const HTTP_SITE = 'http://localhost:3100'

beforeEach(() => {
  jar.incoming.clear()
  vi.stubEnv('SITE_URL', HTTP_SITE)
  vi.stubEnv('ADMIN_PASSWORD', PASSWORD)
  vi.stubEnv('SESSION_SECRET', SECRET)
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.clearAllMocks()
  vi.useRealTimers()
})

describe('cookie name and options', () => {
  it('adminCookieOptions sets httpOnly, strict, path /, 8-hour maxAge, no domain', () => {
    for (const site of [HTTP_SITE, HTTPS_SITE]) {
      vi.stubEnv('SITE_URL', site)
      const options = adminCookieOptions()
      expect(options).toEqual({
        httpOnly: true,
        sameSite: 'strict',
        path: '/',
        secure: site === HTTPS_SITE,
        maxAge: ADMIN_SESSION_TTL_SECONDS,
      })
      expect(options.maxAge).toBe(28_800)
      expect(options).not.toHaveProperty('domain')
    }
  })

  it('uses __Host-ns_admin on https and ns_admin on http', () => {
    vi.stubEnv('SITE_URL', HTTPS_SITE)
    expect(adminCookieName()).toBe('__Host-ns_admin')
    vi.stubEnv('SITE_URL', HTTP_SITE)
    expect(adminCookieName()).toBe('ns_admin')
  })
})

describe('hasAdminSession', () => {
  it('is true for a valid session cookie', async () => {
    jar.incoming.set('ns_admin', await signSession({ secret: SECRET, now: new Date() }))
    expect(await hasAdminSession()).toBe(true)
  })

  it('is false without a cookie, with a tampered one, or one under the other scheme name', async () => {
    expect(await hasAdminSession()).toBe(false)
    const token = await signSession({ secret: SECRET, now: new Date() })
    jar.incoming.set('ns_admin', `${token.slice(0, -2)}AA`)
    expect(await hasAdminSession()).toBe(false)
    jar.incoming.clear()
    jar.incoming.set('__Host-ns_admin', token)
    expect(await hasAdminSession()).toBe(false)
  })

  it('hasAdminSession is false when the config is disabled even with a valid-looking cookie', async () => {
    jar.incoming.set('ns_admin', await signSession({ secret: SECRET, now: new Date() }))
    vi.stubEnv('ADMIN_PASSWORD', '')
    expect(await hasAdminSession()).toBe(false)
    vi.stubEnv('ADMIN_PASSWORD', 'too-short')
    expect(await hasAdminSession()).toBe(false)
    vi.stubEnv('ADMIN_PASSWORD', PASSWORD)
    vi.stubEnv('SESSION_SECRET', '')
    expect(await hasAdminSession()).toBe(false)
  })
})

describe('a SESSION_SECRET with surrounding whitespace', () => {
  it('signs and verifies with the trimmed value', async () => {
    vi.stubEnv('SESSION_SECRET', `${SECRET}\n`)
    await writeAdminSession()
    const [, value] = jar.set.mock.calls[0] ?? []
    expect(typeof value === 'string' && (await verifySession({ token: value, secret: SECRET, now: new Date() }))).toBe(
      true,
    )
    jar.incoming.set('ns_admin', await signSession({ secret: SECRET, now: new Date() }))
    expect(await hasAdminSession()).toBe(true)
  })
})

describe('writeAdminSession / clearAdminSession', () => {
  it('writes a fresh signed token under the scheme name with the session options', async () => {
    vi.stubEnv('SITE_URL', HTTPS_SITE)
    await writeAdminSession()
    expect(jar.set).toHaveBeenCalledTimes(1)
    const [name, value, options] = jar.set.mock.calls[0] ?? []
    expect(name).toBe('__Host-ns_admin')
    expect(options).toEqual(adminCookieOptions())
    expect(typeof value === 'string' && (await verifySession({ token: value, secret: SECRET, now: new Date() }))).toBe(
      true,
    )
  })

  it('refuses to write a session when the config is disabled', async () => {
    vi.stubEnv('SESSION_SECRET', '')
    await expect(writeAdminSession()).rejects.toThrow('admin: not configured')
    expect(jar.set).not.toHaveBeenCalled()
  })

  it('clears the cookie with the attributes it was set with and no maxAge', async () => {
    vi.stubEnv('SITE_URL', HTTPS_SITE)
    await clearAdminSession()
    expect(jar.delete).toHaveBeenCalledWith({
      name: '__Host-ns_admin',
      httpOnly: true,
      sameSite: 'strict',
      path: '/',
      secure: true,
    })
  })

  it('clears the cookie even when the config is disabled', async () => {
    vi.stubEnv('SESSION_SECRET', '')
    await clearAdminSession()
    expect(jar.delete).toHaveBeenCalledTimes(1)
  })
})

describe('requireAdminPage', () => {
  it('redirects to /admin/login without a session', async () => {
    await expect(requireAdminPage()).rejects.toThrow('NEXT_REDIRECT /admin/login')
    expect(redirect).toHaveBeenCalledWith('/admin/login')
  })

  it('returns with a session', async () => {
    jar.incoming.set('ns_admin', await signSession({ secret: SECRET, now: new Date() }))
    await expect(requireAdminPage()).resolves.toBeUndefined()
    expect(redirect).not.toHaveBeenCalled()
  })
})

describe('redirectSignedInAdmin', () => {
  it('sends a signed-in admin from /admin/login to /admin/products', async () => {
    jar.incoming.set('ns_admin', await signSession({ secret: SECRET, now: new Date() }))
    await expect(redirectSignedInAdmin()).rejects.toThrow('NEXT_REDIRECT /admin/products')
  })

  it('returns without a session', async () => {
    await expect(redirectSignedInAdmin()).resolves.toBeUndefined()
    expect(redirect).not.toHaveBeenCalled()
  })
})

describe('hasAdminSession and the clock', () => {
  it('waits for the request (connection) before reading the clock', async () => {
    jar.incoming.set('ns_admin', await signSession({ secret: SECRET, now: new Date() }))
    expect(await hasAdminSession()).toBe(true)
    expect(connection).toHaveBeenCalledTimes(1)
    // new Date() cannot be spied on reliably; the order in the source is what Next.js sees.
    const source = readFileSync('src/features/admin/cookie.ts', 'utf8')
    const body = /export const hasAdminSession = [\s\S]*?\n}\n/.exec(source)?.[0] ?? ''
    expect(body.indexOf('await connection()')).toBeGreaterThan(-1)
    expect(body.indexOf('await connection()')).toBeLessThan(body.indexOf('now: new Date()'))
  })
})

// Audit PR #105 M1: the request must be read before the config, or a build without ADMIN_PASSWORD / SESSION_SECRET
// returns before any dynamic API and prerenders /admin/login (and every page behind requireAdminPage) as static.
describe('hasAdminSession is dynamic whatever the build env', () => {
  it('hasAdminSession reads the request even when the config is disabled', async () => {
    vi.stubEnv('ADMIN_PASSWORD', '')
    vi.stubEnv('SESSION_SECRET', '')
    expect(await hasAdminSession()).toBe(false)
    expect(cookies).toHaveBeenCalledTimes(1)
    expect(connection).toHaveBeenCalledTimes(1)
  })

  it('requireAdminPage and redirectSignedInAdmin read the request when the config is disabled', async () => {
    vi.stubEnv('SESSION_SECRET', '')
    await expect(requireAdminPage()).rejects.toThrow('NEXT_REDIRECT /admin/login')
    await expect(redirectSignedInAdmin()).resolves.toBeUndefined()
    expect(cookies).toHaveBeenCalledTimes(2)
    expect(connection).toHaveBeenCalledTimes(2)
  })

  it('calls cookies() and connection() before readAdminConfig() in the source', () => {
    const source = readFileSync('src/features/admin/cookie.ts', 'utf8')
    const body = /export const hasAdminSession = [\s\S]*?\n}\n/.exec(source)?.[0] ?? ''
    const config = body.indexOf('readAdminConfig()')
    expect(config).toBeGreaterThan(-1)
    expect(body.indexOf('await cookies()')).toBeGreaterThan(-1)
    expect(body.indexOf('await cookies()')).toBeLessThan(config)
    expect(body.indexOf('await connection()')).toBeGreaterThan(-1)
    expect(body.indexOf('await connection()')).toBeLessThan(config)
  })
})
