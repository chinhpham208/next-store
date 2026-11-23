import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it } from 'vitest'
import { Breadcrumb } from '@/components/layout/breadcrumb'
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
it('SiteHeader lists "Sản phẩm" then "Blog" in the main nav, each a 44 px target', () => {
  const html = renderToStaticMarkup(createElement(SiteHeader))
  const nav = /<nav aria-label="Chính"[^>]*>(.*?)<\/nav>/.exec(html)?.[1] ?? ''
  expect([...nav.matchAll(/<a [^>]*href="([^"]+)"[^>]*>([^<]+)<\/a>/g)].map((match) => [match[1], match[2]])).toEqual([
    ['/products', 'Sản phẩm'],
    ['/blog', 'Blog'],
  ])
  expect(nav.match(/min-h-11/g)).toHaveLength(2)
})
it('SiteHeader renders the cart slot after the Blog link', () => {
  const cart = createElement('a', { href: '/cart', 'aria-label': 'Giỏ hàng' }, 'giỏ')
  const html = renderToStaticMarkup(createElement(SiteHeader, { cart }))
  const nav = /<nav aria-label="Chính"[^>]*>(.*?)<\/nav>/.exec(html)?.[1] ?? ''
  expect([...nav.matchAll(/<a [^>]*href="([^"]+)"/g)].map((match) => match[1])).toEqual(['/products', '/blog', '/cart'])
})
it('SiteHeader imports no feature', () => {
  expect(readFileSync('src/components/layout/site-header.tsx', 'utf8')).not.toContain('@/features/')
})
it('Breadcrumb renders a labelled nav with an ordered list of links separated by a hidden "/"', () => {
  const html = renderToStaticMarkup(
    createElement(Breadcrumb, {
      crumbs: [
        { href: '/', label: 'Trang chủ' },
        { href: '/blog', label: 'Blog' },
      ],
    }),
  )
  expect(html).toMatch(/^<nav aria-label="Đường dẫn"><ol[^>]*>/)
  expect(html.match(/<li/g)).toHaveLength(2)
  expect(html).toMatch(/<a [^>]*href="\/"[^>]*>Trang chủ<\/a>[\s\S]*<span aria-hidden="true"[^>]*>\/<\/span>[\s\S]*<a [^>]*href="\/blog"[^>]*>Blog<\/a>/)
  expect(html.match(/aria-hidden="true"/g)).toHaveLength(1)
  expect(html.match(/min-h-11/g)).toHaveLength(2)
})
it('SiteFooter renders the test-mode notice and the Gin Pham lockup', () => {
  const html = renderToStaticMarkup(createElement(SiteFooter))
  expect(html).toMatch(/^<footer/)
  expect(html).toContain('Thanh toán đang chạy ở chế độ thử nghiệm, chưa thu tiền thật.')
  expect(html).toContain('alt="Gin Pham"')
})
