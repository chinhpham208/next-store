import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildAdminCsp, newNonce } from '@/features/admin/csp'

// ADR-0020 (plan M5 Task 12): the strict policy of /admin/*, set by the proxy on the request (so Next.js puts the
// nonce on its scripts) and on the response (so the browser enforces it).
const directives = (policy: string) =>
  new Map(
    policy
      .split(';')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const [name = '', ...sources] = part.split(/\s+/)
        return [name, sources.join(' ')] as const
      }),
  )

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('buildAdminCsp', () => {
  it('builds the admin CSP with the nonce in script-src and style-src', () => {
    vi.stubEnv('NODE_ENV', 'production')
    const policy = directives(buildAdminCsp('bm9uY2Utbm9uY2Utbm9uY2U='))
    expect(Object.fromEntries(policy)).toEqual({
      'default-src': "'self'",
      'script-src': "'self' 'nonce-bm9uY2Utbm9uY2Utbm9uY2U=' 'strict-dynamic'",
      'style-src': "'self' 'nonce-bm9uY2Utbm9uY2Utbm9uY2U='",
      'img-src': "'self' data: blob:",
      'font-src': "'self'",
      'connect-src': "'self'",
      'object-src': "'none'",
      'base-uri': "'self'",
      'form-action': "'self'",
      'frame-ancestors': "'none'",
    })
  })

  it('never allows inline script or eval outside development', () => {
    vi.stubEnv('NODE_ENV', 'production')
    const policy = buildAdminCsp('bm9uY2Utbm9uY2Utbm9uY2U=')
    expect(policy).not.toContain("'unsafe-inline'")
    expect(policy).not.toContain("'unsafe-eval'")
  })

  // The dev server of Next.js needs eval (React rebuilds server error stacks in the browser).
  it("adds 'unsafe-eval' to script-src in development only", () => {
    vi.stubEnv('NODE_ENV', 'development')
    expect(directives(buildAdminCsp('bm9uY2Utbm9uY2Utbm9uY2U=')).get('script-src')).toBe(
      "'self' 'nonce-bm9uY2Utbm9uY2Utbm9uY2U=' 'strict-dynamic' 'unsafe-eval'",
    )
  })

  // Next.js 16.4.6 reads the nonce from script-src with /^'nonce-([A-Za-z0-9+/_-]+={0,2})'$/
  // (server/app-render/get-script-nonce-from-header.js); a nonce it cannot read would leave every script without one.
  it('keeps a nonce Next.js can read back', () => {
    const nonce = newNonce()
    const scriptSrc = directives(buildAdminCsp(nonce)).get('script-src') ?? ''
    const found = scriptSrc.split(' ').map((source) => /^'nonce-([A-Za-z0-9+/_-]+={0,2})'$/.exec(source)?.[1])
    expect(found).toContain(nonce)
  })

  it.each(["abc'; script-src *", 'a b', '', 'a;b'])('refuses a nonce that could change the policy: %j', (nonce) => {
    expect(() => buildAdminCsp(nonce)).toThrow()
  })
})

describe('newNonce', () => {
  it('newNonce returns 24 base64 characters and differs each call', () => {
    const nonces = Array.from({ length: 50 }, () => newNonce())
    for (const nonce of nonces) expect(nonce).toMatch(/^[A-Za-z0-9+/]{22}==$/)
    expect(new Set(nonces).size).toBe(nonces.length)
  })

  it('draws 16 bytes from crypto.getRandomValues', () => {
    const spy = vi.spyOn(globalThis.crypto, 'getRandomValues')
    newNonce()
    expect(spy).toHaveBeenCalledTimes(1)
    expect((spy.mock.calls[0]?.[0] as Uint8Array).length).toBe(16)
    spy.mockRestore()
  })
})
