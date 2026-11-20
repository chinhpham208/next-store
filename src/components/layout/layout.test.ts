import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it } from 'vitest'
import { SiteFooter } from '@/components/layout/site-footer'
import { SiteHeader } from '@/components/layout/site-header'

it('SiteHeader renders the banner with the home link', () => {
  const html = renderToStaticMarkup(createElement(SiteHeader))
  expect(html).toMatch(/^<header/)
  expect(html).toContain('href="/"')
  expect(html).toContain('next-store')
})
it('SiteHeader has the main nav with a "Sản phẩm" link to /products', () => {
  const html = renderToStaticMarkup(createElement(SiteHeader))
  expect(html).toMatch(/<nav aria-label="Chính"[^>]*>.*<a [^>]*href="\/products"[^>]*>Sản phẩm<\/a>.*<\/nav>/)
  expect(html).toContain('min-h-11')
})
it('SiteFooter renders the test-mode notice and the Gin Pham lockup', () => {
  const html = renderToStaticMarkup(createElement(SiteFooter))
  expect(html).toMatch(/^<footer/)
  expect(html).toContain('Thanh toán đang chạy ở chế độ thử nghiệm, chưa thu tiền thật.')
  expect(html).toContain('alt="Gin Pham"')
})
