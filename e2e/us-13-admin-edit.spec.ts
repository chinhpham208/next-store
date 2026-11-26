import type { Page } from '@playwright/test'
import { OTHER_SLUG, SUBJECT_SLUG, loginAsAdmin, seedOf } from './admin'
import { expectNoSeriousA11yViolations } from './axe'
import { addToCartButton, waitForActionResponse, waitForHydration } from './cart'
import { productNames } from './catalog'
import { WRITE_TAG } from './production'
import { expect, test, type NewContext } from './test'
import { formatPrice } from '@/lib/format-price'

// US-13 (plan M5 Task 15): the admin edits a product. Runs in the `admin-write` project, one worker, after every other
// project. Every test logs in, and a login is a POST: all are tagged WRITE_TAG and none runs on Production (ADR-0018
// 16A; Production is checked by hand once, plan "Việc của chủ dự án" 6).
//
// All of them edit ONE product, SUBJECT (e2e/admin.ts says why no other spec reads it). A test that saves marks it
// dirty and the afterEach puts the seed back through the same form, so the next test starts from the seed; beforeAll
// and afterAll do the same for what a run that died left behind.
test.describe.configure({ mode: 'default' })

const SUBJECT = seedOf(SUBJECT_SLUG)
const PRICE_STEP = 1000

const field = (page: Page, name: 'name' | 'price' | 'stock' | 'description') => page.locator(`#product-${name}`)
const saveButton = (page: Page) => page.getByRole('button', { name: 'Lưu', exact: true })
const savedStatus = (page: Page) => page.getByRole('main').getByRole('status').filter({ hasText: 'Đã lưu.' })
const formAlert = (page: Page) => page.getByRole('main').getByRole('alert')

// The price as the shop prints it: digits with dots and a no-break space before the sign (Intl, vi-VN).
const priceText = (vnd: number) => new RegExp(`^${formatPrice(vnd).replace(/\./g, '\\.').replace(/\s/g, '\\s')}$`)

const openEdit = async (page: Page, slug = SUBJECT.slug): Promise<void> => {
  await page.goto(`/admin/products/${slug}`)
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await waitForHydration(saveButton(page))
}

let dirty = false

// Presses "Lưu" and waits for the action's answer; whatever it says, the product may have changed.
const save = async (page: Page): Promise<void> => {
  dirty = true
  const answered = waitForActionResponse(page)
  await saveButton(page).click()
  await answered
}

type Values = { name: string; price: number; stock: number; description: string }

const fillForm = async (page: Page, values: Partial<Values>): Promise<void> => {
  if (values.name !== undefined) await field(page, 'name').fill(values.name)
  if (values.price !== undefined) await field(page, 'price').fill(String(values.price))
  if (values.stock !== undefined) await field(page, 'stock').fill(String(values.stock))
  if (values.description !== undefined) await field(page, 'description').fill(values.description)
}

// Back to the seed, through the form, only when something differs.
const restoreSeed = async (page: Page): Promise<void> => {
  await loginAsAdmin(page)
  await openEdit(page)
  const same =
    (await field(page, 'name').inputValue()) === SUBJECT.name &&
    (await field(page, 'price').inputValue()) === String(SUBJECT.price) &&
    (await field(page, 'stock').inputValue()) === String(SUBJECT.stock) &&
    (await field(page, 'description').inputValue()) === SUBJECT.description
  if (!same) {
    await fillForm(page, SUBJECT)
    await save(page)
    await expect(savedStatus(page)).toBeVisible()
  }
  dirty = false
}

const restoreInNewContext = async (newContext: NewContext) => {
  const context = await newContext()
  await restoreSeed(await context.newPage())
}

test.describe('US-13: sửa sản phẩm', { tag: WRITE_TAG }, () => {
  test.beforeAll(async ({ newContext }) => {
    await restoreInNewContext(newContext)
  })

  test.afterEach(async ({ newContext }) => {
    if (dirty) await restoreInNewContext(newContext)
  })

  test.afterAll(async ({ newContext }) => {
    await restoreInNewContext(newContext)
  })

  test('US-13: đổi giá và lưu thì trang sản phẩm hiện giá mới ở lần tải kế tiếp', async ({ page }) => {
    const newPrice = SUBJECT.price + PRICE_STEP
    await loginAsAdmin(page)
    await openEdit(page)
    await fillForm(page, { price: newPrice })
    await save(page)
    await expect(savedStatus(page)).toBeVisible()

    await page.goto(`/products/${SUBJECT.slug}`)
    await expect(page.getByRole('main').getByText(priceText(newPrice))).toBeVisible()
    await expect(page.getByRole('main').getByText(priceText(SUBJECT.price))).toHaveCount(0)
  })

  // How "not rendered again" is seen (plan M5 Task 15 Step 1, found on a local build of next 16.4.6): `next start` gives
  // a Cache Components page no `x-nextjs-cache`, and keeps its entries in memory, so locally nothing shows whether a
  // page was rendered again; the tags are proven by Vitest (`tagsForProductWrite`, `getCatalogSlugs is tagged
  // product-slugs`) and by the build's .meta files (ADR-0019). On Vercel the CDN says it: a page served from its cache
  // is `x-vercel-cache: HIT` (or PRERENDER, the build's own copy), with an `age` that only grows.
  test('US-13: các trang sản phẩm khác không bị render lại', async ({ page, request, baseURL }) => {
    test.skip(!baseURL?.startsWith('https://'), 'Chỉ CDN của Vercel cho thấy trang có render lại: x-vercel-cache và age')
    const read = async () => {
      const headers = (await request.get(`/products/${OTHER_SLUG}`)).headers()
      return { cache: headers['x-vercel-cache'], age: Number(headers.age ?? Number.NaN) }
    }
    await read() // the first one may fill this region's cache
    const before = await read()
    test.skip(before.cache === undefined, 'Deployment không trả x-vercel-cache: không quan sát được')
    expect(before.cache, 'trang khác phải đã nằm trong cache trước khi lưu').toMatch(/^(HIT|PRERENDER)$/)

    await loginAsAdmin(page)
    await openEdit(page)
    await fillForm(page, { price: SUBJECT.price + PRICE_STEP })
    await save(page)
    await expect(savedStatus(page)).toBeVisible()

    const after = await read()
    console.log(`US-13 cache của ${OTHER_SLUG}: trước ${JSON.stringify(before)}, sau lưu ${JSON.stringify(after)}`)
    expect(after.cache, 'trang khác vẫn phục vụ từ cache sau khi lưu').toMatch(/^(HIT|PRERENDER)$/)
    if (!Number.isNaN(before.age) && !Number.isNaN(after.age)) expect(after.age, 'age không về 0').toBeGreaterThanOrEqual(before.age)
  })

  test('US-13: giá âm thì bị từ chối với lỗi cạnh ô nhập', async ({ page }) => {
    await loginAsAdmin(page)
    await openEdit(page)
    await fillForm(page, { price: -1 })
    await save(page)

    const price = field(page, 'price')
    await expect(price).toHaveAttribute('aria-invalid', 'true')
    const described = ((await price.getAttribute('aria-describedby')) ?? '').split(/\s+/)
    expect(described).toContain('product-price-error')
    await expect(page.locator('#product-price-error')).toHaveText('Giá không được âm')
    await expect(savedStatus(page)).toHaveCount(0)

    await page.goto(`/products/${SUBJECT.slug}`)
    await expect(page.getByRole('main').getByText(priceText(SUBJECT.price))).toBeVisible()
  })

  test('US-13: tên trống thì bị từ chối với lỗi cạnh ô nhập', async ({ page }) => {
    await loginAsAdmin(page)
    await openEdit(page)
    await fillForm(page, { name: '   ' })
    await save(page)

    const name = field(page, 'name')
    await expect(name).toHaveAttribute('aria-invalid', 'true')
    const described = ((await name.getAttribute('aria-describedby')) ?? '').split(/\s+/)
    expect(described).toContain('product-name-error')
    await expect(page.locator('#product-name-error')).toHaveText('Tên không được để trống')
    await expect(savedStatus(page)).toHaveCount(0)

    await page.goto(`/products/${SUBJECT.slug}`)
    await expect(page.getByRole('main').getByRole('heading', { level: 1 })).toHaveText(SUBJECT.name)
  })

  test('US-13: đổi tên thì danh sách sản phẩm hiện tên mới', async ({ page }) => {
    const newName = `${SUBJECT.name} bản E2E`
    await loginAsAdmin(page)
    await openEdit(page)
    await fillForm(page, { name: newName })
    await save(page)
    await expect(savedStatus(page)).toBeVisible()

    await page.goto('/products?category=ao-thun')
    await expect.poll(() => productNames(page)).toContain(newName)
    expect(await productNames(page)).not.toContain(SUBJECT.name)
  })

  test('US-13: đổi tồn kho về 0 thì nút "Thêm vào giỏ" bị vô hiệu', async ({ page }) => {
    await loginAsAdmin(page)
    await openEdit(page)
    await fillForm(page, { stock: 0 })
    await save(page)
    await expect(savedStatus(page)).toBeVisible()

    await page.goto(`/products/${SUBJECT.slug}`)
    await expect(addToCartButton(page)).toBeDisabled()
    await expect(page.getByRole('main').getByText('Hết hàng', { exact: true })).toBeVisible()
  })

  test('US-13: sửa ở hai tab thì tab sau nhận thông báo xung đột', async ({ page, context }) => {
    await loginAsAdmin(page)
    await openEdit(page)
    const second = await context.newPage()
    await openEdit(second)

    await fillForm(second, { price: SUBJECT.price + PRICE_STEP })
    await save(second)
    await expect(savedStatus(second)).toBeVisible()

    await fillForm(page, { description: `${SUBJECT.description} (tab cũ)` })
    await save(page)
    await expect(formAlert(page)).toContainText('Sản phẩm vừa được sửa ở nơi khác.')
    await expect(savedStatus(page)).toHaveCount(0)
  })

  for (const { name, size } of [
    { name: 'desktop', size: { width: 1280, height: 800 } },
    { name: 'mobile 390 px', size: { width: 390, height: 844 } },
  ]) {
    test(`US-13: trang danh sách và trang sửa không có lỗi a11y serious / critical (${name})`, async ({ page }) => {
      await page.setViewportSize(size)
      await loginAsAdmin(page)
      await expect(page.getByRole('link', { name: `Sửa ${SUBJECT.name}` })).toBeVisible()
      await expectNoSeriousA11yViolations(page)

      await openEdit(page)
      await expectNoSeriousA11yViolations(page)
    })
  }
})
