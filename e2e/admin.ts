import { randomBytes } from 'node:crypto'
import type { BrowserContext, Page } from '@playwright/test'
import { PRODUCT_SEEDS } from '@/db/seed-data'
import { adminCookieNameFor } from '@/features/admin/cookie-name'
import { waitForHydration } from './cart'
import { isProductionUrl } from './production'
import { expect, test } from './test'

// Helpers of the admin specs (plan M5 Task 14, 15): e2e/us-12-admin-login.spec.ts, e2e/us-13-admin-edit.spec.ts.
//
// The password. It comes from E2E_ADMIN_PASSWORD: scripts/verify.sh makes a random one for the local server, the
// Preview workflow passes the GitHub secret (the Preview password; Production's never reaches GitHub, ADR-0018 16A,
// and a login is a POST, so no login runs on Production anyway). It is typed by setting the field's value, never with
// fill(): a fill step writes the value into the report and the trace. scripts/redact-report.mjs masks it as well.
//
// The login limit (ADR-0018 8A): 5 wrong passwords in 15 minutes lock the address. A run of these specs types at most
// two wrong passwords (one test, one retry), so it never locks the runner out of a deployment; only the lock test
// types more, with an address of its own, and only on the local server.

export const ADMIN_COOKIE_NAMES = ['__Host-ns_admin', 'ns_admin'] as const

const MISSING_PASSWORD = 'Không có E2E_ADMIN_PASSWORD: không đăng nhập được (ADR-0018 16A)'

const DEPLOYED = Boolean(process.env.BASE_URL)

/** The admin password of this run; the test is skipped, with the reason, when there is none. */
export const adminPassword = (): string => {
  const password = process.env.E2E_ADMIN_PASSWORD
  test.skip(!password, MISSING_PASSWORD)
  return password ?? ''
}

/**
 * The product the US-13 specs edit, and no other spec uses: ao-dark-mode is in none of the other specs, the smoke
 * script or the cart tests (they read ao-git-push-force, ao-404-not-found, ao-hello-world, …), so a run of the admin
 * specs on a shared Dev never changes what another spec reads, and their edits are put back to the seed afterwards.
 */
export const SUBJECT_SLUG = 'ao-dark-mode'

/** A product of the same category that no spec edits: its page must keep being served from the cache (Review Focus 2). */
export const OTHER_SLUG = 'ao-hello-world'

export const seedOf = (slug: string) => {
  const seed = PRODUCT_SEEDS.find((product) => product.slug === slug)
  const { name, description, price, stock } = seed ?? {}
  if (name === undefined || description === undefined || price === undefined || stock === undefined)
    throw new Error(`Seed không có sản phẩm ${slug} với đủ tên, mô tả, giá, tồn kho`)
  return { slug, name, description, price, stock }
}

// A deployment shows the Vercel toolbar on its pages; under the admin's nonce CSP its inline styles are refused
// (ADR-0020), which is noise here. Vercel's header for automated tests turns only the toolbar off (as ns-csp.spec.ts).
const withoutToolbar = async (page: Page): Promise<void> => {
  if (DEPLOYED && !isProductionUrl(process.env.BASE_URL)) await page.setExtraHTTPHeaders({ 'x-vercel-skip-toolbar': '1' })
}

/** /admin/login, with the form hydrated (a click before that would not reach the Server Action). */
export const openLogin = async (page: Page): Promise<void> => {
  await withoutToolbar(page)
  await page.goto('/admin/login')
  await expect(page.getByRole('heading', { level: 1, name: 'Đăng nhập quản trị' })).toBeVisible()
  await waitForHydration(page.getByRole('button', { name: 'Đăng nhập', exact: true }))
}

/** Types into the password field and presses "Đăng nhập". Sets the value rather than fill(), see above. */
export const submitPassword = async (page: Page, value: string): Promise<void> => {
  await page.locator('#admin-password').evaluate((input, typed) => {
    if (input instanceof HTMLInputElement) input.value = typed
  }, value)
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click()
}

/** Logs in with the run's password and waits for /admin/products. */
export const loginAsAdmin = async (page: Page): Promise<void> => {
  const password = adminPassword()
  await openLogin(page)
  await submitPassword(page, password)
  await expect(page, 'đăng nhập bằng E2E_ADMIN_PASSWORD (khớp ADMIN_PASSWORD của môi trường?)').toHaveURL(
    /\/admin\/products$/,
    { timeout: 20_000 },
  )
  await expect(page.getByRole('heading', { level: 1, name: 'Sản phẩm', exact: true })).toBeVisible()
}

/** The session cookie of a context, under either name (`__Host-` only on https). */
export const adminCookie = async (context: BrowserContext) =>
  (await context.cookies()).find(({ name }) => ADMIN_COOKIE_NAMES.some((admin) => admin === name))

const cookieNameFor = (baseURL: string): string => adminCookieNameFor(new URL(baseURL))

/** Puts a cookie of the admin session in the context, under the name the site uses; `__Host-` needs Secure and Path=/. */
export const setAdminCookie = async (context: BrowserContext, baseURL: string | undefined, value: string): Promise<void> => {
  if (!baseURL) throw new Error('setAdminCookie cần baseURL')
  await context.addCookies([
    {
      name: cookieNameFor(baseURL),
      value,
      url: baseURL,
      httpOnly: true,
      sameSite: 'Strict',
      secure: new URL(baseURL).protocol === 'https:',
    },
  ])
}

export const adminCookieHeader = (baseURL: string | undefined, value: string): string => {
  if (!baseURL) throw new Error('adminCookieHeader cần baseURL')
  return `${cookieNameFor(baseURL)}=${value}`
}

// A signature with one character changed, kept canonical (the last character of a 43-character base64url value
// carries only 4 bits, so the change is in the last but one).
export const tamper = (value: string): string => `${value.slice(0, -2)}${value.slice(-2) === 'AA' ? 'EA' : 'AA'}`

const SESSION_TTL_SECONDS = 8 * 60 * 60
const SIGNATURE_BYTES = 32

/** `v1.<expiry within the TTL>.<43 random characters>`: well formed, signed by nobody. */
export const forgedToken = (): string => {
  const expiry = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS - 60
  return `v1.${expiry}.${randomBytes(SIGNATURE_BYTES).toString('base64url')}`
}
