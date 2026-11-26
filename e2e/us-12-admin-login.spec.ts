import { randomInt } from 'node:crypto'
import type { APIResponse } from '@playwright/test'
import {
  adminCookie,
  adminCookieName,
  adminCookieHeader,
  adminPassword,
  forgedToken,
  loginAsAdmin,
  openLogin,
  submitPassword,
  tamper,
} from './admin'
import { waitForActionResponse } from './cart'
import { expectNoSeriousA11yViolations } from './axe'
import { WRITE_TAG } from './production'
import { readMeta, readSitemap } from './seo'
import { expect, test } from './test'
import { loginErrorMessage } from '@/features/admin/messages'

// US-12 (plan M5 Task 14): the admin area behind a password. Runs in the `admin-write` project (desktop viewport,
// after every other project, playwright.config.ts).
//
// Read-only tests (no login) also run on Production. Every test that logs in is tagged WRITE_TAG: a login is a POST,
// and Production's password never reaches GitHub (ADR-0018 16A).
//
// Wrong passwords: the login limit is 5 per address in 15 minutes (ADR-0018 8A). The wrong-password test types ONE
// (two with a retry), so a run never locks the runner out of a deployment. Only the lock test types more, and only
// on the local server, with an address of its own.

const VIEWPORTS = [
  { name: 'desktop', size: { width: 1280, height: 800 } },
  { name: 'mobile 390 px', size: { width: 390, height: 844 } },
] as const

const locationPath = (location: string | undefined): string | undefined =>
  location === undefined ? undefined : new URL(location, 'http://x').pathname

// The 307 is read from the response itself (`maxRedirects: 0`), never by letting the browser follow it: on a preview the
// bypass header does not go along a browser redirect (e2e/bypass.ts), so the hop to /admin/login would meet Vercel's
// own login. The login page is opened by its own address.
const clearsCookie = (response: APIResponse, name: string): boolean =>
  response
    .headersArray()
    .some(({ name: header, value }) => header.toLowerCase() === 'set-cookie' && value.startsWith(`${name}=;`) && /max-age=0/i.test(value))

const expectLoginRedirect = (response: APIResponse): void => {
  expect(response.status()).toBe(307)
  expect(locationPath(response.headers().location)).toBe('/admin/login')
}

test.describe('US-12: chưa đăng nhập', () => {
  test('US-12: chưa đăng nhập mở /admin/products thì bị chuyển tới /admin/login', async ({ page, request }) => {
    expectLoginRedirect(await request.get('/admin/products', { maxRedirects: 0 }))

    await page.goto('/admin/login')
    await expect(page.getByRole('heading', { level: 1, name: 'Đăng nhập quản trị' })).toBeVisible()
  })

  test('US-12: cookie giả thì bị chuyển tới /admin/login và cookie bị xoá', async ({ request, baseURL }) => {
    const response = await request.get('/admin/products', {
      headers: { cookie: adminCookieHeader(baseURL, forgedToken()) },
      maxRedirects: 0,
    })
    expectLoginRedirect(response)
    expect(clearsCookie(response, adminCookieName(baseURL)), 'Set-Cookie xoá cookie giả').toBe(true)
  })

  test('US-12: trang admin có noindex và không nằm trong sitemap', async ({ request }) => {
    const login = await request.get('/admin/login')
    expect(login.status()).toBe(200)
    expect(readMeta(await login.text()).robots ?? '').toContain('noindex')

    const sitemap = await request.get('/sitemap.xml')
    expect(sitemap.status()).toBe(200)
    const adminEntries = readSitemap(await sitemap.text()).filter(({ loc }) => new URL(loc).pathname.startsWith('/admin'))
    expect(adminEntries).toEqual([])
  })

  for (const { name, size } of VIEWPORTS) {
    test(`US-12: trang đăng nhập không có lỗi a11y serious / critical (${name})`, async ({ page }) => {
      await page.setViewportSize(size)
      await openLogin(page)
      await expectNoSeriousA11yViolations(page)
    })
  }
})

test.describe('US-12: đăng nhập', { tag: WRITE_TAG }, () => {
  test('US-12: nhập sai mật khẩu thì thấy lỗi', async ({ page, context }) => {
    adminPassword() // skips the test, with the reason, when this run has no password
    await openLogin(page)
    // One wrong try only (see the top of the file). Not derived from the real password.
    await submitPassword(page, `sai-${randomInt(1e9)}-khong-phai-mat-khau`)

    const field = page.locator('#admin-password')
    await expect(page.locator('#admin-password-error')).toHaveText(loginErrorMessage('wrong-password'))
    await expect(page.locator('#admin-password-error')).toHaveText('Mật khẩu không đúng.')
    await expect(page).toHaveURL(/\/admin\/login$/)
    await expect(field).toHaveAttribute('aria-invalid', 'true')
    expect(await adminCookie(context)).toBeUndefined()
  })

  test('US-12: nhập đúng thì vào được', async ({ page, context }) => {
    await loginAsAdmin(page)
    await expect(page).toHaveURL(/\/admin\/products$/)

    const session = await adminCookie(context)
    expect(session, 'cookie phiên admin sau khi đăng nhập').toBeDefined()
    expect(session?.httpOnly).toBe(true)
    expect(session?.sameSite).toBe('Strict')
    // The browser works the expiry out from Max-Age on its own clock: 8 hours from now, give or take 5 minutes.
    const expectedExpiry = Date.now() / 1000 + 8 * 60 * 60
    expect(Math.abs((session?.expires ?? 0) - expectedExpiry)).toBeLessThan(5 * 60)
  })

  test('US-12: cookie phiên bị sửa tay thì bị đá ra', async ({ page, context, request, baseURL }) => {
    await loginAsAdmin(page)
    const session = await adminCookie(context)
    expect(session, 'cookie phiên admin sau khi đăng nhập').toBeDefined()
    const token = session?.value ?? ''

    const valid = await request.get('/admin/products', { headers: { cookie: adminCookieHeader(baseURL, token) }, maxRedirects: 0 })
    expect(valid.status(), 'cookie nguyên vẹn qua proxy').toBe(200)

    const tampered = await request.get('/admin/products', {
      headers: { cookie: adminCookieHeader(baseURL, tamper(token)) },
      maxRedirects: 0,
    })
    expectLoginRedirect(tampered)
    expect(clearsCookie(tampered, adminCookieName(baseURL)), 'Set-Cookie xoá cookie bị sửa').toBe(true)
  })

  test('US-12: đăng xuất thì không vào lại được', async ({ page, context, request }) => {
    await loginAsAdmin(page)
    await page.getByRole('button', { name: 'Đăng xuất', exact: true }).click()
    await expect(page).toHaveURL(/\/admin\/login$/)
    await expect.poll(() => adminCookie(context)).toBeUndefined()

    await expect(page.getByRole('heading', { level: 1, name: 'Đăng nhập quản trị' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Đăng xuất' })).toHaveCount(0)
    // Without the cookie the proxy sends /admin/products back to the login, as for any visitor.
    expectLoginRedirect(await request.get('/admin/products', { maxRedirects: 0 }))
  })

  // Local only: on a deployment it would lock the runner's address out of the admin of that preview for 15 minutes,
  // and Vercel overwrites X-Forwarded-For anyway. Under `next start` the header a client sends is kept, so this run
  // counts as an address of its own and locks nobody else.
  test('US-12: sai 5 lần thì bị khoá', async ({ page }) => {
    test.skip(Boolean(process.env.BASE_URL), 'Khoá đăng nhập theo IP: trên deployment sẽ khoá admin của preview 15 phút')
    const password = adminPassword()
    await page.setExtraHTTPHeaders({
      'x-forwarded-for': `10.${randomInt(256)}.${randomInt(256)}.${randomInt(1, 255)}`,
    })
    await openLogin(page)
    const error = page.locator('#admin-password-error')
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const answered = waitForActionResponse(page)
      await submitPassword(page, `sai-lan-${attempt}`)
      await answered
      await expect(error).toHaveText(loginErrorMessage('wrong-password'))
    }
    // The sixth is refused although the password is right: the lock is checked before the password.
    const answered = waitForActionResponse(page)
    await submitPassword(page, password)
    await answered
    await expect(error).toHaveText(loginErrorMessage('locked'))
    await expect(page).toHaveURL(/\/admin\/login$/)
  })
})
