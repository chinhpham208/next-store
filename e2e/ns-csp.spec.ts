import type { Page } from '@playwright/test'
import { addToCart, waitForHydration } from './cart'
import { VIEWPORT_INDEPENDENT } from './catalog'
import { WRITE_TAG } from './production'
import { expect, test } from './test'

// NS-127 (plan M5 Task 12, ADR-0020): the baseline CSP of next.config.ts blocks nothing the shop pages use (inline RSC
// scripts, next/image, the local font, the cart's Server Actions), and the nonce CSP the proxy sets on /admin/* lets
// the admin pages hydrate: every script Next.js renders there carries the request's nonce. A prerendered admin shell
// would carry scripts without it (audit PR #105 L3): the browser refuses them, the form never hydrates, and the
// checks below fail on both counts (a violation, and no React props on the button).
//
// Violations are collected from the page's `securitypolicyviolation` events and from the console, across every
// navigation of the test (the binding survives page loads, the init script runs in each new document).
test.skip(({ isMobile }) => isMobile, VIEWPORT_INDEPENDENT)

const PASSWORD = process.env.E2E_ADMIN_PASSWORD
const BASE_URL = process.env.BASE_URL
const NONCE_POLICY = /script-src 'self' 'nonce-[A-Za-z0-9+/]{22}==' 'strict-dynamic'/

// On a preview the Vercel Toolbar is injected into every page. The baseline lets it load (its sources are added to a
// Preview build, C4), so shop pages are checked with it. The admin nonce policy does not (ADR-0020: with a nonce,
// 'unsafe-inline' no longer applies to its inline styles), so admin pages on a deployment are checked without it,
// through Vercel's header for automated tests ("Disable toolbar for automation"). It only turns the toolbar off.
const withoutToolbar = async (page: Page): Promise<void> => {
  if (BASE_URL) await page.setExtraHTTPHeaders({ 'x-vercel-skip-toolbar': '1' })
}

const watchCsp = async (page: Page): Promise<string[]> => {
  const violations: string[] = []
  await page.exposeFunction('__nsCspViolation', (line: string) => violations.push(line))
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (event) => {
      const report = (window as unknown as { __nsCspViolation?: (line: string) => void }).__nsCspViolation
      report?.(`${event.effectiveDirective} chặn ${event.blockedURI || 'inline'} (${event.sourceFile || '?'}:${event.lineNumber})`)
    })
  })
  page.on('console', (message) => {
    if (/Content Security Policy/i.test(message.text())) violations.push(`console: ${message.text()}`)
  })
  return violations
}

test.describe('NS-127: CSP nền không chặn trang cửa hàng', () => {
  for (const path of ['/', '/products', '/products/ao-git-push-force', '/cart', '/blog', '/blog/chao-mung-den-next-store']) {
    test(`không có vi phạm CSP trên ${path}`, async ({ page }) => {
      const violations = await watchCsp(page)
      const response = await page.goto(path)
      expect(response?.status()).toBe(200)
      // Shop pages keep the baseline: no nonce, or they would stop being prerendered (D3).
      const policy = response?.headers()['content-security-policy'] ?? ''
      expect(policy).toContain("script-src 'self' 'unsafe-inline'")
      expect(policy).not.toContain('nonce-')
      await page.waitForLoadState('load')
      expect(violations).toEqual([])
    })
  }

  test('không có vi phạm CSP khi xem chi tiết rồi thêm vào giỏ', { tag: WRITE_TAG }, async ({ page }) => {
    const violations = await watchCsp(page)
    await addToCart(page, { slug: 'ao-404-not-found' })
    await page.goto('/cart')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    expect(violations).toEqual([])
  })
})

test.describe('NS-127: CSP nonce cho /admin', () => {
  test('trang đăng nhập có CSP nonce, hydrate được, không có vi phạm', async ({ page }) => {
    await withoutToolbar(page)
    const violations = await watchCsp(page)
    const response = await page.goto('/admin/login')
    expect(response?.status()).toBe(200)
    const policy = response?.headers()['content-security-policy'] ?? ''
    expect(policy).toMatch(NONCE_POLICY)
    expect(policy).not.toContain("'unsafe-inline'")
    // Every <script> of the served HTML carries the nonce of this response. Read from the HTML, not the DOM: chunks
    // the page adds later are allowed through 'strict-dynamic' and carry none.
    const nonce = /'nonce-([^']+)'/.exec(policy)?.[1]
    const scripts = ((await response?.text()) ?? '').match(/<script[ >][^>]*/g) ?? []
    expect(scripts.length).toBeGreaterThan(0)
    for (const script of scripts) expect(script).toContain(`nonce="${nonce}"`)
    await waitForHydration(page.getByRole('button', { name: 'Đăng nhập' }))
    expect(violations).toEqual([])
  })

  test('mỗi request admin có nonce mới', async ({ request }) => {
    const nonces = new Set<string | undefined>()
    for (let i = 0; i < 3; i += 1) {
      const policy = (await request.get('/admin/login')).headers()['content-security-policy'] ?? ''
      nonces.add(/'nonce-([^']+)'/.exec(policy)?.[1])
    }
    expect(nonces.has(undefined)).toBe(false)
    expect(nonces.size).toBe(3)
  })

  test('đăng nhập rồi gửi form sửa sản phẩm, không có vi phạm', { tag: WRITE_TAG }, async ({ page }) => {
    test.skip(!PASSWORD, 'Không có E2E_ADMIN_PASSWORD: không đăng nhập được')
    await withoutToolbar(page)
    const violations = await watchCsp(page)
    await page.goto('/admin/login')
    const submit = page.getByRole('button', { name: 'Đăng nhập' })
    await waitForHydration(submit)
    // Set without fill(): a fill step records the value in the report (as in ns-123-admin-guard.spec.ts).
    await page.locator('#admin-password').evaluate((input, value) => {
      if (input instanceof HTMLInputElement) input.value = value
    }, PASSWORD ?? '')
    await submit.click()
    await expect(page).toHaveURL(/\/admin\/products$/, { timeout: 20_000 })

    const response = await page.goto('/admin/products/ao-git-push-force')
    expect(response?.headers()['content-security-policy'] ?? '').toMatch(NONCE_POLICY)
    const save = page.getByRole('button', { name: 'Lưu' })
    await waitForHydration(save)
    // A negative price: the action answers with a field error and writes nothing (the product stays as seeded).
    await page.locator('[name="price"]').fill('-1')
    await save.click()
    await expect(page.locator('[name="price"]')).toHaveAttribute('aria-invalid', 'true')
    await expect(page.getByText('Giá không được âm')).toBeVisible()
    expect(violations).toEqual([])
  })
})

// ADR-0020 10A: HSTS comes from Vercel (`*.vercel.app` is preloaded). Not set by the app, so not checked locally.
test('NS-127: HSTS có trên deployment Vercel', async ({ request }) => {
  test.skip(!BASE_URL?.startsWith('https://'), 'HSTS do Vercel đặt: chỉ kiểm trên deployment')
  const hsts = (await request.get('/')).headers()['strict-transport-security'] ?? ''
  const maxAge = Number(/max-age=(\d+)/i.exec(hsts)?.[1] ?? 0)
  expect(maxAge).toBeGreaterThanOrEqual(31_536_000)
})
