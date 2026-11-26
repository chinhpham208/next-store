import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { loginAction, logoutAction } from '@/features/admin/actions'
import { hashClientIp } from '@/features/admin/client-ip'
import { passwordMatches } from '@/features/admin/password'
import { verifySession } from '@/features/admin/session'
import type { LoginState } from '@/features/admin/types'

// The cookie store and the request headers of the current request.
const request = vi.hoisted(() => ({
  incoming: new Map<string, string>(),
  set: vi.fn(),
  delete: vi.fn(),
  headers: new Headers(),
}))
vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({
    get: (name: string) => {
      const value = request.incoming.get(name)
      return value === undefined ? undefined : { name, value }
    },
    set: request.set,
    delete: request.delete,
  })),
  headers: vi.fn(async () => request.headers),
}))

// Like Next.js: redirect() throws, so nothing after it runs.
const redirect = vi.hoisted(() =>
  vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT ${url}`)
  }),
)
vi.mock('next/navigation', () => ({ redirect }))

// Outside a request the real one throws; here it only marks the moment the clock may be read.
const connection = vi.hoisted(() => vi.fn(async () => {}))
vi.mock('next/server', () => ({ connection }))

// The store runs on PGlite in login-limit.test.ts; here only the order and the arguments matter.
const store = vi.hoisted(() => ({
  isLoginLocked: vi.fn<(input: { ipHash: string; now: Date }) => Promise<boolean>>(),
  recordLoginFailure: vi.fn<(input: { ipHash: string; now: Date }) => Promise<void>>(),
  purgeLoginFailures: vi.fn<(now: Date) => Promise<void>>(),
}))
vi.mock('@/features/admin/login-limit', () => store)

// The real comparison, watched.
vi.mock('@/features/admin/password', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/admin/password')>()
  return { passwordMatches: vi.fn(actual.passwordMatches) }
})

// Fake values, test only.
const PASSWORD = 'test-admin-password-0123'
const SECRET = 'test-session-secret-0123456789abcdef'
const IP = '203.0.113.7'
const COOKIE = 'ns_admin'
const IDLE: LoginState = { status: 'idle' }

const form = (password?: string | Blob): FormData => {
  const data = new FormData()
  if (password !== undefined) data.set('password', password)
  return data
}

const redirectedTo = async (run: () => Promise<unknown>): Promise<string | undefined> => {
  try {
    await run()
    return undefined
  } catch (error) {
    return error instanceof Error ? /^NEXT_REDIRECT (.*)$/.exec(error.message)?.[1] : undefined
  }
}

beforeEach(() => {
  request.incoming.clear()
  request.headers = new Headers({ 'x-forwarded-for': IP })
  vi.stubEnv('ADMIN_PASSWORD', PASSWORD)
  vi.stubEnv('SESSION_SECRET', SECRET)
  vi.stubEnv('SITE_URL', 'http://localhost:3100')
  store.isLoginLocked.mockResolvedValue(false)
  store.recordLoginFailure.mockResolvedValue(undefined)
  store.purgeLoginFailures.mockResolvedValue(undefined)
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.clearAllMocks()
  vi.restoreAllMocks()
})

describe('loginAction', () => {
  it('US-12: returns wrong-password and records one failure', async () => {
    expect(await loginAction(IDLE, form('not-the-password'))).toEqual({ status: 'error', error: 'wrong-password' })
    expect(store.recordLoginFailure).toHaveBeenCalledTimes(1)
    expect(request.set).not.toHaveBeenCalled()
    expect(redirect).not.toHaveBeenCalled()
  })

  it('US-12: sets the session cookie and redirects on the right password', async () => {
    expect(await redirectedTo(() => loginAction(IDLE, form(PASSWORD)))).toBe('/admin/products')
    expect(request.set).toHaveBeenCalledTimes(1)
    const [name, token, options] = request.set.mock.calls[0] ?? []
    expect(name).toBe(COOKIE)
    expect(typeof token).toBe('string')
    expect(await verifySession({ token: String(token), secret: SECRET, now: new Date() })).toBe(true)
    expect(options).toMatchObject({ httpOnly: true, sameSite: 'strict', path: '/' })
  })

  it('a successful login records nothing', async () => {
    await redirectedTo(() => loginAction(IDLE, form(PASSWORD)))
    expect(store.recordLoginFailure).not.toHaveBeenCalled()
  })

  it('a successful login also purges old failures, and a failed purge does not stop it (audit PR #103 L2)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    store.purgeLoginFailures.mockRejectedValue(new Error('database query failed: admin.login-purge'))
    expect(await redirectedTo(() => loginAction(IDLE, form(PASSWORD)))).toBe('/admin/products')
    expect(store.purgeLoginFailures).toHaveBeenCalledTimes(1)
    expect(request.set).toHaveBeenCalledTimes(1)
  })

  it('checks the lock before comparing the password', async () => {
    store.isLoginLocked.mockResolvedValue(true)
    expect(await loginAction(IDLE, form(PASSWORD))).toEqual({ status: 'error', error: 'locked' })
    expect(passwordMatches).not.toHaveBeenCalled()
    expect(store.recordLoginFailure).not.toHaveBeenCalled()
    expect(request.set).not.toHaveBeenCalled()
  })

  it('refuses to log in when the lock check fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    store.isLoginLocked.mockRejectedValue(new Error('database query timed out: admin.login-lock'))
    expect(await loginAction(IDLE, form(PASSWORD))).toEqual({ status: 'error', error: 'unavailable' })
    expect(passwordMatches).not.toHaveBeenCalled()
    expect(request.set).not.toHaveBeenCalled()
    expect(redirect).not.toHaveBeenCalled()
  })

  it('still answers wrong-password when recording the failure fails', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    store.recordLoginFailure.mockRejectedValue(new Error('database query failed: admin.login-failure'))
    expect(await loginAction(IDLE, form('not-the-password'))).toEqual({ status: 'error', error: 'wrong-password' })
    expect(log.mock.calls).toEqual([['admin: recording a login failure failed']])
  })

  it.each([
    ['ADMIN_PASSWORD missing', { ADMIN_PASSWORD: '' }],
    ['SESSION_SECRET missing', { SESSION_SECRET: '' }],
    ['a weak password', { ADMIN_PASSWORD: 'short' }],
  ])('returns not-configured without touching the database (%s)', async (_label, env) => {
    for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value)
    expect(await loginAction(IDLE, form(PASSWORD))).toEqual({ status: 'error', error: 'not-configured' })
    expect(store.isLoginLocked).not.toHaveBeenCalled()
    expect(store.recordLoginFailure).not.toHaveBeenCalled()
    expect(passwordMatches).not.toHaveBeenCalled()
    expect(request.set).not.toHaveBeenCalled()
  })

  it.each([
    ['a missing', form()],
    ['an empty', form('')],
    ['a non-string', form(new Blob(['x']))],
    ['a 257-character', form('a'.repeat(257))],
  ])('returns invalid for %s password', async (_label, data) => {
    expect(await loginAction(IDLE, data)).toEqual({ status: 'error', error: 'invalid' })
    expect(store.isLoginLocked).not.toHaveBeenCalled()
    expect(store.recordLoginFailure).not.toHaveBeenCalled()
    expect(passwordMatches).not.toHaveBeenCalled()
  })

  it('returns invalid when called with something other than FormData', async () => {
    expect(await loginAction(IDLE, JSON.parse('{"password":"x"}'))).toEqual({ status: 'error', error: 'invalid' })
    expect(store.isLoginLocked).not.toHaveBeenCalled()
  })

  it('does not trim the typed password', async () => {
    expect(await loginAction(IDLE, form(` ${PASSWORD} `))).toEqual({ status: 'error', error: 'wrong-password' })
  })

  it('stores only an HMAC of the IP', async () => {
    await loginAction(IDLE, form('not-the-password'))
    // An IPv4 address is its own key (clientLimitKey, NS-132).
    const expected = await hashClientIp({ ip: IP, secret: SECRET })
    expect(store.isLoginLocked).toHaveBeenCalledWith({ ipHash: expected, now: expect.any(Date) })
    expect(store.recordLoginFailure).toHaveBeenCalledWith({ ipHash: expected, now: expect.any(Date) })
    expect(expected).toMatch(/^[0-9a-f]{64}$/)
    expect(JSON.stringify(store.recordLoginFailure.mock.calls)).not.toContain(IP)
    expect(JSON.stringify(store.isLoginLocked.mock.calls)).not.toContain(IP)
  })

  it('stores the HMAC of the /64 for an IPv6 address, never the address (NS-132)', async () => {
    request.headers = new Headers({ 'x-forwarded-for': '2001:DB8:abcd:12::7' })
    await loginAction(IDLE, form('not-the-password'))
    expect(store.recordLoginFailure).toHaveBeenCalledWith({
      ipHash: await hashClientIp({ ip: '2001:db8:abcd:12::/64', secret: SECRET }),
      now: expect.any(Date),
    })
    expect(JSON.stringify(store.recordLoginFailure.mock.calls)).not.toMatch(/2001|db8/i)
  })

  it('counts a request without x-forwarded-for under one shared address', async () => {
    request.headers = new Headers()
    await loginAction(IDLE, form('not-the-password'))
    expect(store.recordLoginFailure).toHaveBeenCalledWith({
      ipHash: await hashClientIp({ ip: 'unknown', secret: SECRET }),
      now: expect.any(Date),
    })
  })

  it('never logs the password, the cookie or the IP', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) =>
      vi.spyOn(console, method).mockImplementation(() => {}),
    )
    store.recordLoginFailure.mockRejectedValueOnce(new Error(`failed for ${IP}`))
    await loginAction(IDLE, form('not-the-password'))
    store.isLoginLocked.mockRejectedValueOnce(new Error(`failed for ${IP}`))
    await loginAction(IDLE, form(PASSWORD))
    store.purgeLoginFailures.mockRejectedValueOnce(new Error(`failed for ${IP}`))
    await redirectedTo(() => loginAction(IDLE, form(PASSWORD)))
    const token = String(request.set.mock.calls[0]?.[1])
    const ipHash = await hashClientIp({ ip: IP, secret: SECRET })
    const printed = JSON.stringify(spies.flatMap((spy) => spy.mock.calls))
    for (const secret of [PASSWORD, 'not-the-password', SECRET, IP, ipHash, token]) {
      expect(printed).not.toContain(secret)
    }
  })
})

describe('logoutAction', () => {
  it('logout clears the cookie and redirects', async () => {
    request.incoming.set(COOKIE, 'v1.0000000000.x')
    expect(await redirectedTo(() => logoutAction())).toBe('/admin/login')
    expect(request.delete).toHaveBeenCalledWith(expect.objectContaining({ name: COOKIE, path: '/' }))
  })

  it('works without a configuration', async () => {
    vi.stubEnv('SESSION_SECRET', '')
    expect(await redirectedTo(() => logoutAction())).toBe('/admin/login')
    expect(request.delete).toHaveBeenCalledTimes(1)
  })
})
