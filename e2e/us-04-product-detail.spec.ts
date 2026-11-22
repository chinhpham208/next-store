import type { Page } from '@playwright/test'
import { expect, test } from './test'
import { PRODUCT_SEEDS } from '@/db/seed-data'
import { expectNoSeriousA11yViolations } from './axe'

// Seed facts (src/db/seed-data.ts): ao-git-push-force has stock 12, sach-clean-code is sold out, ao-404-not-found
// is featured (on the home page), coc-merge-conflict is in "Cốc". Read from the seed rather than copied.
const seedProduct = (slug: string) => {
  const product = PRODUCT_SEEDS.find((seed) => seed.slug === slug)
  if (!product) throw new Error(`Seed không có sản phẩm ${slug}`)
  return product
}

const IN_STOCK = seedProduct('ao-git-push-force')
const SOLD_OUT = seedProduct('sach-clean-code')
const FEATURED = seedProduct('ao-404-not-found')
const IN_COC = seedProduct('coc-merge-conflict')

// The header also has a "Sản phẩm" link (nav "Chính"), so breadcrumb links are always looked up in their nav.
const breadcrumb = (page: Page) => page.getByRole('navigation', { name: 'Đường dẫn' })

test(`US-04: /products/${IN_STOCK.slug} hiện ảnh, tên, mô tả, giá và "Còn ${IN_STOCK.stock} sản phẩm"`, async ({
  page,
}) => {
  const response = await page.goto(`/products/${IN_STOCK.slug}`)
  expect(response?.status()).toBe(200)
  const main = page.getByRole('main')
  await expect(main.getByRole('heading', { level: 1 })).toHaveText(IN_STOCK.name)
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)

  const image = main.getByRole('img', { name: IN_STOCK.name, exact: true })
  await expect(image).toBeVisible()
  await expect.poll(() => image.evaluate((el) => el instanceof HTMLImageElement && el.naturalWidth > 0)).toBe(true)

  await expect(main.getByText(IN_STOCK.description, { exact: true })).toBeVisible()
  await expect(main.getByText(/^199\.000\s₫$/)).toBeVisible()
  await expect(main.getByText(`Còn ${IN_STOCK.stock} sản phẩm`, { exact: true })).toBeVisible()
  await expect(main.getByText('Hết hàng')).toHaveCount(0)
  await expect(page).toHaveTitle(`${IN_STOCK.name} · next-store`)
})

test('US-04: sản phẩm hết hàng hiện "Hết hàng", không hiện số còn lại', async ({ page }) => {
  await page.goto(`/products/${SOLD_OUT.slug}`)
  const main = page.getByRole('main')
  await expect(main.getByRole('heading', { level: 1 })).toHaveText(SOLD_OUT.name)
  await expect(main.getByText('Hết hàng', { exact: true })).toBeVisible()
  await expect(main.getByText(/Còn \d+ sản phẩm/)).toHaveCount(0)
})

test('US-04: từ trang chủ bấm vào sản phẩm thì mở trang chi tiết', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('list', { name: 'Sản phẩm nổi bật' }).getByRole('link', { name: FEATURED.name }).click()
  await expect(page).toHaveURL(new RegExp(`/products/${FEATURED.slug}$`))
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(FEATURED.name)
})

// The card's link sits in the h3 and stretches over the card with ::after (Card `relative`, link
// `after:absolute after:inset-0`), so the image is not inside the link yet clicking it opens the product.
// Playwright's element click would refuse the image (the overlay is on top), so the click is a raw mouse click
// at the image's centre: exactly what a user does.
test('US-04: bấm vào ảnh của thẻ sản phẩm mở trang chi tiết', async ({ page }) => {
  await page.goto('/products?category=coc')
  const card = page.getByRole('list', { name: 'Danh sách sản phẩm' }).getByRole('listitem').first()
  const name = (await card.getByRole('heading', { level: 3 }).innerText()).trim()
  const href = await card.getByRole('link', { name, exact: true }).getAttribute('href')
  expect(href).toMatch(/^\/products\/[a-z0-9-]+$/)

  const image = card.getByRole('img', { name, exact: true })
  await image.scrollIntoViewIfNeeded()
  const box = await image.boundingBox()
  expect(box).not.toBeNull()
  if (!box) return
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)

  await expect(page).toHaveURL(new RegExp(`${href}$`))
  await expect(page.getByRole('heading', { level: 1, name, exact: true })).toBeVisible()
})

test('US-04: link danh mục dẫn về danh sách đã lọc', async ({ page }) => {
  await page.goto(`/products/${IN_COC.slug}`)
  await breadcrumb(page).getByRole('link', { name: 'Cốc', exact: true }).click()
  await expect(page).toHaveURL(/\/products\?category=coc$/)
  await expect(page.getByRole('list', { name: 'Danh sách sản phẩm' }).getByRole('listitem')).toHaveCount(6)
})

test('US-04: đường dẫn "Sản phẩm" về danh sách, "Trang chủ" về trang chủ', async ({ page }) => {
  await page.goto(`/products/${IN_COC.slug}`)
  await expect(breadcrumb(page).getByRole('link', { name: 'Trang chủ', exact: true })).toHaveAttribute('href', '/')
  await breadcrumb(page).getByRole('link', { name: 'Sản phẩm', exact: true }).click()
  await expect(page).toHaveURL(/\/products$/)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Sản phẩm')
})

for (const product of [IN_STOCK, SOLD_OUT]) {
  test(`US-04: trang chi tiết (${product.slug}) không có lỗi a11y serious / critical`, async ({ page }) => {
    await page.goto(`/products/${product.slug}`)
    await expect(page.getByRole('main').getByRole('heading', { level: 1 })).toHaveText(product.name)
    await expectNoSeriousA11yViolations(page)
  })
}
