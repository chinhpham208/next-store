import { expect, test, type Page } from '@playwright/test'
import { PRODUCT_SEEDS } from '@/db/seed-data'
import {
  categoryNav,
  paginationNav,
  productItems,
  productList,
  productNames,
  productPrices,
  resultCount,
  searchBox,
  sortNav,
  VIEWPORT_INDEPENDENT,
} from './catalog'

// Seed assumptions (src/db/seed-data.ts, read from there rather than copied): "Sách" has 6 products with six
// different prices (so price-desc has no ties); "Cốc" has exactly one name containing "merge" (Cốc Merge
// Conflict); "Sticker" has 6 products and 6 names containing "sticker"; 24 products in all, 12 per page.
const SHARED = '/products?category=sach&sort=price-desc'
const SHARED_PRICES = PRODUCT_SEEDS.filter((product) => product.categorySlug === 'sach')
  .map((product) => product.price)
  .sort((a, b) => b - a)

const STICKER_PRICES_ASC = PRODUCT_SEEDS.filter((product) => product.categorySlug === 'sticker')
  .map((product) => product.price)
  .sort((a, b) => a - b)

const categoryLink = (page: Page, name: string) => categoryNav(page).getByRole('link', { name, exact: true })
const sortLink = (page: Page, name: string) => sortNav(page).getByRole('link', { name, exact: true })
const pageLink = (page: Page, name: string) => paginationNav(page).getByRole('link', { name, exact: true })

// Each "đổi bộ lọc" test below navigates only through client-side <Link>s, so it also shows the content follows
// the URL after a soft navigation, not just after a full load. The test asserts what the user sees; the mechanism
// that makes it hold (searchParams reads tracked for the client segment cache, NS-50 audit) is pinned down by
// src/features/products/schema.test.ts. A full reload would hide a stale payload, so the window is marked and the
// mark must survive.
const markWindow = (page: Page) => page.evaluate(() => Object.assign(window, { __nsNoReload: true }))
const expectNoReload = async (page: Page) => expect(await page.evaluate(() => '__nsNoReload' in window)).toBe(true)

test('US-03: URL có bộ lọc mở ở trình duyệt khác thấy đúng cùng kết quả', async ({
  page,
  browser,
  baseURL,
  extraHTTPHeaders,
}) => {
  await page.goto(SHARED)
  await expect(productItems(page)).toHaveCount(6)
  expect(await productPrices(page)).toEqual(SHARED_PRICES)
  const mine = await productNames(page)

  // A fresh context: no cookies, storage or history shared with the first one. It does not inherit the config's
  // `use`, so the base URL and the preview bypass header are passed on explicitly.
  const context = await browser.newContext({ baseURL, extraHTTPHeaders })
  try {
    const friend = await context.newPage()
    await friend.goto(SHARED)
    await expect(productItems(friend)).toHaveCount(6)
    expect(await productNames(friend)).toEqual(mine)
    expect(await productPrices(friend)).toEqual(SHARED_PRICES)
    await expect(categoryLink(friend, 'Sách')).toHaveAttribute('aria-current', 'true')
    await expect(sortLink(friend, 'Giá giảm dần')).toHaveAttribute('aria-current', 'true')
  } finally {
    await context.close()
  }
})

test('US-03: đổi bộ lọc trên giao diện thì URL cập nhật theo', async ({ page }) => {
  await page.goto('/products')
  await expect(resultCount(page)).toHaveText('24 sản phẩm')

  await categoryLink(page, 'Cốc').click()
  await expect(page).toHaveURL(/\/products\?category=coc$/)
  await expect(resultCount(page)).toHaveText('6 sản phẩm')

  await sortLink(page, 'Giá giảm dần').click()
  await expect(page).toHaveURL(/\/products\?category=coc&sort=price-desc$/)

  await searchBox(page).fill('merge')
  await page.getByRole('button', { name: 'Tìm', exact: true }).click()
  await expect(page).toHaveURL(/[?&]q=merge(&|$)/)
  await expect(page).toHaveURL(/[?&]category=coc(&|$)/)
  await expect(page).toHaveURL(/[?&]sort=price-desc(&|$)/)
  await expect(page).not.toHaveURL(/[?&]page=/)
  await expect(resultCount(page)).toHaveText('1 sản phẩm')
  expect(await productNames(page)).toEqual(['Cốc Merge Conflict'])
  await expect(categoryLink(page, 'Cốc')).toHaveAttribute('aria-current', 'true')
  await expect(searchBox(page)).toHaveValue('merge')
})

test('US-03: tìm bằng phím Enter thì URL có từ khoá', async ({ page }) => {
  await page.goto('/products?sort=price-asc')
  await searchBox(page).fill('sticker')
  await searchBox(page).press('Enter')
  await expect(page).toHaveURL(/[?&]q=sticker(&|$)/)
  await expect(page).toHaveURL(/[?&]sort=price-asc(&|$)/)
  await expect(resultCount(page)).toHaveText('6 sản phẩm')
})

test('US-03: đổi danh mục hoặc sắp xếp từ trang 2 thì về trang 1', async ({ page }) => {
  await page.goto('/products?page=2')
  await expect(pageLink(page, '2')).toHaveAttribute('aria-current', 'page')
  await sortLink(page, 'Giá tăng dần').click()
  await expect(page).toHaveURL(/\/products\?sort=price-asc$/)
  await expect(pageLink(page, '1')).toHaveAttribute('aria-current', 'page')
  await pageLink(page, '2').click()
  await expect(page).toHaveURL(/\/products\?sort=price-asc&page=2$/)
  await categoryLink(page, 'Sticker').click()
  await expect(page).toHaveURL(/\/products\?category=sticker&sort=price-asc$/)
})

test('US-03: chuyển trang bằng link thì URL và nội dung theo nhau', async ({ page }) => {
  await page.goto('/products')
  await expect(productItems(page)).toHaveCount(12)
  const first = await productNames(page)
  await markWindow(page)

  await pageLink(page, 'Trang sau').click()
  await expect(page).toHaveURL(/\/products\?page=2$/)
  await expect(pageLink(page, '2')).toHaveAttribute('aria-current', 'page')
  await expect.poll(() => productNames(page)).not.toEqual(first)
  const second = await productNames(page)
  expect(second).toHaveLength(12)
  expect(new Set([...first, ...second]).size).toBe(24)

  // Second visit to each page: the one a wrongly keyed client cache would answer with the other page.
  await pageLink(page, '1').click()
  await expect(page).toHaveURL(/\/products$/)
  await expect.poll(() => productNames(page)).toEqual(first)
  await pageLink(page, '2').click()
  await expect(page).toHaveURL(/\/products\?page=2$/)
  await expect.poll(() => productNames(page)).toEqual(second)
  await expectNoReload(page)
})

test('US-03: chuyển danh mục bằng link thì URL và nội dung theo nhau', async ({ page }) => {
  await page.goto('/products')
  await expect(resultCount(page)).toHaveText('24 sản phẩm')
  await markWindow(page)

  for (const [slug, label] of [
    ['coc', 'Cốc'],
    ['sach', 'Sách'],
    ['coc', 'Cốc'],
  ] as const) {
    await categoryLink(page, label).click()
    await expect(page).toHaveURL(new RegExp(`/products\\?category=${slug}$`))
    await expect(categoryLink(page, label)).toHaveAttribute('aria-current', 'true')
    await expect(resultCount(page)).toHaveText('6 sản phẩm')
    await expect(productItems(page)).toHaveCount(6)
    await expect(productList(page).getByText(label, { exact: true })).toHaveCount(6)
  }

  await categoryLink(page, 'Tất cả').click()
  await expect(page).toHaveURL(/\/products$/)
  await expect(resultCount(page)).toHaveText('24 sản phẩm')
  await expectNoReload(page)
})

test('US-03: sắp xếp bằng link thì URL và thứ tự theo nhau', async ({ page }) => {
  await page.goto('/products?category=sach')
  await expect(productItems(page)).toHaveCount(6)
  await markWindow(page)

  await sortLink(page, 'Giá tăng dần').click()
  await expect(page).toHaveURL(/\/products\?category=sach&sort=price-asc$/)
  await expect.poll(() => productPrices(page)).toEqual([...SHARED_PRICES].reverse())
  await sortLink(page, 'Giá giảm dần').click()
  await expect(page).toHaveURL(/\/products\?category=sach&sort=price-desc$/)
  await expect.poll(() => productPrices(page)).toEqual(SHARED_PRICES)
  await expectNoReload(page)
})

test('US-03: nút back / forward trả lại bộ lọc tương ứng với URL', async ({ page }) => {
  await page.goto('/products')
  await expect(resultCount(page)).toHaveText('24 sản phẩm')
  await categoryLink(page, 'Sticker').click()
  await expect(resultCount(page)).toHaveText('6 sản phẩm')
  await sortLink(page, 'Giá tăng dần').click()
  await expect(page).toHaveURL(/\/products\?category=sticker&sort=price-asc$/)
  // Ascending, and not the newest order it replaced (the seed's sticker prices are not in ascending order).
  await expect.poll(() => productPrices(page)).toEqual(STICKER_PRICES_ASC)

  await page.goBack()
  await expect(page).toHaveURL(/\/products\?category=sticker$/)
  await expect(sortLink(page, 'Mới nhất')).toHaveAttribute('aria-current', 'true')
  await page.goBack()
  await expect(page).toHaveURL(/\/products$/)
  await expect(resultCount(page)).toHaveText('24 sản phẩm')
  await expect(categoryLink(page, 'Tất cả')).toHaveAttribute('aria-current', 'true')
  await page.goForward()
  await page.goForward()
  await expect(page).toHaveURL(/\/products\?category=sticker&sort=price-asc$/)
  await expect.poll(() => productPrices(page)).toEqual(STICKER_PRICES_ASC)
})

// The search box is an uncontrolled input, so before NS-57 it kept the last typed text when Back / Forward changed
// q in the URL (the results followed the URL, the box did not).
test('US-03 / NS-57: sau Back và Forward, ô tìm khớp với URL', async ({ page }) => {
  await page.goto('/products')
  await searchBox(page).fill('cốc')
  await page.getByRole('button', { name: 'Tìm', exact: true }).click()
  await expect(resultCount(page)).toHaveText('6 sản phẩm')
  await page.goBack()
  await expect(resultCount(page)).toHaveText('24 sản phẩm')
  await expect(searchBox(page)).toHaveValue('')
  await page.goForward()
  await expect(resultCount(page)).toHaveText('6 sản phẩm')
  await expect(searchBox(page)).toHaveValue('cốc')
})

// Bad parameters are about what the server parses, not about layout: they run once (review of PR #28).
test.describe('tham số không hợp lệ', () => {
  test.skip(({ isMobile }) => isMobile, VIEWPORT_INDEPENDENT)

  // Each bad URL must render exactly what its "same as" URL renders: the bad part dropped, the rest kept.
  // page=9999 is well-formed but past the end, so it is clamped to the last page rather than reset.
  for (const [bad, sameAs] of [
    ['page=abc&sort=xyz', '/products'],
    ['page=0', '/products'],
    ['page=-1', '/products'],
    ['page=1.5', '/products'],
    ['page=9999', '/products?page=2'],
    ['sort=price-asc&sort=price-desc', '/products'],
    ['category=%00', '/products'],
    ['category=khong-co', '/products'],
    ['category=../../etc', '/products'],
    ['q=%00', '/products'],
    // Malformed percent-encoding is not decoded: the raw text is searched literally, which matches nothing.
    ['q=%E0%A4%A', '/products?q=%25E0%25A4%25A'],
    ['category=ao-thun&page=abc&sort=xyz', '/products?category=ao-thun'],
  ] as const) {
    test(`US-03: tham số không hợp lệ (${bad}) dùng mặc định, không lỗi`, async ({ page }) => {
      await page.goto(sameAs)
      await expect(resultCount(page)).toHaveText(/^\d+ sản phẩm$/)
      const expected = await productNames(page)
      const expectedCount = await resultCount(page).innerText()

      const response = await page.goto(`/products?${bad}`)
      expect(response?.status()).toBe(200)
      await expect(resultCount(page)).toHaveText(expectedCount)
      expect(await productNames(page)).toEqual(expected)
      await expect(page.getByRole('heading', { level: 1, name: 'Đã có lỗi xảy ra' })).toHaveCount(0)
    })
  }

  test('US-03: ?page=abc&sort=xyz đánh dấu đúng giá trị mặc định trên giao diện', async ({ page }) => {
    await page.goto('/products?page=abc&sort=xyz')
    await expect(sortLink(page, 'Mới nhất')).toHaveAttribute('aria-current', 'true')
    await expect(categoryLink(page, 'Tất cả')).toHaveAttribute('aria-current', 'true')
    await expect(pageLink(page, '1')).toHaveAttribute('aria-current', 'page')
  })

  test('US-03: từ khoá dài hơn 60 ký tự bị cắt, không lỗi', async ({ page }) => {
    const response = await page.goto(`/products?q=${'git'.repeat(100)}`)
    expect(response?.status()).toBe(200)
    await expect(resultCount(page)).toHaveText('0 sản phẩm')
    await expect(searchBox(page)).toHaveValue('git'.repeat(20))
  })
})
