import { unstable_getResponseFromNextConfig } from 'next/experimental/testing/server'
import { describe, expect, it, vi } from 'vitest'
import nextConfig from '../next.config'

// NS-108 (audit M4 NS-96): the security headers come from `headers()` in next.config, so they reach every response
// Next.js or Vercel builds for a path, including the proxy's rewrite to the not-found page, image routes, the sitemap
// and robots.txt. scripts/smoke.sh checks the same headers on the real responses (`next start`, previews, Dev).
// ADR-0016 headers kept by ADR-0020; the CSP itself is checked directive by directive below.
const EXPECTED_HEADERS = {
  'x-frame-options': 'DENY',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
}

// ADR-0020 (plan M5 Task 12, Next.js 16.4.6 guide "Without Nonces"): the baseline policy of every path. Shop pages
// are prerendered, so their inline RSC scripts carry no nonce: 'unsafe-inline' stays in script-src there.
const BASELINE_CSP = {
  'default-src': "'self'",
  'script-src': "'self' 'unsafe-inline'",
  'style-src': "'self' 'unsafe-inline'",
  'img-src': "'self' data: blob:",
  'font-src': "'self'",
  'connect-src': "'self'",
  'object-src': "'none'",
  'base-uri': "'self'",
  'form-action': "'self'",
  'frame-ancestors': "'none'",
  'upgrade-insecure-requests': '',
}

const directives = (policy: string | null) =>
  Object.fromEntries(
    (policy ?? '')
      .split(';')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const [name = '', ...sources] = part.split(/\s+/)
        return [name, sources.join(' ')]
      }),
  )

const responseFor = (path: string) =>
  unstable_getResponseFromNextConfig({ url: `https://shop.test${path}`, nextConfig })

const PATHS = [
  '/',
  '/products',
  '/products/ao-git-push-force',
  '/products/ao-git-push-force/opengraph-image-16g1u1',
  '/products/khong-ton-tai',
  '/_khong-tim-thay',
  '/blog/chao-mung-den-next-store',
  '/cart',
  '/opengraph-image',
  '/sitemap.xml',
  '/robots.txt',
  '/khong-ton-tai',
  '/_next/static/chunks/main.js',
]

describe('next.config security headers (NS-108, ADR-0020)', () => {
  it.each(PATHS)('keeps X-Frame-Options, nosniff and Referrer-Policy on %s', async (path) => {
    const response = await responseFor(path)
    for (const [name, value] of Object.entries(EXPECTED_HEADERS)) {
      expect(response.headers.get(name), name).toBe(value)
    }
  })

  it.each([...PATHS, '/admin/login', '/admin/products'])('sets the baseline CSP on every path: %s', async (path) => {
    const response = await responseFor(path)
    expect(directives(response.headers.get('content-security-policy'))).toEqual(BASELINE_CSP)
  })

  // The baseline never carries a nonce: a nonce on a prerendered shop page would be the same for every visitor, and
  // Next.js would read it back (any CSP request header with 'nonce-…') and stop prerendering (D3).
  it('sets the baseline CSP without a nonce and without eval outside development', async () => {
    const policy = (await responseFor('/')).headers.get('content-security-policy') ?? ''
    expect(policy).not.toMatch(/nonce-|unsafe-eval|strict-dynamic/)
  })

  // The dev server of Next.js needs eval; it serves http://localhost, where Safari would upgrade every asset request
  // to https and break the page, so upgrade-insecure-requests is left out there too.
  it("adds 'unsafe-eval' and drops upgrade-insecure-requests in development only", async () => {
    vi.resetModules()
    vi.stubEnv('NODE_ENV', 'development')
    try {
      const devConfig = (await import('../next.config')).default
      const response = await unstable_getResponseFromNextConfig({ url: 'https://shop.test/', nextConfig: devConfig })
      const { 'upgrade-insecure-requests': _upgrade, ...rest } = BASELINE_CSP
      expect(directives(response.headers.get('content-security-policy'))).toEqual({
        ...rest,
        'script-src': "'self' 'unsafe-inline' 'unsafe-eval'",
      })
    } finally {
      vi.unstubAllEnvs()
      vi.resetModules()
    }
  })
})

describe('next.config Server Action body limit (NS-108)', () => {
  // The cart's real payloads are a few dozen bytes ({ slug, quantity }); 16 KB leaves room for any of them and cuts
  // the default 1 MB a public POST may make the server read and parse.
  it('limits a Server Action body to 16 KB', () => {
    expect(nextConfig.experimental?.serverActions?.bodySizeLimit).toBe('16kb')
  })
})
