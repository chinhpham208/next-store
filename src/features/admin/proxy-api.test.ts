import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { hasValidAdminCookie, isAdminLoginPath, isAdminPath } from '@/features/admin/proxy-api'
import { signSession } from '@/features/admin/session'

// Fake values, test only.
const PASSWORD = 'test-admin-password-0123'
const SECRET = 'test-session-secret-0123456789abcdef'

const requestWith = (cookie?: string): NextRequest =>
  new NextRequest('https://shop.example.vn/admin/products', cookie === undefined ? {} : { headers: { cookie } })

beforeEach(() => {
  vi.stubEnv('ADMIN_PASSWORD', PASSWORD)
  vi.stubEnv('SESSION_SECRET', SECRET)
})
afterEach(() => {
  vi.unstubAllEnvs()
})

describe('isAdminPath', () => {
  it('matches /admin and everything under it, with RSC forms', () => {
    for (const path of [
      '/admin',
      '/admin/',
      '/admin/login',
      '/admin/products',
      '/admin/products/ao-git-push-force',
      '/admin.rsc',
      '/admin.segments/_tree.segment',
      '/admin.segments/_tree.segment.rsc',
    ]) {
      expect(isAdminPath(path), path).toBe(true)
    }
  })

  it('does not match other paths', () => {
    for (const path of ['/', '/administrator', '/admins', '/products/admin', '/blog/admin', '/admin-x', '/Admin']) {
      expect(isAdminPath(path), path).toBe(false)
    }
  })
})

describe('isAdminLoginPath', () => {
  it('matches /admin/login and its RSC and segment forms', () => {
    for (const path of [
      '/admin/login',
      '/admin/login.rsc',
      '/admin/login.segments/_tree.segment',
      '/admin/login.segments/_tree.segment.rsc',
      '/admin/login.segments/__PAGE__.segment.rsc',
    ]) {
      expect(isAdminLoginPath(path), path).toBe(true)
    }
  })

  it('does not match anything else', () => {
    for (const path of [
      '/admin',
      '/admin/',
      '/admin/login/',
      '/admin/login/x',
      '/admin/loginx',
      '/admin/login.json',
      '/admin/login.segments/',
      '/admin/products/login',
      '/admin/login.rsc/../products',
      '/admin/login.segments/../products/x.segment',
      '/admin/login.segments/a/%2e%2e/b.segment',
      '/login',
    ]) {
      expect(isAdminLoginPath(path), path).toBe(false)
    }
  })
})

describe('hasValidAdminCookie', () => {
  it('accepts a valid session under either cookie name', async () => {
    const token = await signSession({ secret: SECRET, now: new Date() })
    expect(await hasValidAdminCookie(requestWith(`__Host-ns_admin=${token}`))).toBe(true)
    expect(await hasValidAdminCookie(requestWith(`ns_admin=${token}`))).toBe(true)
    expect(await hasValidAdminCookie(requestWith(`ns_cart=x; ns_admin=junk; __Host-ns_admin=${token}`))).toBe(true)
  })

  it('rejects no cookie, junk, a tampered or foreign token', async () => {
    const token = await signSession({ secret: SECRET, now: new Date() })
    const foreign = await signSession({ secret: 'other-session-secret-0123456789abcdef', now: new Date() })
    expect(await hasValidAdminCookie(requestWith())).toBe(false)
    expect(await hasValidAdminCookie(requestWith('ns_admin=junk'))).toBe(false)
    expect(await hasValidAdminCookie(requestWith(`ns_admin=${token.slice(0, -2)}AA`))).toBe(false)
    expect(await hasValidAdminCookie(requestWith(`__Host-ns_admin=${foreign}`))).toBe(false)
    expect(await hasValidAdminCookie(requestWith(`ns_session=${token}`))).toBe(false)
  })

  it('closes when SESSION_SECRET or ADMIN_PASSWORD is missing or weak, without throwing', async () => {
    const token = await signSession({ secret: SECRET, now: new Date() })
    const cookie = `ns_admin=${token}`
    vi.stubEnv('SESSION_SECRET', '')
    expect(await hasValidAdminCookie(requestWith(cookie))).toBe(false)
    vi.stubEnv('SESSION_SECRET', SECRET)
    vi.stubEnv('ADMIN_PASSWORD', '')
    expect(await hasValidAdminCookie(requestWith(cookie))).toBe(false)
    vi.stubEnv('ADMIN_PASSWORD', 'too-short')
    expect(await hasValidAdminCookie(requestWith(cookie))).toBe(false)
    vi.stubEnv('ADMIN_PASSWORD', SECRET)
    expect(await hasValidAdminCookie(requestWith(cookie))).toBe(false)
  })

  it('an empty secret can never sign a token the proxy accepts', async () => {
    // A token an attacker could compute if the code ever fell back to signing with ''.
    const { createHmac } = await import('node:crypto')
    const exp = String(Math.floor(Date.now() / 1000) + 60)
    const mac = createHmac('sha256', '').update(`v1.${exp}`).digest('base64url')
    vi.stubEnv('SESSION_SECRET', '')
    expect(await hasValidAdminCookie(requestWith(`ns_admin=v1.${exp}.${mac}`))).toBe(false)
  })
})
