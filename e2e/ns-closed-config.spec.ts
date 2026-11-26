import { CLOSED_CONFIG_URL } from '../playwright.config'
import { adminCookieNameFor } from '@/features/admin/cookie-name'
import { signSession } from '@/features/admin/session'
import { VIEWPORT_INDEPENDENT } from './catalog'
import { expect, test } from './test'

// Fail-closed configuration on a real build (plan M6 Global Constraints, Task 14, ADR-0023): the sixth local server of
// playwright.config.ts has a weak ADMIN_PASSWORD (24 characters, 2 distinct) and a valid SESSION_SECRET. A deployed
// BASE_URL has one configuration and cannot be switched, so these specs only run locally.
test.skip(({ isMobile }) => isMobile, VIEWPORT_INDEPENDENT)
test.skip(Boolean(process.env.BASE_URL), 'Server cấu hình đóng chỉ có khi chạy local (không có BASE_URL)')

const SITE_COOKIE_NAME = adminCookieNameFor(new URL(CLOSED_CONFIG_URL))

test.describe('closed: khu admin', () => {
  test('closed: mật khẩu admin yếu thì cookie phiên hợp lệ vẫn bị chuyển tới /admin/login', async ({ request }) => {
    const secret = process.env.E2E_SESSION_SECRET
    expect(secret, 'E2E_SESSION_SECRET do playwright.config.ts / scripts/verify.sh đặt').toBeTruthy()
    // Signed with the very secret the closed server runs with: only the weak password can be why it is refused.
    const token = await signSession({ secret: secret ?? '', now: new Date() })
    const response = await request.get(`${CLOSED_CONFIG_URL}/admin/products`, {
      headers: { cookie: `${SITE_COOKIE_NAME}=${token}` },
      maxRedirects: 0,
    })
    expect(response.status()).toBe(307)
    expect(new URL(response.headers().location ?? '', CLOSED_CONFIG_URL).pathname).toBe('/admin/login')
  })
})

test.describe('closed: webhook thanh toán', () => {
  test('closed: thiếu FAKE_PAYMENT_SECRET thì webhook trả 503', async ({ request }) => {
    // The closed server has no FAKE_PAYMENT_SECRET and a dead database: the 503 is answered before either is read.
    const response = await request.post(`${CLOSED_CONFIG_URL}/api/webhooks/payment`, {
      data: '{}',
      headers: { 'content-type': 'application/json' },
    })
    expect(response.status()).toBe(503)
    expect(await response.json()).toEqual({ error: 'not-configured' })
  })
})
