import { expect, test } from './test'
import { expectNoSeriousA11yViolations } from './axe'

const PRICE = /^\d{1,3}(\.\d{3})*\s₫$/
const CATEGORY = /^(Áo thun|Cốc|Sticker|Sách)$/

test.beforeEach(async ({ page }) => {
  await page.goto('/')
})

test('US-01: trang chủ hiện 6 sản phẩm nổi bật', async ({ page }) => {
  await expect(page.getByRole('list', { name: 'Sản phẩm nổi bật' }).getByRole('listitem')).toHaveCount(6)
})

test('US-01: mỗi sản phẩm có ảnh, tên, giá dạng 199.000 ₫ và tên danh mục', async ({ page }) => {
  const items = page.getByRole('list', { name: 'Sản phẩm nổi bật' }).getByRole('listitem')
  await expect(items).toHaveCount(6)
  for (const item of await items.all()) {
    const name = (await item.getByRole('heading', { level: 3 }).innerText()).trim()
    expect(name).not.toBe('')
    const image = item.getByRole('img', { name, exact: true })
    await image.scrollIntoViewIfNeeded()
    await expect(image).toBeVisible()
    await expect.poll(() => image.evaluate((el) => el instanceof HTMLImageElement && el.naturalWidth > 0)).toBe(true)
    await expect(item.getByText(PRICE)).toBeVisible()
    await expect(item.getByText(CATEGORY)).toBeVisible()
  }
})

test('US-01: header và trang chủ có lối vào danh sách sản phẩm', async ({ page }) => {
  await expect(page.getByRole('navigation', { name: 'Chính' }).getByRole('link', { name: 'Sản phẩm' })).toHaveAttribute(
    'href',
    '/products',
  )
  await expect(page.getByRole('main').getByRole('link', { name: 'Xem tất cả sản phẩm' })).toHaveAttribute('href', '/products')
})

test('US-01: trang chủ không có lỗi a11y serious / critical', async ({ page }) => {
  await expectNoSeriousA11yViolations(page)
})
