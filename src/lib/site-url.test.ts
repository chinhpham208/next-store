import { describe, expect, it } from 'vitest'
import { absoluteUrl, getSiteUrl } from '@/lib/site-url'

describe('getSiteUrl', () => {
  it.each([
    [{}, 'http://localhost:3000'],
    [{ SITE_URL: 'https://shop.example.com' }, 'https://shop.example.com'],
    [
      { SITE_URL: 'https://shop.example.com/', VERCEL_ENV: 'production', VERCEL_PROJECT_PRODUCTION_URL: 'a.vercel.app' },
      'https://shop.example.com',
    ],
    [{ SITE_URL: 'http://localhost:3100' }, 'http://localhost:3100'],
    [
      {
        VERCEL_ENV: 'production',
        VERCEL_PROJECT_PRODUCTION_URL: 'next-store-iota-silk.vercel.app',
        VERCEL_URL: 'next-store-abc123.vercel.app',
      },
      'https://next-store-iota-silk.vercel.app',
    ],
    [
      {
        VERCEL_ENV: 'preview',
        VERCEL_PROJECT_PRODUCTION_URL: 'next-store-iota-silk.vercel.app',
        VERCEL_BRANCH_URL: 'next-store-git-ns-70-x.vercel.app',
        VERCEL_URL: 'next-store-abc123.vercel.app',
      },
      'https://next-store-git-ns-70-x.vercel.app',
    ],
    [{ VERCEL_ENV: 'preview', VERCEL_URL: 'next-store-abc123.vercel.app' }, 'https://next-store-abc123.vercel.app'],
    [{ SITE_URL: '  ' }, 'http://localhost:3000'],
  ])('resolves %j to %s', (env, expected) => expect(getSiteUrl(env).origin).toBe(expected))

  it.each([
    'http://shop.example.com',
    'https://shop.example.com/path',
    'https://user:pw@shop.example.com',
    'ftp://x',
    'shop.example.com',
    'https://shop.example.com?x=1',
    'https://shop.example.com#x',
    'https://shop.example.com:99999',
    'https:///',
    'https://-bad-.example.com',
  ])('refuses SITE_URL=%j without echoing it', (value) => {
    expect(() => getSiteUrl({ SITE_URL: value })).toThrow(
      expect.objectContaining({ message: expect.stringContaining('SITE_URL') }),
    )
    expect(() => getSiteUrl({ SITE_URL: value })).toThrow(
      expect.objectContaining({ message: expect.not.stringContaining(value) }),
    )
  })

  // A production build with a localhost SITE_URL would print http://localhost into every og:image and the sitemap.
  it('refuses a plain-http SITE_URL on a Vercel production build', () => {
    expect(() => getSiteUrl({ SITE_URL: 'http://localhost:3100', VERCEL_ENV: 'production' })).toThrow(/SITE_URL/)
  })

  it.each([
    ['VERCEL_URL', { VERCEL_URL: 'evil.example/path' }],
    ['VERCEL_URL', { VERCEL_URL: 'user@evil.example' }],
    ['VERCEL_BRANCH_URL', { VERCEL_BRANCH_URL: 'next-store.vercel.app:443' }],
    ['VERCEL_PROJECT_PRODUCTION_URL', { VERCEL_ENV: 'production', VERCEL_PROJECT_PRODUCTION_URL: 'https://a.vercel.app' }],
  ])('refuses a %s that is not a bare hostname', (name, env) => {
    expect(() => getSiteUrl(env)).toThrow(new RegExp(name))
  })

  it('ignores the production URL outside production', () => {
    expect(getSiteUrl({ VERCEL_ENV: 'preview', VERCEL_PROJECT_PRODUCTION_URL: 'a.vercel.app' }).origin).toBe(
      'http://localhost:3000',
    )
  })

  it('treats empty Vercel variables as unset', () => {
    expect(getSiteUrl({ VERCEL_BRANCH_URL: '', VERCEL_URL: 'b.vercel.app' }).origin).toBe('https://b.vercel.app')
  })

  it('returns a fresh URL each call, so a caller cannot change the next one', () => {
    const first = getSiteUrl({})
    first.hostname = 'evil.example'
    expect(getSiteUrl({}).origin).toBe('http://localhost:3000')
  })
})

describe('absoluteUrl', () => {
  it('joins a path and refuses a relative one', () => {
    expect(absoluteUrl('/sitemap.xml', { SITE_URL: 'https://shop.example.com' })).toBe(
      'https://shop.example.com/sitemap.xml',
    )
    expect(absoluteUrl('/', { SITE_URL: 'https://shop.example.com' })).toBe('https://shop.example.com/')
    expect(() => absoluteUrl('sitemap.xml', {})).toThrow()
  })

  // new URL('//evil.example/x', base) and new URL('/\\evil.example', base) both leave the site's host.
  it.each(['//evil.example/x', '/\\evil.example/x', 'https://evil.example/x'])(
    'refuses %j, which would leave the site origin',
    (path) => {
      expect(() => absoluteUrl(path, { SITE_URL: 'https://shop.example.com' })).toThrow()
    },
  )
})
