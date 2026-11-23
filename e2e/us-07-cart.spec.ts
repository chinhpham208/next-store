import { expect, test } from './test'
import { expectNoSeriousA11yViolations } from './axe'
import {
  addToCart,
  cartCount,
  cartLine,
  cartLines,
  cartList,
  cartTotal,
  emptyCart,
  lineQuantity,
  openCart,
  productWithStock,
  removeLine,
  setQuantity,
  waitForHydration,
} from './cart'
import { VIEWPORT_INDEPENDENT } from './catalog'
import { WRITE_TAG } from './production'
import { readMeta, readSitemap } from './seo'
import { CART_TTL_DAYS } from '@/features/cart/limits'
import { formatPrice } from '@/lib/format-price'

// US-07: edit or remove a line and the total follows; set it to 0 and it goes; close the browser and the cart is
// still there. The tests that add carry WRITE_TAG (Production leaves them out, conventions §7); each runs in a
// fresh browser context, hence on a cart of its own. Prices and stock come from the seed (plan M4 Global
// Constraints); 2 is the most of one product a test puts in its cart.
const FIRST = productWithStock('ao-git-push-force', 2)
const SECOND = productWithStock('ao-404-not-found', 2)

const DAY_SECONDS = 86_400
// The cookie's Max-Age is CART_TTL_DAYS; a day off for clock skew and the time the test itself takes.
const MIN_COOKIE_LIFETIME = (CART_TTL_DAYS - 1) * DAY_SECONDS

const addBoth = async (page: Parameters<typeof addToCart>[0]) => {
  await addToCart(page, { slug: FIRST.slug })
  await addToCart(page, { slug: SECOND.slug })
  await openCart(page)
  await expect(cartLines(page)).toHaveCount(2)
  await expect(cartTotal(page)).toHaveText(formatPrice(FIRST.price + SECOND.price))
}

test.describe('ghi vào giỏ', { tag: WRITE_TAG }, () => {
  test('US-07: sửa số lượng thì tổng tiền cập nhật', async ({ page }) => {
    await addBoth(page)
    await setQuantity(page, FIRST.name, 2)
    await expect(lineQuantity(page, FIRST.name)).toHaveValue('2')
    await expect(cartTotal(page)).toHaveText(formatPrice(2 * FIRST.price + SECOND.price))
    await expect(cartLine(page, FIRST.name)).toContainText(formatPrice(2 * FIRST.price))
    await expect.poll(() => cartCount(page)).toBe(3)

    // The change is the server's, not only the page's.
    await openCart(page)
    await expect(lineQuantity(page, FIRST.name)).toHaveValue('2')
    await expect(cartTotal(page)).toHaveText(formatPrice(2 * FIRST.price + SECOND.price))
  })

  test('US-07: xoá một dòng thì dòng biến mất và tổng tiền cập nhật', async ({ page }) => {
    await addBoth(page)
    await removeLine(page, FIRST.name)
    await expect(cartLine(page, FIRST.name)).toHaveCount(0)
    await expect(cartLines(page)).toHaveCount(1)
    await expect(cartTotal(page)).toHaveText(formatPrice(SECOND.price))
    await expect.poll(() => cartCount(page)).toBe(1)

    await openCart(page)
    await expect(cartLines(page)).toHaveCount(1)
    await expect(cartLine(page, SECOND.name)).toHaveCount(1)
  })

  test('US-07: đặt số lượng về 0 thì sản phẩm bị xoá khỏi giỏ', async ({ page }) => {
    await addBoth(page)
    // Typed 0, then Enter.
    await setQuantity(page, FIRST.name, 0)
    await expect(cartLine(page, FIRST.name)).toHaveCount(0)
    await expect(cartTotal(page)).toHaveText(formatPrice(SECOND.price))
    await expect.poll(() => cartCount(page)).toBe(1)

    // "−" at 1 goes to 0 too, and the last line going leaves the empty cart.
    const decrease = cartLine(page, SECOND.name).getByRole('button', { name: `Giảm số lượng ${SECOND.name}` })
    await waitForHydration(decrease)
    await decrease.click()
    await expect(emptyCart(page)).toBeVisible({ timeout: 15_000 })
    await expect(cartList(page)).toHaveCount(0)
    await expect(cartTotal(page)).toHaveCount(0)
    await expect.poll(() => cartCount(page)).toBeNull()

    await openCart(page)
    await expect(emptyCart(page)).toBeVisible()
  })

  test('US-07: đóng trình duyệt và mở lại thì giỏ vẫn còn', async ({ newContext }) => {
    const first = await newContext()
    const page = await first.newPage()
    await addToCart(page, { slug: FIRST.slug, quantity: 2 })

    // A session cookie (no Max-Age) would be gone once the browser closes, yet storageState keeps it with
    // expires -1, so the lifetime is checked on the cookie itself (Review Focus 3).
    const cookies = (await first.cookies()).filter((cookie) => /^(__Host-)?ns_cart$/.test(cookie.name))
    expect(cookies).toHaveLength(1)
    const [cookie] = cookies
    expect(cookie?.httpOnly).toBe(true)
    expect(cookie?.sameSite).toBe('Lax')
    expect(cookie?.path).toBe('/')
    expect(cookie?.expires ?? -1).toBeGreaterThanOrEqual(Date.now() / 1000 + MIN_COOKIE_LIFETIME)

    // Close the browser: only what a real browser keeps on disk survives, so session cookies are dropped.
    const state = await first.storageState()
    await first.close()
    const reopened = await newContext({
      storageState: { ...state, cookies: state.cookies.filter((saved) => saved.expires !== -1) },
    })
    const again = await reopened.newPage()
    await openCart(again)
    await expect(cartLines(again)).toHaveCount(1)
    await expect(lineQuantity(again, FIRST.name)).toHaveValue('2')
    await expect(cartTotal(again)).toHaveText(formatPrice(2 * FIRST.price))
    await expect.poll(() => cartCount(again)).toBe(2)
  })

  test('US-07: /cart có hàng không có lỗi a11y serious / critical', async ({ page }) => {
    await addBoth(page)
    await expectNoSeriousA11yViolations(page)
  })
})

// Read-only: nothing is added, so these also run on Production.
test('US-07: giỏ trống khi chưa thêm gì', async ({ page, context }) => {
  await openCart(page)
  await expect(emptyCart(page)).toBeVisible()
  await expect(cartList(page)).toHaveCount(0)
  const browse = page.getByRole('main').getByRole('link', { name: 'Xem sản phẩm', exact: true })
  await expect(browse).toHaveAttribute('href', '/products')
  await expect.poll(() => cartCount(page)).toBeNull()
  // Reading the cart never creates one (ADR-0014: a cart only comes with the first successful add).
  expect((await context.cookies()).filter((cookie) => cookie.name.endsWith('ns_cart'))).toEqual([])
})

test('US-07: /cart trống không có lỗi a11y serious / critical', async ({ page }) => {
  await openCart(page)
  await expect(emptyCart(page)).toBeVisible()
  await expectNoSeriousA11yViolations(page)
})

test('US-07: /cart có noindex và không nằm trong sitemap', async ({ request, isMobile }) => {
  test.skip(isMobile, VIEWPORT_INDEPENDENT)
  const page = await request.get('/cart')
  expect(page.status()).toBe(200)
  const meta = readMeta(await page.text())
  expect(meta.robots).toMatch(/\bnoindex\b/)
  expect(meta.title).toBe('Giỏ hàng · next-store')

  const sitemap = await request.get('/sitemap.xml')
  expect(sitemap.status()).toBe(200)
  const paths = readSitemap(await sitemap.text()).map((entry) => new URL(entry.loc).pathname)
  expect(paths.length).toBeGreaterThan(0)
  expect(paths).not.toContain('/cart')
})
