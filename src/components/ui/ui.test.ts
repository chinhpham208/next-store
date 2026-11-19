import { createElement, type FunctionComponent } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { Container } from '@/components/ui/container'
import { CursorBlock } from '@/components/ui/cursor-block'
import { Price } from '@/components/ui/price'

const NBSP = ' '
// Required `children` must sit in props for TypeScript, which react/no-children-prop rejects on a literal
// createElement call; one typed helper satisfies both.
const render = <P extends object>(component: FunctionComponent<P>, props: P): string =>
  renderToStaticMarkup(createElement(component, props))
const classOf = (html: string): string[] => (/class="([^"]*)"/.exec(html)?.[1] ?? '').split(' ')

describe('Price', () => {
  it('renders only the formatted VND amount', () => {
    expect(render(Price, { amount: 199000 })).toMatch(
      new RegExp(`^<[a-z]+[^>]*>199\\.000${NBSP}₫</[a-z]+>$`),
    )
  })
  it('uses the mono font so digits line up', () => {
    expect(classOf(render(Price, { amount: 199000 }))).toContain('font-mono')
  })
  it('lets the caller replace the text colour', () => {
    const classes = classOf(render(Price, { amount: 1, className: 'text-muted-foreground' }))
    expect(classes).toContain('text-muted-foreground')
    expect(classes).not.toContain('text-foreground')
  })
})

describe('Badge', () => {
  it('renders the sold-out label inverted Ink/Paper', () => {
    const html = render(Badge, { variant: 'sold-out', children: 'Hết hàng' })
    expect(html).toContain('>Hết hàng<')
    expect(classOf(html)).toEqual(expect.arrayContaining(['bg-foreground', 'text-background', 'uppercase', 'tracking-label']))
  })
  it('defaults to the neutral variant', () => {
    const classes = classOf(render(Badge, { children: 'Mới' }))
    expect(classes).toEqual(expect.arrayContaining(['bg-surface-muted', 'text-foreground']))
    expect(classes).not.toContain('bg-foreground')
  })
})

describe('Container', () => {
  it('merges a custom className', () => {
    const classes = classOf(render(Container, { className: 'py-8', children: 'x' }))
    expect(classes).toEqual(expect.arrayContaining(['max-w-container-page', 'py-8']))
  })
})

describe('Card', () => {
  it('renders children in a borderless column', () => {
    const html = render(Card, { children: 'x' })
    expect(html).toContain('>x<')
    expect(classOf(html)).toEqual(expect.arrayContaining(['flex', 'flex-col']))
  })
})

describe('CursorBlock', () => {
  it('is decorative and static by default', () => {
    const html = render(CursorBlock, {})
    expect(html).toContain('aria-hidden="true"')
    expect(classOf(html)).toEqual(['cursor-block'])
  })
  it('adds the blink modifier when asked', () => {
    expect(classOf(render(CursorBlock, { blink: true }))).toContain('cursor-block--blink')
  })
})
