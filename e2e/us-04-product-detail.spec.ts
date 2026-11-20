import { expect, test } from '@playwright/test'

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
