import { expect, test } from './test'
import {
  addedStatus,
  addToCart,
  addToCartButton,
  cartCount,
  cartLine,
  cartLines,
  cartTotal,
  emptyCart,
  lineAlert,
  lineQuantity,
  openCart,
  openProduct,
  purchaseAlert,
  purchaseSection,
  quantityField,
  seedProduct,
  setQuantity,
  waitForActionResponse,
} from './cart'
import { WRITE_TAG } from './production'
import { PRODUCT_SEEDS } from '@/db/seed-data'
import { formatPrice } from '@/lib/format-price'

// US-08: above the stock is refused with "Chỉ còn N sản phẩm"; a sold-out product's button is disabled. The
// products come from the seed (plan M4 Task 14): the only one with stock 3 (the seed keeps it unique for US-08), and
// every one with stock 0. M4 never changes stock, so a run leaves them as it found them, and parallel tests may use
// the same product. Tests that add carry WRITE_TAG (Production leaves them out, conventions §7); each runs in a fresh
// browser context, hence on a cart of its own.
const withStock = (stock: number) =>
  PRODUCT_SEEDS.filter((product) => product.stock === stock).map((product) => seedProduct(product.slug))

const [LOW, ...otherLow] = withStock(3)
if (!LOW || otherLow.length > 0) throw new Error('Seed phải có đúng một sản phẩm còn 3 (US-08)')
const SOLD_OUT = withStock(0)
if (SOLD_OUT.length === 0) throw new Error('Seed phải có sản phẩm hết hàng (US-08)')

// The wording of US-08, with the seed's number.
const ONLY_LEFT = `Chỉ còn ${LOW.stock} sản phẩm`

const isCartCookie = (name: string) => /^(__Host-)?ns_cart$/.test(name)

// Fills the product page's field and clicks, then waits for the action's answer and its message.
const tryToAdd = async (page: Parameters<typeof openProduct>[0], quantity: number) => {
  await quantityField(page).fill(String(quantity))
  const answered = waitForActionResponse(page)
  await addToCartButton(page).click()
  await answered
}

test.describe('ghi vào giỏ', { tag: WRITE_TAG }, () => {
  test(`US-08: còn 3, thêm 4 thì bị từ chối với "Chỉ còn 3 sản phẩm"`, async ({ page, context }) => {
    await openProduct(page, LOW.slug)
    await tryToAdd(page, LOW.stock + 1)
    await expect(purchaseAlert(page)).toHaveText(ONLY_LEFT)
    await expect(addedStatus(page)).toHaveCount(0)
    // Back to the number before: no cart at all, since the first add was refused (ADR-0014: no empty cart).
    await expect.poll(() => cartCount(page)).toBeNull()
    expect((await context.cookies()).filter((cookie) => isCartCookie(cookie.name))).toEqual([])

    await openCart(page)
    await expect(emptyCart(page)).toBeVisible()
  })

  test('US-08: đã có 2 trong giỏ, thêm 2 nữa thì bị từ chối', async ({ page }) => {
    await addToCart(page, { slug: LOW.slug, quantity: 2 })
    await expect.poll(() => cartCount(page)).toBe(2)

    // 2 alone is within the stock; 2 already in the cart + 2 is not (Review Focus 2).
    await tryToAdd(page, 2)
    await expect(purchaseAlert(page)).toHaveText(ONLY_LEFT)
    await expect.poll(() => cartCount(page)).toBe(2)

    await openCart(page)
    await expect(cartLines(page)).toHaveCount(1)
    await expect(lineQuantity(page, LOW.name)).toHaveValue('2')
    await expect(cartTotal(page)).toHaveText(formatPrice(2 * LOW.price))
  })

  test('US-08: còn 3, thêm 3 thì được', async ({ page }) => {
    await addToCart(page, { slug: LOW.slug, quantity: LOW.stock })
    await expect(purchaseAlert(page)).toHaveText('')
    await expect.poll(() => cartCount(page)).toBe(LOW.stock)

    await openCart(page)
    await expect(lineQuantity(page, LOW.name)).toHaveValue(String(LOW.stock))
    // The line is at the stock, not above it: no warning, and "+" stops here (decision 10A).
    await expect(cartLine(page, LOW.name).getByText(ONLY_LEFT)).toHaveCount(0)
    await expect(
      cartLine(page, LOW.name).getByRole('button', { name: `Tăng số lượng ${LOW.name}`, exact: true }),
    ).toBeDisabled()
  })

  test('US-08: trên trang giỏ, tăng quá tồn kho thì bị từ chối', async ({ page }) => {
    await addToCart(page, { slug: LOW.slug, quantity: 2 })
    await openCart(page)
    // Typed, since "+" stops at the stock: the number still reaches the server, which refuses it.
    await setQuantity(page, LOW.name, LOW.stock + 1)
    await expect(lineAlert(page, LOW.name)).toHaveText(ONLY_LEFT)
    await expect(lineQuantity(page, LOW.name)).toHaveValue('2')
    await expect(cartTotal(page)).toHaveText(formatPrice(2 * LOW.price))
    await expect.poll(() => cartCount(page)).toBe(2)

    await openCart(page)
    await expect(lineQuantity(page, LOW.name)).toHaveValue('2')
  })
})

// Read-only (no add), so it also runs on Production.
for (const product of SOLD_OUT) {
  test(`US-08: sản phẩm hết hàng có nút "Thêm vào giỏ" bị vô hiệu (${product.slug})`, async ({ page }) => {
    await page.goto(`/products/${product.slug}`)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(product.name)
    // The real attribute, not only aria-disabled: a click does nothing.
    await expect(addToCartButton(page)).toBeDisabled()
    await expect(addToCartButton(page)).toHaveAttribute('disabled', '')
    await expect(purchaseSection(page).getByRole('spinbutton')).toHaveCount(0)
  })
}
