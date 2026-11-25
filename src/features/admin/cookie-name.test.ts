import { describe, expect, it } from 'vitest'
import { adminCookieNameFor } from '@/features/admin/cookie-name'

describe('adminCookieNameFor', () => {
  it('is __Host-ns_admin for an https site and ns_admin for an http site', () => {
    expect(adminCookieNameFor(new URL('https://shop.example.vn'))).toBe('__Host-ns_admin')
    expect(adminCookieNameFor(new URL('https://shop.example.vn:8443/'))).toBe('__Host-ns_admin')
    expect(adminCookieNameFor(new URL('http://localhost:3100'))).toBe('ns_admin')
    expect(adminCookieNameFor(new URL('http://127.0.0.1'))).toBe('ns_admin')
  })
})
