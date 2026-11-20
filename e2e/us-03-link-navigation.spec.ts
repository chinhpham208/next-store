import { expect, test, type Page } from '@playwright/test'
import { expectNoSeriousA11yViolations } from './axe'

// Guards the vary-params bug (NS-50 audit): with Cache Components and partial prefetching, the client segment
// cache keys the listing by the search params the server saw being read. If a read escaped tracking, a <Link>
// from ?page=1 to ?page=2 (or between categories) would reuse the first payload: the URL changes, the content
// does not. Every step below is a client-side <Link> navigation, and the content is checked against the URL.

const grid = (page: Page) => page.getByRole('list', { name: 'Danh sách sản phẩm' })
const names = (page: Page) => grid(page).getByRole('heading', { level: 3 }).allInnerTexts()
const status = (page: Page) => page.getByRole('status')
const pagination = (page: Page) => page.getByRole('navigation', { name: 'Phân trang' })
const categoryLink = (page: Page, name: string) =>
  page.getByRole('navigation', { name: 'Danh mục' }).getByRole('link', { name, exact: true })

// A full reload would hide the bug, so each test marks the window and checks the mark survives.
const markWindow = (page: Page) => page.evaluate(() => Object.assign(window, { __nsNoReload: true }))
const expectNoReload = async (page: Page) => expect(await page.evaluate(() => '__nsNoReload' in window)).toBe(true)

test('US-03: chuyển trang bằng link thì nội dung theo URL', async ({ page }) => {
  await page.goto('/products')
  await expect(grid(page).getByRole('listitem')).toHaveCount(12)
  const first = await names(page)
  await markWindow(page)

  await pagination(page).getByRole('link', { name: 'Trang sau' }).click()
  await expect(page).toHaveURL(/\/products\?page=2$/)
  await expect(pagination(page).getByRole('link', { name: '2', exact: true })).toHaveAttribute('aria-current', 'page')
  await expect.poll(() => names(page)).not.toEqual(first)
  const second = await names(page)
  expect(second).toHaveLength(12)
  expect(new Set([...first, ...second]).size).toBe(24)

  // Back and forth again: the second visit to each page is the one a stale segment cache would answer.
  await pagination(page).getByRole('link', { name: '1', exact: true }).click()
  await expect(page).toHaveURL(/\/products$/)
  await expect.poll(() => names(page)).toEqual(first)
  await pagination(page).getByRole('link', { name: '2', exact: true }).click()
  await expect(page).toHaveURL(/\/products\?page=2$/)
  await expect.poll(() => names(page)).toEqual(second)

  // Back / forward restore from the client's history cache, the other place a wrongly keyed segment would show.
  await page.goBack()
  await expect(page).toHaveURL(/\/products$/)
  await expect.poll(() => names(page)).toEqual(first)
  await page.goForward()
  await expect(page).toHaveURL(/\/products\?page=2$/)
  await expect.poll(() => names(page)).toEqual(second)
  await expectNoReload(page)
})

test('US-03: chuyển danh mục bằng link thì nội dung theo URL', async ({ page }) => {
  await page.goto('/products')
  await expect(status(page)).toHaveText('24 sản phẩm')
  await markWindow(page)

  for (const [slug, label] of [
    ['coc', 'Cốc'],
    ['sach', 'Sách'],
    ['coc', 'Cốc'],
  ] as const) {
    await categoryLink(page, label).click()
    await expect(page).toHaveURL(new RegExp(`/products\\?category=${slug}$`))
    await expect(categoryLink(page, label)).toHaveAttribute('aria-current', 'true')
    await expect(status(page)).toHaveText('6 sản phẩm')
    await expect(grid(page).getByRole('listitem')).toHaveCount(6)
    await expect(grid(page).getByText(label, { exact: true })).toHaveCount(6)
  }

  await categoryLink(page, 'Tất cả').click()
  await expect(page).toHaveURL(/\/products$/)
  await expect(status(page)).toHaveText('24 sản phẩm')
  await expectNoReload(page)
})

test('US-03: sắp xếp bằng link thì thứ tự theo URL', async ({ page }) => {
  await page.goto('/products?category=sach')
  await expect(grid(page).getByRole('listitem')).toHaveCount(6)
  await markWindow(page)
  const sort = page.getByRole('navigation', { name: 'Sắp xếp' })
  const prices = async () =>
    (await grid(page).getByText(/₫$/).allInnerTexts()).map((text) => Number(text.replace(/\D/g, '')))

  // Same six books in every order, so the expected order is the current prices sorted.
  const ascending = (await prices()).sort((a, b) => a - b)
  await sort.getByRole('link', { name: 'Giá tăng dần' }).click()
  await expect(page).toHaveURL(/\/products\?category=sach&sort=price-asc$/)
  await expect.poll(prices).toEqual(ascending)
  await sort.getByRole('link', { name: 'Giá giảm dần' }).click()
  await expect(page).toHaveURL(/\/products\?category=sach&sort=price-desc$/)
  await expect.poll(prices).toEqual([...ascending].reverse())
  await expectNoReload(page)
})

test('US-02: /products không có lỗi a11y serious / critical', async ({ page }) => {
  await page.goto('/products?category=coc&sort=price-asc')
  await expect(grid(page).getByRole('listitem')).toHaveCount(6)
  await expectNoSeriousA11yViolations(page)
  await page.goto('/products?q=khong-co-san-pham-nay')
  await expect(page.getByText('Không tìm thấy sản phẩm phù hợp.')).toBeVisible()
  await expectNoSeriousA11yViolations(page)
})
