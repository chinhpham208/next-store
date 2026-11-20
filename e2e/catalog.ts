import type { Locator, Page } from '@playwright/test'

// Helpers over the listing's markup contract (M2 Task 13): the grid is the list named "Danh sách sản phẩm", each
// card has its name in an h3 and its price as the only text ending in "₫". Shared by the US-02 … US-05 specs.

export const productList = (page: Page): Locator => page.getByRole('list', { name: 'Danh sách sản phẩm' })

export const productItems = (page: Page): Locator => productList(page).getByRole('listitem')

export const productNames = async (page: Page): Promise<string[]> =>
  (await productList(page).getByRole('heading', { level: 3 }).allInnerTexts()).map((name) => name.trim())

export const productPrices = async (page: Page): Promise<number[]> =>
  (await productList(page).getByText(/₫$/).allInnerTexts()).map((text) => Number(text.replace(/\D/g, '')))

// The count is the status line of the results bar ("N sản phẩm"), looked up inside <main> and by its own text so
// another live region (the cart badge of M4, a toast) never matches.
export const resultCount = (page: Page): Locator =>
  page.getByRole('main').getByRole('status').filter({ hasText: /^\d+ sản phẩm$/ })

export const categoryNav = (page: Page): Locator => page.getByRole('navigation', { name: 'Danh mục' })

export const sortNav = (page: Page): Locator => page.getByRole('navigation', { name: 'Sắp xếp' })

export const paginationNav = (page: Page): Locator => page.getByRole('navigation', { name: 'Phân trang' })

export const searchBox = (page: Page): Locator => page.getByRole('searchbox', { name: 'Tìm sản phẩm' })

// Reason for `test.skip(({ isMobile }) => isMobile, VIEWPORT_INDEPENDENT)`: tests that only check data, URLs or
// status codes give the same answer at 390 px, so the mobile project skips them to keep the run short.
export const VIEWPORT_INDEPENDENT = 'Không phụ thuộc khổ màn hình: chỉ chạy ở desktop'
