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
  waitForActionResponse,
  waitForHydration,
} from './cart'
import { VIEWPORT_INDEPENDENT } from './catalog'
import { WRITE_TAG } from './production'
import { readMeta, readSitemap } from './seo'
import { delayActionTitleRow, heldTitleRows, titleCount, titleGaps, watchTitle } from './title'
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

// NS-113: the cart's own title, which every line action must leave in place (WCAG 2.4.2).
const CART_TITLE = 'Giỏ hàng · next-store'
// As US-06 (NS-107): longer than the gap measured on a loaded server, short enough for every step of one test.
const TITLE_ROW_DELAY_MS = 600
// "+" from 1 up to the line limit: 9 actions, each re-rendering the route (plan M4 D2). Stock of FIRST is 12.
const TITLE_STEPS = 9
const TITLE_STEPPED = productWithStock('ao-git-push-force', TITLE_STEPS + 1)
// Removed one by one, the last leaving the empty cart: four actions.
const TITLE_REMOVED = ['ao-git-push-force', 'ao-404-not-found', 'ao-hello-world', 'ao-sudo-make-me-coffee'].map((slug) =>
  productWithStock(slug, 1),
)
const SERVER_ANSWER = { timeout: 15_000 }

// Runs one line action and waits until the whole response is in, the held title row included, then checks the head
// is back to exactly the cart's title: nothing stays behind (a held copy or a second <title>).
const runAndSettle = async (page: Parameters<typeof addToCart>[0], act: () => Promise<void>, step: string) => {
  const answered = waitForActionResponse(page)
  await act()
  expect((await answered).status(), step).toBe(200)
  await expect(page.getByRole('main').locator('[aria-busy="true"]'), step).toHaveCount(0, SERVER_ANSWER)
  await expect.poll(() => heldTitleRows(page), SERVER_ANSWER).toBe(0)
  await expect(page, step).toHaveTitle(CART_TITLE)
  await expect.poll(() => titleCount(page)).toBe(1)
}

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

  // NS-113 (WCAG 2.4.2), as NS-107 on the product page: every line action re-renders the route in its response
  // (plan M4 D2) and Next.js remounts the head's metadata on each one, so /cart had no <title> until the title row
  // landed. The row is held back on every action (e2e/title.ts), which is the order that loses the title.
  test('US-07: /cart luôn có <title> khi sửa số lượng', async ({ page }) => {
    await delayActionTitleRow(page, TITLE_ROW_DELAY_MS)
    await addToCart(page, { slug: TITLE_STEPPED.slug })
    await openCart(page)
    const increase = cartLine(page, TITLE_STEPPED.name).getByRole('button', {
      name: `Tăng số lượng ${TITLE_STEPPED.name}`,
    })
    await waitForHydration(increase)
    await watchTitle(page)
    for (let quantity = 2; quantity <= TITLE_STEPS + 1; quantity++) {
      await runAndSettle(page, () => increase.click(), `lên ${quantity}`)
      await expect(lineQuantity(page, TITLE_STEPPED.name)).toHaveValue(String(quantity))
    }
    expect(await titleGaps(page)).toEqual([])
  })

  test('US-07: /cart luôn có <title> khi xoá dòng', async ({ page }) => {
    await delayActionTitleRow(page, TITLE_ROW_DELAY_MS)
    for (const product of TITLE_REMOVED) await addToCart(page, { slug: product.slug })
    await openCart(page)
    await expect(cartLines(page)).toHaveCount(TITLE_REMOVED.length)
    await watchTitle(page)
    for (const [index, product] of TITLE_REMOVED.entries()) {
      const button = cartLine(page, product.name).getByRole('button', { name: `Xoá ${product.name}`, exact: true })
      await waitForHydration(button)
      await runAndSettle(page, () => button.click(), `xoá ${product.name}`)
      await expect(cartLine(page, product.name)).toHaveCount(0)
      await expect(cartLines(page)).toHaveCount(TITLE_REMOVED.length - index - 1)
    }
    await expect(emptyCart(page)).toBeVisible()
    expect(await titleGaps(page)).toEqual([])
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
