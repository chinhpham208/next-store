import { readFileSync } from 'node:fs'
import type { Page } from '@playwright/test'
import { expect, test } from './test'
import { BROKEN_DB_LOG, BROKEN_DB_URL, HUNG_DB_LOG, HUNG_DB_URL } from '../playwright.config'
import { expectNoSeriousA11yViolations } from './axe'
import { VIEWPORT_INDEPENDENT } from './catalog'
import { getUnknownProduct } from './product-fail-open'

const NOT_FOUND_TITLE = 'Không tìm thấy trang · next-store'
const PRERENDERED_SLUG = 'ao-git-push-force'
const PRERENDERED_NAME = 'Áo thun git push --force'

// A slug nobody has opened in this server's life: a cached result from an earlier run cannot answer it, so the
// 404 must come from the proxy on the first hit (ADR-0009, Review Focus 1).
const freshSlug = () => `chua-ai-mo-${Date.now()}-${Math.floor(Math.random() * 1e6)}`

const expectFriendly404 = async (page: Page) => {
  await expect(page).toHaveTitle(NOT_FOUND_TITLE)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Không tìm thấy trang')
  await expect(page.getByRole('banner')).toBeVisible()
  await expect(page.getByRole('contentinfo')).toBeVisible()
  await expect(page.getByText('This page could not be found')).toHaveCount(0)
}

const expectErrorPage = async (page: Page) => {
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Đã có lỗi xảy ra')
  await expect(page.getByRole('button', { name: 'Thử lại' })).toBeVisible()
  await expect(page.getByRole('banner')).toBeVisible()
  await expect(page.getByRole('contentinfo')).toBeVisible()
  // The thrown value never reaches the screen: no driver message, SQL or host.
  await expect(page.getByText(/ECONNREFUSED|postgres|select |127\.0\.0\.1/i)).toHaveCount(0)
}

test('US-05: /products/khong-ton-tai trả 404 và có link về danh sách sản phẩm', async ({ page }) => {
  const response = await page.goto('/products/khong-ton-tai')
  expect(response?.status()).toBe(404)
  await expectFriendly404(page)
  await page.getByRole('main').getByRole('link', { name: 'Xem tất cả sản phẩm' }).click()
  await expect(page).toHaveURL(/\/products$/)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Sản phẩm')
})

test('US-05 / NS-38: URL lạ trả 404 tiếng Việt có header, footer, tiêu đề ổn định', async ({ page }) => {
  const response = await page.goto('/khong-ton-tai')
  expect(response?.status()).toBe(404)
  await expectFriendly404(page)
  // NS-38: the title used to change after hydration, so it is read again once the page has settled.
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(1000)
  await expect(page).toHaveTitle(NOT_FOUND_TITLE)
  await page.getByRole('main').getByRole('link', { name: 'Về trang chủ' }).click()
  await expect(page).toHaveURL(/\/$/)
})

test('US-05: nút back từ trang 404 về đúng trang trước', async ({ page }) => {
  await page.goto(`/products/${PRERENDERED_SLUG}`)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(PRERENDERED_NAME)
  await page.goto('/products/khong-ton-tai')
  await expectFriendly404(page)
  await page.goBack()
  await expect(page).toHaveURL(new RegExp(`/products/${PRERENDERED_SLUG}$`))
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(PRERENDERED_NAME)
})

test('US-05: trang 404 không có lỗi a11y serious / critical', async ({ page }) => {
  await page.goto('/products/khong-ton-tai')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Không tìm thấy trang')
  await expectNoSeriousA11yViolations(page)
})

// Status codes and raw HTML: nothing here depends on the viewport, so it runs once.
test.describe('HTTP', () => {
  test.skip(({ isMobile }) => isMobile, VIEWPORT_INDEPENDENT)

  // On Production a fail-open (200) of the lookup is only a warning (NS-79, e2e/product-fail-open.ts).
  test('US-05: slug chưa từng được mở vẫn trả 404 ngay lần đầu', async ({ request }) => {
    const response = await getUnknownProduct(request, `/products/${freshSlug()}`)
    if (!response) return
    const html = await response.text()
    expect(html.match(/<title>[^<]*<\/title>/g)).toEqual([`<title>${NOT_FOUND_TITLE}</title>`])
    expect(html).toContain('Xem tất cả sản phẩm')
    expect(html).not.toContain('This page could not be found')
  })

  // The App Router fetches a page as RSC (`RSC: 1` header, `.rsc` suffix) and prefetches its segments
  // (`.segments/_tree.segment.rsc`); each form must 404 for an unknown slug. A real product's forms must still reach
  // the page; `next start` never serves the segment path form (it 404s even for `/`, scripts/smoke.sh), so that one
  // is checked only for the unknown slug here and for the known one by smoke on each deployment.
  for (const [form, suffix, headers, knownServes] of [
    ['RSC: 1', '', { RSC: '1' }, true],
    ['.rsc', '.rsc', {}, true],
    ['segment prefetch', '.segments/_tree.segment.rsc', { RSC: '1' }, false],
  ] as const) {
    test(`US-05: dạng vận chuyển ${form} của slug lạ trả 404 ngay lần đầu`, async ({ request }) => {
      await getUnknownProduct(request, `/products/${freshSlug()}${suffix}`, { headers })
      if (!knownServes) return
      const known = await request.get(`/products/${PRERENDERED_SLUG}${suffix}`, { headers })
      expect(known.status(), 'slug có thật').toBe(200)
    })
  }

  test('US-05: slug sai định dạng trả 404', async ({ request }) => {
    for (const slug of ['Sai_Dang', 'a%20b', 'AO-GIT-PUSH-FORCE', 'ao%2Dgit%2Dpush%2Dforce', `${'a'.repeat(81)}`]) {
      expect((await request.get(`/products/${slug}`)).status(), slug).toBe(404)
    }
  })

  test('US-05: đường dẫn lạ quanh trang sản phẩm trả 404', async ({ request }) => {
    for (const path of [
      `/products/${PRERENDERED_SLUG}/them`,
      `/products/${PRERENDERED_SLUG}.json`,
      `/PRODUCTS/${PRERENDERED_SLUG}`,
    ]) {
      expect((await request.get(path)).status(), path).toBe(404)
    }
  })
})

// Needs the second local server whose DATABASE_URL points at a closed port (playwright.config.ts). A deployed
// database cannot be switched off, so the group skips with BASE_URL.
test.describe('DB không đọc được', () => {
  test.skip(Boolean(process.env.BASE_URL), 'Chỉ chạy với server local có DATABASE_URL chết')

  test('US-05: lỗi đọc DB hiện trang lỗi có nút thử lại', async ({ page }) => {
    await page.goto(`${BROKEN_DB_URL}/products?q=git`)
    await expectErrorPage(page)
    await expect(page).toHaveTitle('Đã có lỗi xảy ra · next-store')
    await page.getByRole('button', { name: 'Thử lại' }).click()
    // The database is still down: the retry lands on the error page again, never on a blank page.
    await expectErrorPage(page)
  })

  test('US-05: DB chết thì trang sản phẩm đã prerender vẫn mở được', async ({ page }) => {
    const response = await page.goto(`${BROKEN_DB_URL}/products/${PRERENDERED_SLUG}`)
    expect(response?.status()).toBe(200)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(PRERENDERED_NAME)
  })

  test('US-05: DB chết thì slug lạ hiện trang lỗi, không treo', async ({ page }) => {
    await page.goto(`${BROKEN_DB_URL}/products/${freshSlug()}`, { timeout: 15_000 })
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Đã có lỗi xảy ra', { timeout: 15_000 })
    await expectErrorPage(page)
  })

  test('US-05: DB chết thì slug sai định dạng vẫn trả 404 ngay', async ({ request, isMobile }) => {
    test.skip(isMobile, VIEWPORT_INDEPENDENT)
    expect((await request.get(`${BROKEN_DB_URL}/products/Sai_Dang`)).status()).toBe(404)
  })

  test('US-05: trang lỗi không có lỗi a11y serious / critical', async ({ page }) => {
    await page.goto(`${BROKEN_DB_URL}/products?q=git`)
    await expectErrorPage(page)
    await expectNoSeriousA11yViolations(page)
  })
})

// NS-55: what the servers print when the database is down or hangs. Drizzle's own error ("Failed query: <sql>
// params: <values>", cause "connect ECONNREFUSED 127.0.0.1:9") must never reach the log; only dbQuery's fixed text.
const LEAKED_QUERY_DETAIL = /Failed query|select |from "|params|127\.0\.0\.1:\d|ECONNREFUSED 127/i

const expectCleanLog = (path: string, expected: string) => {
  const log = readFileSync(path, 'utf8')
  expect(log).toContain(expected)
  expect(log).not.toMatch(LEAKED_QUERY_DETAIL)
}

test.describe('NS-55: DB chết hoặc treo', () => {
  test.skip(Boolean(process.env.BASE_URL), 'Chỉ chạy với server local có DATABASE_URL chết / treo')

  test('NS-55: log server không có câu SQL hay host khi DB chết', async ({ page }) => {
    for (const path of ['/products', '/products?q=git', `/products/${freshSlug()}`]) {
      await page.goto(`${BROKEN_DB_URL}${path}`)
      await expect(page.getByRole('heading', { level: 1, name: 'Đã có lỗi xảy ra' }), path).toBeVisible()
    }
    expectCleanLog(BROKEN_DB_LOG, 'database query failed: products.')
  })

  // The hung server runs with DB_QUERY_TIMEOUT_MS=1000 (playwright.config.ts); without the limit a request waits
  // for connect_timeout (10 s).
  test('NS-55: DB treo thì trang lỗi hiện trong 4 giây', async ({ page }) => {
    for (const path of ['/products', '/products?q=git', `/products/${freshSlug()}`]) {
      const started = Date.now()
      await page.goto(`${HUNG_DB_URL}${path}`, { timeout: 15_000 })
      await expect(page.getByRole('heading', { level: 1, name: 'Đã có lỗi xảy ra' }), path).toBeVisible({
        timeout: 4000,
      })
      expect(Date.now() - started, path).toBeLessThan(5000)
    }
    expectCleanLog(HUNG_DB_LOG, 'database query timed out: products.')
  })

  test('NS-55: DB treo thì trang sản phẩm đã prerender vẫn mở được', async ({ page }) => {
    const response = await page.goto(`${HUNG_DB_URL}/products/${PRERENDERED_SLUG}`)
    expect(response?.status()).toBe(200)
    await expect(page.getByRole('heading', { level: 1, name: PRERENDERED_NAME })).toBeVisible()
  })
})
