import { createElement, type FunctionComponent } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Badge } from '@/components/ui/badge'
import { Button, buttonVariants } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Container } from '@/components/ui/container'
import { CursorBlock } from '@/components/ui/cursor-block'
import { Input } from '@/components/ui/input'
import { Price } from '@/components/ui/price'
import { Skeleton } from '@/components/ui/skeleton'

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

describe('Button', () => {
  it('Button defaults to type=button and renders its label', () => {
    const html = render(Button, { children: 'Thử lại' })
    expect(html).toMatch(/^<button[^>]*type="button"[^>]*>Thử lại<\/button>$/)
  })
  it('Button keeps an explicit type=submit', () => {
    expect(render(Button, { type: 'submit', children: 'Tìm' })).toContain('type="submit"')
  })
  it('Button uses the primary variant by default and keeps a 44 px target', () => {
    const classes = classOf(render(Button, { children: 'Thử lại' }))
    expect(classes).toEqual(expect.arrayContaining(['min-h-11', 'bg-foreground', 'text-background']))
  })
  it('Button applies the secondary variant and merges className', () => {
    const classes = classOf(render(Button, { variant: 'secondary', className: 'w-full', children: 'Về trang chủ' }))
    expect(classes).toEqual(expect.arrayContaining(['border-border-strong', 'text-foreground', 'w-full']))
    expect(classes).not.toContain('bg-foreground')
  })
  it('Button forwards disabled and event props', () => {
    expect(render(Button, { disabled: true, children: 'Thêm vào giỏ' })).toContain('disabled=""')
  })
  it('buttonVariants returns different classes per variant and merges className', () => {
    expect(buttonVariants({ variant: 'primary' })).not.toBe(buttonVariants({ variant: 'secondary' }))
    expect(buttonVariants({ className: 'w-full' })).toContain('w-full')
    expect(buttonVariants()).toBe(buttonVariants({ variant: 'primary' }))
  })
  it('buttonVariants lets className override a conflicting utility', () => {
    const classes = buttonVariants({ variant: 'secondary', className: 'px-4' }).split(' ')
    expect(classes).toContain('px-4')
    expect(classes).not.toContain('px-6')
  })
})

describe('Input', () => {
  it('Input forwards name, type and aria-label', () => {
    const html = render(Input, { name: 'q', type: 'search', 'aria-label': 'Tìm sản phẩm' })
    expect(html).toContain('name="q"')
    expect(html).toContain('type="search"')
    expect(html).toContain('aria-label="Tìm sản phẩm"')
  })
  it('Input uses 16 px text and a 44 px target', () => {
    expect(classOf(render(Input, {}))).toEqual(expect.arrayContaining(['min-h-11', 'text-base', 'border-border-strong']))
  })
})

describe('Skeleton', () => {
  it('Skeleton is hidden from assistive technology', () => {
    expect(render(Skeleton, { className: 'h-6' })).toContain('aria-hidden="true"')
  })
  it('Skeleton uses the border colour, no animation, and merges its size', () => {
    const classes = classOf(render(Skeleton, { className: 'h-6 w-36' }))
    expect(classes).toEqual(expect.arrayContaining(['bg-border', 'h-6', 'w-36']))
    expect(classes.some((c) => c.startsWith('animate-'))).toBe(false)
  })
})
