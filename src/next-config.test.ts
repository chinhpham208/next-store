import { unstable_getResponseFromNextConfig } from 'next/experimental/testing/server'
import { describe, expect, it } from 'vitest'
import nextConfig from '../next.config'

// NS-108 (audit M4 NS-96): the security headers come from `headers()` in next.config, so they reach every response
// Next.js or Vercel builds for a path, including the proxy's rewrite to the not-found page, image routes, the sitemap
// and robots.txt. scripts/smoke.sh checks the same headers on the real responses (`next start`, previews, Dev).
const EXPECTED_HEADERS = {
  'x-frame-options': 'DENY',
  'content-security-policy': "frame-ancestors 'none'",
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
}

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

describe('next.config security headers (NS-108)', () => {
  it.each(PATHS)('sends the security headers on %s', async (path) => {
    const response = await unstable_getResponseFromNextConfig({ url: `https://shop.test${path}`, nextConfig })
    for (const [name, value] of Object.entries(EXPECTED_HEADERS)) {
      expect(response.headers.get(name), name).toBe(value)
    }
  })

  // Only frame-ancestors for now: a full script-src policy needs nonces or hashes for the inline RSC payload and is a
  // ticket of its own.
  it('keeps the policy to frame-ancestors only', async () => {
    const response = await unstable_getResponseFromNextConfig({ url: 'https://shop.test/', nextConfig })
    expect(response.headers.get('content-security-policy')).not.toMatch(/script-src|default-src/)
  })
})

describe('next.config Server Action body limit (NS-108)', () => {
  // The cart's real payloads are a few dozen bytes ({ slug, quantity }); 16 KB leaves room for any of them and cuts
  // the default 1 MB a public POST may make the server read and parse.
  it('limits a Server Action body to 16 KB', () => {
    expect(nextConfig.experimental?.serverActions?.bodySizeLimit).toBe('16kb')
  })
})
