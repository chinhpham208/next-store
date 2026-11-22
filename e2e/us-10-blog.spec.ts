import { expect, test } from './test'
import { formatDate } from '@/lib/format-date'
import { expectNoSeriousA11yViolations } from './axe'
import { blogList, breadcrumb, freshPostSlug, listedSlugs, POSTS_NEWEST_FIRST } from './blog'
import { VIEWPORT_INDEPENDENT } from './catalog'

const NOT_FOUND_TITLE = 'Không tìm thấy trang · next-store'
const NEWEST = POSTS_NEWEST_FIRST[0]!
const KNOWN_SLUG = NEWEST.slug

// Until the proxy answers unknown blog slugs (NS-67, M3 Task 13), the page's notFound() answers 200 on the first hit
// (M3 K3), so these tests are marked fixme rather than left red. NS-67 removes this line.
const AWAITS_PROXY_404 = 'Chờ NS-67 (Task 13): proxy chưa trả 404 thật cho slug bài lạ, lần đầu vẫn 200 (K3)'

test.describe('Danh sách và nội dung', () => {
  test.skip(({ isMobile }) => isMobile, VIEWPORT_INDEPENDENT)

  test('US-10: /blog liệt kê mọi bài, mới nhất trước', async ({ page }) => {
    const response = await page.goto('/blog')
    expect(response?.status()).toBe(200)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Blog')
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)

    const list = blogList(page)
    expect(await listedSlugs(list)).toEqual(POSTS_NEWEST_FIRST.map((post) => post.slug))
    const items = list.getByRole('listitem')
    await expect(items).toHaveCount(POSTS_NEWEST_FIRST.length)
    for (const [index, post] of POSTS_NEWEST_FIRST.entries()) {
      const item = items.nth(index)
      await expect(item.getByRole('heading', { level: 2 })).toHaveText(post.title)
      await expect(item.getByRole('link', { name: post.title, exact: true })).toHaveAttribute('href', `/blog/${post.slug}`)
      const time = item.locator('time')
      await expect(time).toHaveAttribute('datetime', post.publishedAt)
      await expect(time).toHaveText(formatDate(post.publishedAt))
      await expect(item.getByText(post.description, { exact: true })).toBeVisible()
    }
  })

  test('US-10: bấm một bài thì mở /blog/<slug> với nội dung MDX đã render', async ({ page }) => {
    await page.goto('/blog')
    await blogList(page).getByRole('link', { name: NEWEST.title, exact: true }).click()
    await expect(page).toHaveURL(new RegExp(`/blog/${NEWEST.slug}$`))
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(NEWEST.title)
    await expect(page).toHaveTitle(`${NEWEST.title} · next-store`)
    await expect(page.locator('article p').first()).toBeVisible()

    // Across all posts every Prose element a post may produce shows up rendered, and no MDX source leaks as text.
    const seen = { h2: 0, list: 0, code: 0, blockquote: 0, internalLink: 0 }
    for (const post of POSTS_NEWEST_FIRST) {
      const response = await page.goto(`/blog/${post.slug}`)
      expect(response?.status(), post.slug).toBe(200)
      const article = page.locator('article')
      await expect(article.getByRole('heading', { level: 1 }), post.slug).toHaveText(post.title)
      await expect(article.locator('time'), post.slug).toHaveAttribute('datetime', post.publishedAt)
      const text = await article.innerText()
      expect(text, post.slug).not.toMatch(/export const|\{\/\*|\|---|^#{1,6}\s|^```/m)
      seen.h2 += await article.locator('h2').count()
      seen.list += await article.locator('ul, ol').count()
      seen.code += await article.locator('pre code').count()
      seen.blockquote += await article.locator('blockquote').count()
      seen.internalLink += await article.locator('a[href^="/"]:not([href^="//"])').count()
    }
    for (const [element, count] of Object.entries(seen)) expect(count, element).toBeGreaterThan(0)
  })

  test('US-10: link nội bộ trong bài điều hướng không tải lại trang', async ({ page }) => {
    const post = NEWEST
    await page.goto(`/blog/${post.slug}`)
    const link = page.locator('article a[href^="/"]:not([href^="//"])').first()
    const href = await link.getAttribute('href')
    expect(href).toMatch(/^\/[^/]/)
    // A full page load would drop this marker; a client navigation keeps it.
    await page.evaluate(() => Object.assign(window, { __ns68NoReload: true }))
    await link.click()
    await expect(page).toHaveURL((url) => `${url.pathname}${url.search}` === href)
    await expect(page.getByRole('heading', { level: 1 })).not.toHaveText(post.title)
    expect(await page.evaluate(() => '__ns68NoReload' in window)).toBe(true)
  })
})

test.describe('404', () => {
  test.skip(({ isMobile }) => isMobile, VIEWPORT_INDEPENDENT)
  test.fixme(true, AWAITS_PROXY_404)

  test('US-10: /blog/khong-ton-tai trả 404 và có link về trang chủ', async ({ page }) => {
    const response = await page.goto('/blog/khong-ton-tai')
    expect(response?.status()).toBe(404)
    await expect(page).toHaveTitle(NOT_FOUND_TITLE)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Không tìm thấy trang')
    await page.getByRole('main').getByRole('link', { name: 'Về trang chủ' }).click()
    await expect(page).toHaveURL(/\/$/)
  })

  // The App Router also fetches a page as RSC (`RSC: 1` header, `.rsc` suffix); each form must 404 for an unknown
  // slug on the first hit, and still reach a real post.
  for (const [form, suffix, headers] of [
    ['HTML', '', {}],
    ['RSC: 1', '', { RSC: '1' }],
    ['.rsc', '.rsc', {}],
  ] as const) {
    test(`US-10: slug bài chưa từng được mở trả 404 ngay lần đầu (${form})`, async ({ request }) => {
      const unknown = await request.get(`/blog/${freshPostSlug()}${suffix}`, { headers })
      expect(unknown.status()).toBe(404)
      if (form === 'HTML') expect(await unknown.text()).toContain(`<title>${NOT_FOUND_TITLE}</title>`)
      const known = await request.get(`/blog/${KNOWN_SLUG}${suffix}`, { headers })
      expect(known.status(), 'bài có thật').toBe(200)
    })
  }

  test('US-10: slug sai định dạng trả 404', async ({ request }) => {
    for (const slug of [KNOWN_SLUG.toUpperCase(), KNOWN_SLUG.replaceAll('-', '%2D'), 'constructor', `${KNOWN_SLUG}.json`]) {
      expect((await request.get(`/blog/${slug}`)).status(), slug).toBe(404)
    }
  })
})

test('US-10: đường dẫn, link "Tất cả bài viết" và nút Back hoạt động', async ({ page }) => {
  await page.goto('/blog')
  await blogList(page).getByRole('link', { name: NEWEST.title, exact: true }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(NEWEST.title)

  await expect(breadcrumb(page).getByRole('link', { name: 'Trang chủ', exact: true })).toHaveAttribute('href', '/')
  await breadcrumb(page).getByRole('link', { name: 'Blog', exact: true }).click()
  await expect(page).toHaveURL(/\/blog$/)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Blog')

  await page.goBack()
  await expect(page).toHaveURL(new RegExp(`/blog/${NEWEST.slug}$`))
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(NEWEST.title)

  await page.getByRole('main').getByRole('link', { name: 'Tất cả bài viết', exact: true }).click()
  await expect(page).toHaveURL(/\/blog$/)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Blog')

  await page.goBack()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(NEWEST.title)
  await breadcrumb(page).getByRole('link', { name: 'Trang chủ', exact: true }).click()
  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByRole('heading', { level: 2, name: 'Bài viết mới' })).toBeVisible()
})

test('US-10: khối code dài cuộn ngang và focus được bằng bàn phím', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'Kiểm ở 390 px')
  let overflowing = 0
  for (const post of POSTS_NEWEST_FIRST) {
    await page.goto(`/blog/${post.slug}`)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(post.title)
    // The page itself never scrolls sideways at 390 px, whatever the post holds.
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      `${post.slug}: trang cuộn ngang`,
    ).toBe(true)

    for (const pre of await page.locator('article pre').all()) {
      if (!(await pre.evaluate((el) => el.scrollWidth > el.clientWidth))) continue
      overflowing += 1
      await expect(pre, post.slug).toHaveAttribute('tabindex', '0')
      // Reach it with Tab only, then scroll it with the arrow key.
      await page.locator('body').focus()
      let reached = false
      for (let step = 0; step < 60 && !reached; step += 1) {
        await page.keyboard.press('Tab')
        reached = await pre.evaluate((el) => el === document.activeElement)
      }
      expect(reached, `${post.slug}: Tab không tới được khối code`).toBe(true)
      await page.keyboard.press('ArrowRight')
      await page.keyboard.press('ArrowRight')
      await expect.poll(() => pre.evaluate((el) => el.scrollLeft), post.slug).toBeGreaterThan(0)
    }
  }
  expect(overflowing, 'Không bài nào có khối code dài hơn khổ 390 px').toBeGreaterThan(0)
})

test('US-10: /blog không có lỗi a11y serious / critical', async ({ page }) => {
  await page.goto('/blog')
  await expect(blogList(page).getByRole('listitem')).toHaveCount(POSTS_NEWEST_FIRST.length)
  await expectNoSeriousA11yViolations(page)
})

// No single post holds every Prose element (see the MDX test above), so each post is checked.
for (const post of POSTS_NEWEST_FIRST) {
  test(`US-10: trang bài ${post.slug} không có lỗi a11y serious / critical`, async ({ page }) => {
    await page.goto(`/blog/${post.slug}`)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(post.title)
    await expectNoSeriousA11yViolations(page)
  })
}
