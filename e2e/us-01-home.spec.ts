import { expect, test } from './test'
import { expectNoSeriousA11yViolations } from './axe'
import { latestPostsList, listedSlugs, POSTS_NEWEST_FIRST } from './blog'

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

test('US-01: trang chủ hiện 3 bài blog mới nhất', async ({ page }) => {
  const section = page.getByRole('region', { name: 'Bài viết mới' })
  await expect(section.getByRole('heading', { level: 2 })).toHaveText('Bài viết mới')
  const list = latestPostsList(page)
  await expect(list.getByRole('listitem')).toHaveCount(3)
  const latest = POSTS_NEWEST_FIRST.slice(0, 3)
  expect(await listedSlugs(list)).toEqual(latest.map((post) => post.slug))
  expect(await list.getByRole('heading', { level: 3 }).allInnerTexts()).toEqual(latest.map((post) => post.title))
  const oldest = POSTS_NEWEST_FIRST.at(-1)!
  await expect(page.getByRole('main').locator(`a[href="/blog/${oldest.slug}"]`)).toHaveCount(0)
})

test('US-01: link "Xem tất cả bài viết" và link "Blog" trên header dẫn tới /blog', async ({ page }) => {
  const header = page.getByRole('navigation', { name: 'Chính' })
  // M4: the cart link follows "Blog"; it shows an icon only, its name is in aria-label (no cart yet: no number).
  expect(await header.getByRole('link').allInnerTexts()).toEqual(['Sản phẩm', 'Blog', ''])
  await expect(header.getByRole('link').nth(2)).toHaveAccessibleName('Giỏ hàng')
  await expect(header.getByRole('link').nth(2)).toHaveAttribute('href', '/cart')

  await page.getByRole('main').getByRole('link', { name: 'Xem tất cả bài viết' }).click()
  await expect(page).toHaveURL(/\/blog$/)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Blog')

  await page.goto('/')
  await header.getByRole('link', { name: 'Blog', exact: true }).click()
  await expect(page).toHaveURL(/\/blog$/)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Blog')
})

test('US-01: trang chủ không có lỗi a11y serious / critical', async ({ page }) => {
  // The scan must include the latest-posts section added in M3.
  await expect(latestPostsList(page).getByRole('listitem')).toHaveCount(3)
  await expectNoSeriousA11yViolations(page)
})
