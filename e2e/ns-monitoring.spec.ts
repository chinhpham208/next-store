import { readFileSync, statSync } from 'node:fs'
import { BROKEN_DB_LOG, BROKEN_DB_URL } from '../playwright.config'
import { addToCartButton, purchaseAlert, waitForHydration } from './cart'
import { VIEWPORT_INDEPENDENT } from './catalog'
import { expect, test } from './test'

// NS-146 (plan M6 Task 12, ADR-0022): on a real build with a dead database, a render error writes one fixed log line
// and no more than 30 attempts a minute are made to record it. The server's output is read from the log file that
// playwright.config.ts redirects it to. A deployed BASE_URL has no switched-off database, and the log is on the
// machine that runs `next start`: local and CI only.
//
// The page is /cart with a cart cookie: it reads the database for the request, so it fails on this server, and no
// other spec opens it there, so the lines this spec counts are its own (the log is shared by every spec that opens a
// page of this server). The request carries a cookie, a query and a header with values the log must never show.
test.skip(({ isMobile }) => isMobile, VIEWPORT_INDEPENDENT)
test.skip(Boolean(process.env.BASE_URL), 'Chỉ chạy với server local có DATABASE_URL chết')

const SECRET = 'bi-mat'
const REQUEST_ERROR = 'monitoring: request error '
const RECORDING_FAILED = 'monitoring: recording failed'

const logSize = (): number => statSync(BROKEN_DB_LOG).size
const logSince = (offset: number): string => readFileSync(BROKEN_DB_LOG).subarray(offset).toString('utf8')
const linesWith = (text: string, needle: string): string[] => text.split('\n').filter((line) => line.includes(needle))
// The lines of /cart: its route path is the file's pattern, whatever the URL was.
const cartErrorLines = (text: string): string[] => linesWith(text, REQUEST_ERROR).filter((line) => line.includes('"routePath":"/cart'))

test.describe('NS-146: theo dõi lỗi server (server DB chết)', () => {
  test('monitoring: lỗi render ghi một dòng cố định, không có cookie, query hay header', async ({ request }) => {
    const cartId = crypto.randomUUID()
    const offset = logSize()
    const response = await request.get(`${BROKEN_DB_URL}/cart?q=${SECRET}`, {
      headers: { cookie: `ns_cart=${cartId}`, 'x-probe': `${SECRET}-header` },
    })
    // The error happens while the page streams: reading the body waits for the end of the render.
    await response.text()
    await expect.poll(() => cartErrorLines(logSince(offset)).length, { timeout: 15_000 }).toBeGreaterThan(0)
    // A second line for the same request (reported twice) would arrive moments after the first.
    await new Promise((resolve) => setTimeout(resolve, 1000))

    const slice = logSince(offset)
    const lines = cartErrorLines(slice)
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatch(
      /^monitoring: request error \{"routeType":"render","routePath":"\/cart[^"?#]*","digest":(null|"[A-Za-z0-9_-]{1,64}"),"errorName":"[A-Za-z]{1,40}"\}$/,
    )
    // Nothing of the request, whichever line it would have been on.
    expect(slice).not.toContain(cartId)
    expect(slice).not.toContain(SECRET)
    expect(slice).not.toMatch(/cookie|x-probe|ns_cart|127\.0\.0\.1:\d|Failed query/i)
  })

  test('monitoring: quá 30 lỗi một phút thì không thử ghi DB thêm', async ({ request }) => {
    test.setTimeout(90_000)
    const requests = 40
    const offset = logSize()
    for (let index = 0; index < requests; index += 1) {
      const response = await request.get(`${BROKEN_DB_URL}/cart?q=${SECRET}`, {
        headers: { cookie: `ns_cart=${crypto.randomUUID()}` },
      })
      await response.text()
    }
    // Every error is logged, the database is not tried for all of them.
    await expect.poll(() => cartErrorLines(logSince(offset)).length, { timeout: 20_000 }).toBeGreaterThanOrEqual(requests)
    await new Promise((resolve) => setTimeout(resolve, 1000))
    const failed = linesWith(logSince(offset), RECORDING_FAILED).length
    // Not zero: the attempts that the limit lets through do reach the dead database and fail (a green that came from
    // nothing being recorded would prove nothing). Not above 30: the limit of one instance in a minute.
    expect(failed).toBeGreaterThan(0)
    expect(failed).toBeLessThanOrEqual(30)
  })

  // The line is for errors that reach Next.js. A Server Action that catches the error of the database and answers
  // `unavailable` (the cart's) is not one: onRequestError does not run, and the table is not written (ADR-0022).
  test('monitoring: lỗi đã bắt trong Server Action không ghi dòng lỗi', async ({ page }) => {
    const offset = logSize()
    await page.goto(`${BROKEN_DB_URL}/products/ao-git-push-force`)
    const button = addToCartButton(page)
    await waitForHydration(button)
    await button.click()
    // The action answered (with its own message): the page did not fall over.
    await expect(purchaseAlert(page)).toHaveText(/\S/)
    await expect(page.getByRole('heading', { level: 1, name: 'Đã có lỗi xảy ra' })).toHaveCount(0)
    await new Promise((resolve) => setTimeout(resolve, 1000))
    expect(linesWith(logSince(offset), REQUEST_ERROR).filter((line) => line.includes('"routeType":"action"'))).toEqual([])
  })
})
