import type { Locator, Page, Request, Response, Route } from '@playwright/test'
import { PRODUCT_SEEDS } from '@/db/seed-data'
import { expect } from './test'

// Helpers over the cart's markup contract (plan M4 Task 8, 9), shared by the US-06 … US-08 specs. The cart lives in
// the database behind an httpOnly cookie, so a test's cart is the cart of its own browser context: every test gets a
// fresh context from Playwright, hence a fresh, empty cart. Nothing here clears a cart afterwards: a cart nobody's
// cookie points at is never read again and expires after CART_TTL_DAYS (ADR-0014 6A, 7A). Adding never changes
// `products.stock` (M4 has no reservation), so a run leaves the seed as it found it.

export const seedProduct = (slug: string) => {
  const product = PRODUCT_SEEDS.find((seed) => seed.slug === slug)
  if (!product) throw new Error(`Seed không có sản phẩm ${slug}`)
  // `stock` is optional in the insert type (the column has a default); every seed product sets it.
  const { stock } = product
  if (stock === undefined) throw new Error(`Seed của ${slug} không ghi tồn kho`)
  return { ...product, stock }
}

// A seed product with at least `quantity` in stock, so a test that adds that many is never refused for stock.
export const productWithStock = (slug: string, quantity: number) => {
  const product = seedProduct(slug)
  if (product.stock < quantity) throw new Error(`${slug} chỉ còn ${product.stock} trong seed, test cần ${quantity}`)
  return product
}

export const cartLink = (page: Page): Locator =>
  page.getByRole('navigation', { name: 'Chính' }).getByRole('link', { name: /^Giỏ hàng/ })

const COUNT_LABEL = /^Giỏ hàng, (\d+) sản phẩm$/

// The number in the cart link's accessible name ("Giỏ hàng, 3 sản phẩm"), or null when it has none ("Giỏ hàng":
// no cart, an empty one, still streaming, or the count failed). The visible badge is aria-hidden and caps at 99+.
export const cartCount = async (page: Page): Promise<number | null> => {
  const label = await cartLink(page).getAttribute('aria-label')
  const match = label?.match(COUNT_LABEL)
  return match ? Number(match[1]) : null
}

// The badge beside the icon is hollow (`data-pending`) while an add has not been answered yet.
export const cartBadgePending = (page: Page): Locator => cartLink(page).locator('[data-pending]')

export const purchaseSection = (page: Page): Locator => page.getByRole('region', { name: 'Mua hàng' })

export const addToCartButton = (page: Page): Locator =>
  purchaseSection(page).getByRole('button', { name: 'Thêm vào giỏ', exact: true })

export const quantityField = (page: Page): Locator =>
  purchaseSection(page).getByRole('spinbutton', { name: 'Số lượng', exact: true })

export const addedStatus = (page: Page): Locator =>
  purchaseSection(page).getByRole('status').getByText('Đã thêm vào giỏ hàng', { exact: true })

export const purchaseAlert = (page: Page): Locator => purchaseSection(page).getByRole('alert')

// A click before hydration would submit the form natively (a GET with ?quantity=…) instead of calling the action.
// React sets its `__reactProps$…` key on an element when it hydrates it.
export const waitForHydration = async (locator: Locator): Promise<void> => {
  await expect
    .poll(() => locator.evaluate((element) => Object.keys(element).some((key) => key.startsWith('__reactProps$'))), {
      message: 'React chưa hydrate phần tử',
    })
    .toBe(true)
}

export const openProduct = async (page: Page, slug: string): Promise<void> => {
  await page.goto(`/products/${slug}`)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(seedProduct(slug).name)
  await waitForHydration(addToCartButton(page))
}

// Opens the product page and adds `quantity` through the real form, then waits for the success message: by then the
// action has answered and the route's new render (with the server's count) has committed (plan M4 D2).
export const addToCart = async (page: Page, { slug, quantity = 1 }: { slug: string; quantity?: number }) => {
  await openProduct(page, slug)
  await quantityField(page).fill(String(quantity))
  await addToCartButton(page).click()
  await expect(addedStatus(page)).toBeVisible({ timeout: 15_000 })
}

export type HeldAction = {
  // The held request, once the page has sent it; until then nothing has reached the server.
  request: Promise<Request>
  // Lets the request go on to the server (through the bypass route of e2e/test.ts on a preview).
  release: () => Promise<void>
  // Answers in the server's place with this status and an empty body; the server never sees the request.
  fail: (status: number) => Promise<void>
  // Fails the request as a network error would; the server never sees it.
  abort: () => Promise<void>
}

const isActionPost = async (request: Request): Promise<boolean> =>
  request.method() === 'POST' && (await request.headerValue('next-action')) !== null

// The response to the next Server Action POST the page sends (or has sent and not yet been answered).
export const waitForActionResponse = (page: Page): Promise<Response> =>
  page.waitForResponse(async (response) => isActionPost(response.request()), { timeout: 15_000 })

/**
 * Holds the next Server Action POST (a POST with a `next-action` header) to the origin of `baseURL`, and only that
 * one; every other request goes on untouched. The route is the page's, so it runs before the context routes of
 * e2e/test.ts, and hands the request back with route.fallback() (never route.continue(), conventions §7). Only for
 * tests tagged WRITE_TAG: on Production the write guard aborts the request anyway.
 */
export const holdNextAction = async (page: Page, baseURL: string | undefined): Promise<HeldAction> => {
  if (!baseURL) throw new Error('holdNextAction cần baseURL')
  const origin = new URL(baseURL).origin
  let taken = false
  let arrived: (route: Route) => void = () => undefined
  const held = new Promise<Route>((resolve) => {
    arrived = resolve
  })
  let decide: (answer: (route: Route) => Promise<void>) => void = () => undefined
  const decided = new Promise<(route: Route) => Promise<void>>((resolve) => {
    decide = resolve
  })
  let answered: () => void = () => undefined
  const done = new Promise<void>((resolve) => {
    answered = resolve
  })
  const matcher = (url: URL) => url.origin === origin
  // The handler answers the held route itself and returns only then.
  const handler = async (route: Route) => {
    if (taken || !(await isActionPost(route.request()))) return route.fallback()
    taken = true
    arrived(route)
    const answer = await decided
    try {
      await answer(route)
    } finally {
      answered()
    }
  }
  await page.route(matcher, handler)

  // The route stays registered (it hands every later request straight on): unrouting it while the released request
  // is still in the bypass route's route.fetch makes Playwright also send that request natively, without the bypass
  // header, so a preview got a second POST and answered it with Deployment Protection's 302.
  const settle = async (answer: (route: Route) => Promise<void>) => {
    await held
    decide(answer)
    await done
  }
  return {
    request: held.then((route) => route.request()),
    release: () => settle((route) => route.fallback()),
    fail: (status) => settle((route) => route.fulfill({ status, contentType: 'text/plain', body: '' })),
    abort: () => settle((route) => route.abort('failed')),
  }
}

// /cart (plan M4 Task 9, markup contract). Lines are looked up by the product's link, which holds its name.
export const cartList = (page: Page): Locator => page.getByRole('list', { name: 'Sản phẩm trong giỏ' })

export const cartLines = (page: Page): Locator => cartList(page).getByRole('listitem')

export const cartLine = (page: Page, name: string): Locator =>
  cartLines(page).filter({ has: page.getByRole('link', { name, exact: true }) })

export const lineQuantity = (page: Page, name: string): Locator =>
  cartLine(page, name).getByRole('spinbutton', { name: `Số lượng ${name}`, exact: true })

export const lineAlert = (page: Page, name: string): Locator => cartLine(page, name).getByRole('alert')

export const cartTotal = (page: Page): Locator => page.getByTestId('cart-total')

export const emptyCart = (page: Page): Locator => page.getByRole('main').getByText('Giỏ hàng trống.', { exact: true })

export const openCart = async (page: Page): Promise<void> => {
  await page.goto('/cart')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Giỏ hàng')
  // The cart streams in behind the skeleton; either state ends the wait.
  await expect(cartList(page).or(emptyCart(page))).toBeVisible()
}

// Waits until the action has answered and no line is busy any more: by then the route's new render (line totals,
// cart total, header number) has committed (plan M4 D2), or the refusal's message is on the line.
const runLineAction = async (page: Page, act: () => Promise<void>): Promise<void> => {
  const answered = waitForActionResponse(page)
  await act()
  await answered
  await expect(page.getByRole('main').locator('[aria-busy="true"]')).toHaveCount(0, { timeout: 15_000 })
}

// Types the number into the line's field and sends it with Enter, as a keyboard user does.
export const setQuantity = async (page: Page, name: string, quantity: number): Promise<void> => {
  const field = lineQuantity(page, name)
  await waitForHydration(field)
  await runLineAction(page, async () => {
    await field.fill(String(quantity))
    await field.press('Enter')
  })
}

export const removeLine = async (page: Page, name: string): Promise<void> => {
  const button = cartLine(page, name).getByRole('button', { name: `Xoá ${name}`, exact: true })
  await waitForHydration(button)
  await runLineAction(page, () => button.click())
}
