import type { Locator, Page } from '@playwright/test'

// Helpers over the listing's markup contract (M2 Task 13): the grid is the list named "Danh sách sản phẩm", each
// card has its name in an h3 and its price as the only text ending in "₫". Shared by the US-02 … US-05 specs.

export const productList = (page: Page): Locator => page.getByRole('list', { name: 'Danh sách sản phẩm' })

export const productItems = (page: Page): Locator => productList(page).getByRole('listitem')

export const productNames = async (page: Page): Promise<string[]> =>
  (await productList(page).getByRole('heading', { level: 3 }).allInnerTexts()).map((name) => name.trim())

export const productPrices = async (page: Page): Promise<number[]> =>
  (await productList(page).getByText(/₫$/).allInnerTexts()).map((text) => Number(text.replace(/\D/g, '')))

export const resultCount = (page: Page): Locator => page.getByRole('status')

export const categoryNav = (page: Page): Locator => page.getByRole('navigation', { name: 'Danh mục' })

export const sortNav = (page: Page): Locator => page.getByRole('navigation', { name: 'Sắp xếp' })

export const paginationNav = (page: Page): Locator => page.getByRole('navigation', { name: 'Phân trang' })

export const searchBox = (page: Page): Locator => page.getByRole('searchbox', { name: 'Tìm sản phẩm' })
