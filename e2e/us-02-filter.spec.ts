import { expect, test } from '@playwright/test'
import { expectNoSeriousA11yViolations } from './axe'
import { PRODUCT_SEEDS } from '@/db/seed-data'
import {
  paginationNav,
  productItems,
  productList,
  productNames,
  productPrices,
  resultCount,
  VIEWPORT_INDEPENDENT,
} from './catalog'

// Seed (requirements.md §4, src/db/seed-data.ts): 4 categories × 6 products, 12 per page. The seed inserts every
// product in one transaction, so all rows share updated_at and the default sort ("Mới nhất": updated_at desc,
// id asc) is the order of PRODUCT_SEEDS. Holds on PGlite, Neon preview / Dev branches and the SQL seed of
// Production until an admin edits a product (M5).
const NEWEST_ORDER = PRODUCT_SEEDS.map((product) => product.name)
const GIT_PRODUCTS = NEWEST_ORDER.filter((name) => /git/i.test(name))
// Every t-shirt has its own price, so price-asc has no ties to break.
const AO_THUN_PRICES_ASC = PRODUCT_SEEDS.filter((product) => product.categorySlug === 'ao-thun')
  .map((product) => product.price)
  .sort((a, b) => a - b)

test('US-02: ?category=ao-thun chỉ hiện áo thun', async ({ page }) => {
  await page.goto('/products?category=ao-thun')
  await expect(resultCount(page)).toHaveText('6 sản phẩm')
  await expect(productItems(page)).toHaveCount(6)
  await expect(productList(page).getByText('Áo thun', { exact: true })).toHaveCount(6)
})

test('US-02: thêm sort=price-asc thì giá tăng dần', async ({ page }) => {
  await page.goto('/products?category=ao-thun&sort=price-asc')
  await expect(productItems(page)).toHaveCount(6)
  expect(await productPrices(page)).toEqual(AO_THUN_PRICES_ASC)
})

test('US-02: hơn 12 kết quả thì chia trang, ?page=2 hiện 12 sản phẩm tiếp theo', async ({ page }) => {
  await page.goto('/products')
  await expect(resultCount(page)).toHaveText('24 sản phẩm')
  await expect(productItems(page)).toHaveCount(12)
  const first = await productNames(page)
  expect(first).toEqual(NEWEST_ORDER.slice(0, 12))

  await page.goto('/products?page=2')
  await expect(productItems(page)).toHaveCount(12)
  await expect(paginationNav(page).getByRole('link', { name: '2', exact: true })).toHaveAttribute('aria-current', 'page')
  // The next 12, in order: page 2 continues exactly where page 1 stopped.
  expect(await productNames(page)).toEqual(NEWEST_ORDER.slice(12, 24))
})

test('US-02: ở trang đầu và trang cuối, nút bước không khả dụng không phải là link', async ({ page }) => {
  await page.goto('/products')
  await expect(paginationNav(page).getByRole('link', { name: 'Trang trước' })).toHaveCount(0)
  await expect(paginationNav(page).getByText('Trang trước')).toHaveAttribute('aria-disabled', 'true')
  await page.goto('/products?page=2')
  await expect(paginationNav(page).getByRole('link', { name: 'Trang sau' })).toHaveCount(0)
  await expect(paginationNav(page).getByText('Trang sau')).toHaveAttribute('aria-disabled', 'true')
})

test('US-02: 12 kết quả trở xuống thì không chia trang', async ({ page }) => {
  await page.goto('/products?category=sach')
  await expect(productItems(page)).toHaveCount(6)
  await expect(paginationNav(page)).toHaveCount(0)
})

test('US-02: không có kết quả thì hiện thông báo trống và link xoá bộ lọc', async ({ page }) => {
  await page.goto('/products?q=khong-co-san-pham-nay')
  await expect(resultCount(page)).toHaveText('0 sản phẩm')
  await expect(page.getByText('Không tìm thấy sản phẩm phù hợp.')).toBeVisible()
  await expect(productList(page)).toHaveCount(0)
  await expect(paginationNav(page)).toHaveCount(0)
  await page.getByRole('link', { name: 'Xoá bộ lọc' }).click()
  await expect(page).toHaveURL(/\/products$/)
  await expect(resultCount(page)).toHaveText('24 sản phẩm')
})

// Search results are data only: the same at 390 px, so they run once (review of PR #28).
test.describe('tìm kiếm', () => {
  test.skip(({ isMobile }) => isMobile, VIEWPORT_INDEPENDENT)

  test('US-02: ?q=git chỉ hiện sản phẩm có "git" trong tên, không phân biệt hoa thường', async ({ page }) => {
    for (const q of ['git', 'GIT', 'Git']) {
      await page.goto(`/products?q=${q}`)
      await expect(resultCount(page)).toHaveText('3 sản phẩm')
      expect(await productNames(page)).toEqual(GIT_PRODUCTS)
    }
  })

  // Runs against Neon on the preview (e2e-preview): PGlite and Neon may fold accented capitals differently.
  test('US-02: tìm không phân biệt hoa thường với chữ có dấu', async ({ page }) => {
    for (const [q, total] of [
      ['ÁO', '6 sản phẩm'],
      ['áo', '6 sản phẩm'],
      ['SÁCH', '6 sản phẩm'],
      ['CỐC', '6 sản phẩm'],
    ] as const) {
      await page.goto(`/products?q=${encodeURIComponent(q)}`)
      await expect(resultCount(page)).toHaveText(total)
    }
  })

  // %, _ are LIKE wildcards: they must match literally (no product name has them), not everything.
  test('US-02: ký tự đại diện của SQL trong từ khoá được tìm như chữ thường', async ({ page }) => {
    for (const q of ['%', '_', '%25']) {
      await page.goto(`/products?q=${encodeURIComponent(q)}`)
      await expect(resultCount(page)).toHaveText('0 sản phẩm')
    }
  })
})

for (const [state, url] of [
  ['mặc định', '/products'],
  ['lọc và sắp xếp', '/products?category=coc&sort=price-asc'],
  ['tìm kiếm', '/products?q=git'],
  ['trang 2', '/products?page=2'],
  ['không có kết quả', '/products?q=khong-co-san-pham-nay'],
] as const) {
  test(`US-02: danh sách (${state}) không có lỗi a11y serious / critical`, async ({ page }) => {
    await page.goto(url)
    // Wait for the streamed results, not the skeleton: axe must see the real filters and grid.
    await expect(resultCount(page)).toHaveText(/^\d+ sản phẩm$/)
    await expectNoSeriousA11yViolations(page)
  })
}
