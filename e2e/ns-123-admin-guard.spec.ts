import type { APIResponse, Page } from '@playwright/test'
import { VIEWPORT_INDEPENDENT } from './catalog'
import { WRITE_TAG } from './production'
import { expect, test } from './test'

// NS-123 (plan M5 Task 8, audit PR #104 L3 / C3): a valid session cookie passes src/proxy.ts, so its HMAC check with
// Web Crypto runs where the proxy runs (next start locally, Vercel's proxy on a preview), and a tampered one is sent
// to /admin/login with the cookie cleared. A valid cookie can only come from a real login: the session secret of a
// deployment never leaves Vercel. Smoke (scripts/smoke.sh) covers every case without a session.
//
// Works whether or not the deployment has ADMIN_PASSWORD / SESSION_SECRET: without them the area is closed, the login
// says "Khu quản trị chưa được cấu hình." and the proxy still redirects; C3 is then reported as not checked. Locally
// (scripts/verify.sh, playwright.config.ts) the area is always configured. The login is a POST (WRITE_TAG): never on
// Production, whose password never reaches GitHub (ADR-0018 16A).
test.skip(({ isMobile }) => isMobile, VIEWPORT_INDEPENDENT)

const PASSWORD = process.env.E2E_ADMIN_PASSWORD
const DEPLOYED = Boolean(process.env.BASE_URL)
const NOT_CONFIGURED = 'Khu quản trị chưa được cấu hình.'
const ADMIN_COOKIES = ['__Host-ns_admin', 'ns_admin']

type LoginOutcome = 'signed-in' | 'not-configured' | 'refused' | 'pending'

const outcomeOf = async (page: Page): Promise<LoginOutcome> => {
  if (new URL(page.url()).pathname === '/admin/products') return 'signed-in'
  // The field's alert (Next.js has a route announcer with role=alert too); gone once the page changed.
  const field = page.locator('#admin-password-error')
  if ((await field.count()) === 0) return 'pending'
  const alert = (await field.textContent()) ?? ''
  if (alert.includes(NOT_CONFIGURED)) return 'not-configured'
  return alert.trim() === '' ? 'pending' : 'refused'
}

// Location of a redirect, as a path: the proxy answers an absolute URL on its own host.
const locationPath = (response: APIResponse): string | undefined => {
  const location = response.headers().location
  return location === undefined ? undefined : new URL(location, 'http://x').pathname
}

const isLoginRedirect = (response: APIResponse) => response.status() === 307 && locationPath(response) === '/admin/login'

const clearsCookie = (response: APIResponse, name: string) =>
  response
    .headersArray()
    .some(({ name: header, value }) => header.toLowerCase() === 'set-cookie' && value.startsWith(`${name}=;`) && /max-age=0/i.test(value))

// A signature with one character changed, kept canonical (the last character carries 2 zero bits).
const tamper = (token: string) => `${token.slice(0, -2)}${token.slice(-2) === 'AA' ? 'EA' : 'AA'}`

test.describe('NS-123: proxy kiểm phiên admin bằng HMAC (C3)', { tag: WRITE_TAG }, () => {
  test('cookie phiên hợp lệ qua proxy, cookie bị sửa bị chuyển tới /admin/login và bị xoá', async ({ page, request }) => {
    test.skip(!PASSWORD, 'Không có E2E_ADMIN_PASSWORD: không đăng nhập được, C3 chưa kiểm')
    await page.goto('/admin/login')
    // Set without fill(): a fill step records the value in the report (redaction of this secret comes with Task 14).
    await page.locator('#admin-password').evaluate((input, value) => {
      if (input instanceof HTMLInputElement) input.value = value
    }, PASSWORD ?? '')
    await page.getByRole('button', { name: 'Đăng nhập' }).click()
    await expect.poll(() => outcomeOf(page), { timeout: 20_000 }).not.toBe('pending')
    const outcome = await outcomeOf(page)

    if (outcome === 'not-configured') {
      expect(DEPLOYED, 'local server always has the admin env (playwright.config.ts)').toBe(true)
      // Closed, never open: still a 307 without a session.
      expect(isLoginRedirect(await request.get('/admin/products', { maxRedirects: 0 }))).toBe(true)
      console.log('ns-123: C3 chưa kiểm: khu admin chưa được cấu hình trên môi trường này (đóng, /admin/products → 307)')
      test.info().annotations.push({ type: 'C3', description: 'chưa kiểm: khu admin chưa được cấu hình' })
      return
    }
    expect(outcome, 'đăng nhập bằng E2E_ADMIN_PASSWORD (khớp ADMIN_PASSWORD của môi trường?)').toBe('signed-in')

    const cookies = await page.context().cookies()
    const session = cookies.find(({ name }) => ADMIN_COOKIES.includes(name))
    expect(session, 'cookie phiên admin sau khi đăng nhập').toBeDefined()
    const name = session?.name ?? ''
    const token = session?.value ?? ''
    expect(session?.httpOnly).toBe(true)
    expect(session?.sameSite).toBe('Strict')

    // The valid cookie passes the proxy: /admin goes on to its page, which redirects to /admin/products; a page under
    // /admin is not sent back to the login.
    const home = await request.get('/admin', { headers: { cookie: `${name}=${token}` }, maxRedirects: 0 })
    expect(home.status()).toBe(307)
    expect(locationPath(home)).toBe('/admin/products')
    const products = await request.get('/admin/products', { headers: { cookie: `${name}=${token}` }, maxRedirects: 0 })
    expect(isLoginRedirect(products), '/admin/products với phiên hợp lệ').toBe(false)
    expect(products.headersArray().some(({ name: header }) => header.toLowerCase() === 'set-cookie')).toBe(false)

    // The same token with one character of the signature changed: redirected, and cleared.
    const tampered = await request.get('/admin/products', {
      headers: { cookie: `${name}=${tamper(token)}` },
      maxRedirects: 0,
    })
    expect(isLoginRedirect(tampered), 'cookie bị sửa').toBe(true)
    expect(clearsCookie(tampered, name), 'Set-Cookie xoá cookie bị sửa').toBe(true)
    console.log(
      `ns-123: C3 đạt: cookie ${name} hợp lệ qua proxy (/admin → 307 /admin/products, /admin/products → ${products.status()}); cookie bị sửa → 307 /admin/login, Set-Cookie xoá`,
    )
  })
})

// NS-146 (plan M6 Task 12): the errors page is behind the same proxy check as every /admin page, and it checks the
// session itself too (src/admin-session-checks.test.ts). Without a cookie there is no login: a read, so it also runs
// on Production.
test('NS-123: /admin/errors không phiên thì 307 tới /admin/login', async ({ request }) => {
  const response = await request.get('/admin/errors', { maxRedirects: 0 })
  expect(isLoginRedirect(response)).toBe(true)
  expect(await response.text()).not.toContain('nhóm lỗi')
})
