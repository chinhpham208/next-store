import { createElement, type FunctionComponent } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it } from 'vitest'
import { StatusMessage } from '@/components/layout/status-message'

// Same helper as ui.test.ts: required `children` must sit in props for TypeScript, which react/no-children-prop
// rejects on a literal createElement call.
const render = <P extends object>(component: FunctionComponent<P>, props: P): string =>
  renderToStaticMarkup(createElement(component, props))

const renderNotFound = () =>
  render(StatusMessage, {
    title: 'Không tìm thấy trang',
    description: 'Trang này không tồn tại hoặc đã bị gỡ.',
    children: createElement('a', { href: '/products' }, 'Xem tất cả sản phẩm'),
  })

it('renders the title as the only h1, the description and its actions', () => {
  const html = renderNotFound()
  expect(html.match(/<h1/g)).toHaveLength(1)
  expect(html).toMatch(/<h1[^>]*>Không tìm thấy trang<\/h1>/)
  expect(html).toContain('Trang này không tồn tại hoặc đã bị gỡ.')
  expect(html).toContain('href="/products"')
})
it('puts the actions after the description and hides the cursor block from assistive technology', () => {
  const html = renderNotFound()
  expect(html.indexOf('Trang này không tồn tại')).toBeLessThan(html.indexOf('href="/products"'))
  expect(html).toMatch(/<span aria-hidden="true" class="cursor-block[^"]*size-8/)
})
