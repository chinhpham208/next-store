import { expect, test } from './test'
import { expectNoSeriousA11yViolations } from './axe'
import {
  addedStatus,
  addToCart,
  addToCartButton,
  cartBadgePending,
  cartCount,
  cartLink,
  type HeldAction,
  holdNextAction,
  openProduct,
  productWithStock,
  purchaseAlert,
  quantityField,
  waitForActionResponse,
  waitForHydration,
} from './cart'
import { WRITE_TAG } from './production'
import { delayActionTitleRow, heldTitleRows, titleCount, titleGaps, watchTitle } from './title'
import { CART_NETWORK_ERROR } from '@/features/cart/messages'

// US-06: the number on the cart icon goes up before the server answers, and goes back when the server fails. Every
// test but the a11y one adds to a cart, so it carries WRITE_TAG and Production leaves it out (conventions §7). Each
// test runs in its own browser context, so its cart starts empty and no other test touches it.
//
// The product: stock from the seed, at least the 3 the tests add at most, so no add here is refused for stock (that
// is US-08). Stock never changes during M4, so parallel tests may add the same product.
const PRODUCT = productWithStock('ao-git-push-force', 3)

// The first write after Neon's compute has slept can take 1–2 s (plan M4 Global Constraints); the default 5 s of
// expect is tight for an action plus the route's new render.
const SERVER_ANSWER = { timeout: 15_000 }

// NS-107: enough adds to catch a race seen in 2 of 8 runs, within the line limit (MAX_LINE_QUANTITY) and the stock.
const TITLE_ADDS = 8
const TITLE_PRODUCT = productWithStock('ao-git-push-force', TITLE_ADDS)
// Longer than the gap measured on a loaded server (about 300 ms), short enough for 8 adds in one test.
const TITLE_ROW_DELAY_MS = 600

test.describe('ghi vào giỏ', { tag: WRITE_TAG }, () => {
  test('US-06: bấm "Thêm vào giỏ" thì số trên biểu tượng giỏ tăng trước khi server trả lời', async ({
    page,
    baseURL,
  }) => {
    await openProduct(page, PRODUCT.slug)
    await expect(cartLink(page)).toHaveAccessibleName('Giỏ hàng')

    const held = await holdNextAction(page, baseURL)
    await addToCartButton(page).click()
    await held.request
    // The action is still held in the browser: the server has not even received it.
    await expect.poll(() => cartCount(page)).toBe(1)
    await expect(cartBadgePending(page)).toBeVisible()

    const answered = waitForActionResponse(page)
    await held.release()
    expect((await answered).status(), 'POST của action sau khi thả').toBe(200)
    await expect(addedStatus(page).or(purchaseAlert(page).getByRole('paragraph'))).toBeVisible(SERVER_ANSWER)
    await expect(purchaseAlert(page)).toHaveText('')
    await expect(addedStatus(page)).toBeVisible()
    await expect(cartBadgePending(page)).toHaveCount(0)
    expect(await cartCount(page)).toBe(1)

    await page.reload()
    await expect.poll(() => cartCount(page), SERVER_ANSWER).toBe(1)
  })

  for (const [variant, settle] of [
    ['server trả 500', (held: HeldAction) => held.fail(500)],
    ['mất mạng', (held: HeldAction) => held.abort()],
  ] as const) {
    test(`US-06: server báo lỗi thì số trở lại như cũ và có thông báo lỗi (${variant})`, async ({ page, baseURL }) => {
      await addToCart(page, { slug: PRODUCT.slug })
      await expect.poll(() => cartCount(page)).toBe(1)

      const held = await holdNextAction(page, baseURL)
      await addToCartButton(page).click()
      await held.request
      await expect.poll(() => cartCount(page)).toBe(2)

      await settle(held)
      await expect(purchaseAlert(page)).toHaveText(CART_NETWORK_ERROR)
      await expect.poll(() => cartCount(page)).toBe(1)
      await expect(cartBadgePending(page)).toHaveCount(0)
      await expect(addedStatus(page)).toHaveCount(0)
      // The failure stays next to the button: (shop)/error.tsx never takes over the page (plan M4 D6).
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(PRODUCT.name)
      await expect(page.getByRole('heading', { name: 'Đã có lỗi xảy ra' })).toHaveCount(0)

      // The server's cart is the one before the failed add.
      await page.reload()
      await expect.poll(() => cartCount(page), SERVER_ANSWER).toBe(1)
    })
  }

  // NS-107 (WCAG 2.4.2): every successful add re-renders the route in the action's response (plan M4 D2), and
  // Next.js remounts the head's metadata on each response, so the title was gone until its row arrived (2 of 8 runs
  // on a loaded `next start`). Adds in a row, each answered before the next, with the title watched throughout; the
  // second test holds the title row back on every add, which is the order that loses the title.
  for (const [variant, slowTitleRow] of [
    ['', false],
    [', hàng <title> của response đến chậm', true],
  ] as const) {
    test(`US-06: tiêu đề trang không bao giờ rỗng trong lúc thêm vào giỏ${variant}`, async ({ page }) => {
      if (slowTitleRow) await delayActionTitleRow(page, TITLE_ROW_DELAY_MS)
      await openProduct(page, TITLE_PRODUCT.slug)
      await watchTitle(page)
      for (let added = 1; added <= TITLE_ADDS; added++) {
        const answered = waitForActionResponse(page)
        await addToCartButton(page).click()
        expect((await answered).status(), `lần thêm ${added}`).toBe(200)
        await expect(cartBadgePending(page)).toHaveCount(0, SERVER_ANSWER)
        await expect.poll(() => cartCount(page), SERVER_ANSWER).toBe(added)
        // The held row lands after the count: wait until it has, so every add goes through the whole gap.
        await expect.poll(() => heldTitleRows(page), SERVER_ANSWER).toBe(0)
        await expect(page).toHaveTitle(`${TITLE_PRODUCT.name} · next-store`)
        // Settled, the head has exactly one title again: nothing stays behind after the add.
        await expect.poll(() => titleCount(page)).toBe(1)
      }
      expect(await titleGaps(page)).toEqual([])
    })
  }

  test('US-06: thêm hai lần cùng sản phẩm thì số là 2', async ({ page }) => {
    await openProduct(page, PRODUCT.slug)
    // Two clicks without waiting: the second queues behind the first (plan M4 D3), the button is never disabled.
    await addToCartButton(page).click()
    await addToCartButton(page).click()
    await expect(addedStatus(page)).toBeVisible(SERVER_ANSWER)
    await expect(cartBadgePending(page)).toHaveCount(0, SERVER_ANSWER)
    expect(await cartCount(page)).toBe(2)

    await page.goto('/cart')
    const lines = page.getByRole('list', { name: 'Sản phẩm trong giỏ' }).getByRole('listitem')
    await expect(lines).toHaveCount(1)
    await expect(lines.getByRole('link', { name: PRODUCT.name, exact: true })).toBeVisible()
    await expect(lines.getByRole('spinbutton', { name: `Số lượng ${PRODUCT.name}`, exact: true })).toHaveValue('2')
    await expect.poll(() => cartCount(page)).toBe(2)
  })

  test('US-06: thêm nhiều cái một lần', async ({ page }) => {
    await addToCart(page, { slug: PRODUCT.slug, quantity: 3 })
    await expect.poll(() => cartCount(page)).toBe(3)
    await expect(cartLink(page)).toHaveAccessibleName('Giỏ hàng, 3 sản phẩm')
  })

  test('US-06: thông báo thành công có link tới giỏ hàng', async ({ page }) => {
    await addToCart(page, { slug: PRODUCT.slug })
    const status = page.getByRole('region', { name: 'Mua hàng' }).getByRole('status')
    const link = status.getByRole('link', { name: 'Xem giỏ hàng', exact: true })
    await expect(link).toHaveAttribute('href', '/cart')
    // The success state (status with a link) is part of the main flow too (requirements §5, a11y).
    await expectNoSeriousA11yViolations(page)
    await waitForHydration(link)
    await link.click()
    await expect(page).toHaveURL(/\/cart$/)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Giỏ hàng')
    await expect(page.getByRole('list', { name: 'Sản phẩm trong giỏ' }).getByRole('listitem')).toHaveCount(1)
  })
})

// Read-only: the form is checked before anything is added, so it also runs on Production.
test('US-06: trang sản phẩm có form mua hàng không có lỗi a11y serious / critical', async ({ page }) => {
  await openProduct(page, PRODUCT.slug)
  await expect(quantityField(page)).toHaveValue('1')
  await expectNoSeriousA11yViolations(page)
})
