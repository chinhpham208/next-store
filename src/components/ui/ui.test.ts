import { createElement, type FunctionComponent } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Badge } from '@/components/ui/badge'
import { CartIcon } from '@/components/ui/cart-icon'
import { Button, buttonVariants } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Container } from '@/components/ui/container'
import { CursorBlock } from '@/components/ui/cursor-block'
import { Input } from '@/components/ui/input'
import { Price } from '@/components/ui/price'
import { Prose, PROSE_COMPONENTS } from '@/components/ui/prose'
import { QuantityStepper, type QuantityStepperProps } from '@/components/ui/quantity-stepper'
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

describe('Prose', () => {
  it('Prose wraps children in a 576 px column spaced only by gap', () => {
    const html = render(Prose, { children: 'x' })
    expect(html).toMatch(/^<div[^>]*>x<\/div>$/)
    expect(classOf(html)).toEqual(
      expect.arrayContaining(['flex', 'max-w-xl', 'flex-col', 'gap-6', 'text-base', 'md:gap-8', 'md:text-lg']),
    )
  })
  it('maps every element the posts use', () => {
    expect(Object.keys(PROSE_COMPONENTS).sort()).toEqual(
      ['a', 'blockquote', 'code', 'em', 'h1', 'h2', 'h3', 'hr', 'li', 'ol', 'p', 'pre', 'strong', 'ul'].sort(),
    )
  })
  it('renders an internal link with next/link and no rel', () => {
    const html = render(PROSE_COMPONENTS.a, { href: '/products', children: 'Sản phẩm' })
    expect(html).toMatch(/^<a [^>]*href="\/products"[^>]*>Sản phẩm<\/a>$/)
    expect(html).not.toContain('rel=')
    expect(html).not.toContain('target=')
    expect(classOf(html)).toEqual(expect.arrayContaining(['text-link', 'underline', 'underline-offset-4']))
  })
  it('renders an external link with rel="noopener noreferrer" and no new tab', () => {
    const html = render(PROSE_COMPONENTS.a, { href: 'https://git-scm.com/docs/git-push', children: 'git push' })
    expect(html).toContain('href="https://git-scm.com/docs/git-push"')
    expect(html).toContain('rel="noopener noreferrer"')
    expect(html).not.toContain('target=')
  })
  it('treats a protocol-relative URL as external', () => {
    expect(render(PROSE_COMPONENTS.a, { href: '//example.com', children: 'x' })).toContain('rel="noopener noreferrer"')
  })
  it('makes a code block a keyboard-focusable horizontal scroll area', () => {
    const html = render(PROSE_COMPONENTS.pre, { children: 'git reflog' })
    expect(html).toMatch(/^<pre [^>]*tabindex="0"/)
    expect(html).not.toContain('aria-label')
    expect(classOf(html)).toEqual(expect.arrayContaining(['overflow-x-auto', 'rounded-md', 'border', 'bg-surface', 'font-mono']))
  })
  it('styles inline code but leaves code inside a block to the pre', () => {
    expect(classOf(render(PROSE_COMPONENTS.code, { children: '--force' }))).toEqual(
      expect.arrayContaining(['bg-surface-muted', 'font-mono', 'break-words']),
    )
    expect(render(PROSE_COMPONENTS.code, { className: 'language-bash', children: 'git reflog' })).toBe(
      '<code class="language-bash">git reflog</code>',
    )
  })
  it('renders an h1 from a post as h2, since the page already has its h1', () => {
    const html = render(PROSE_COMPONENTS.h1, { children: 'Tiêu đề' })
    expect(html).toMatch(/^<h2[^>]*>Tiêu đề<\/h2>$/)
    expect(html).toBe(render(PROSE_COMPONENTS.h2, { children: 'Tiêu đề' }))
  })
  it('renders each remaining element as its own tag with the spec classes', () => {
    const cases = [
      ['h3', 'text-xl'],
      ['p', 'text-pretty'],
      ['ul', 'list-disc'],
      ['ol', 'list-decimal'],
      ['blockquote', 'border-l-4'],
      ['strong', 'font-semibold'],
      ['em', 'italic'],
    ] as const
    for (const [tag, token] of cases) {
      const html = render(PROSE_COMPONENTS[tag], { children: 'x' })
      expect(html, tag).toMatch(new RegExp(`^<${tag}[ >][\\s\\S]*</${tag}>$`))
      expect(classOf(html), tag).toContain(token)
    }
    expect(render(PROSE_COMPONENTS.li, { children: 'x' })).toBe('<li>x</li>')
    expect(render(PROSE_COMPONENTS.hr, {})).toMatch(/^<hr class="[^"]*my-4[^"]*"\/>$/)
  })
})

describe('CartIcon', () => {
  it('is a decorative 24 px stroke icon', () => {
    const html = render(CartIcon, { className: 'shrink-0' })
    expect(html).toMatch(/^<svg [^>]*viewBox="0 0 24 24"/)
    expect(html).toContain('aria-hidden="true"')
    expect(html).toContain('stroke="currentColor"')
    expect(classOf(html.replace(/^<svg [^>]*?(class="[^"]*")[\s\S]*$/, '$1'))).toEqual(['size-6', 'shrink-0'])
  })
})

describe('QuantityStepper', () => {
  const base: QuantityStepperProps = {
    inputId: 'quantity',
    name: 'quantity',
    value: '1',
    min: 1,
    max: 10,
    onValueChange: () => {},
    onStep: () => {},
    decreaseLabel: 'Giảm số lượng',
    increaseLabel: 'Tăng số lượng',
  }
  const buttons = (html: string) => [...html.matchAll(/<button [^>]*>/g)].map((match) => match[0])

  it('renders − / number / + with named 44 px buttons', () => {
    const html = render(QuantityStepper, { ...base, value: '3' })
    const [decrease, increase] = buttons(html)
    expect(decrease).toContain('aria-label="Giảm số lượng"')
    expect(decrease).toContain('type="button"')
    expect(increase).toContain('aria-label="Tăng số lượng"')
    expect(html).toContain('>\u2212</button>')
    expect(html).toContain('>+</button>')
    expect(html.match(/size-11/g)).toHaveLength(2)
    const input = /<input [^>]*>/.exec(html)?.[0] ?? ''
    expect(input).toMatch(/type="number"/)
    expect(input).toMatch(/inputMode="numeric"/i)
    expect(input).toContain('id="quantity"')
    expect(input).toContain('value="3"')
    expect(classOf(input)).toContain('quantity-field')
    expect(html).not.toContain('disabled=""')
  })

  it('disables − at the minimum and + at the maximum with the real attribute', () => {
    const [atMinDecrease, atMinIncrease] = buttons(render(QuantityStepper, base))
    expect(atMinDecrease).toContain('disabled=""')
    expect(atMinIncrease).not.toContain('disabled=""')
    const [atMaxDecrease, atMaxIncrease] = buttons(render(QuantityStepper, { ...base, value: '10' }))
    expect(atMaxDecrease).not.toContain('disabled=""')
    expect(atMaxIncrease).toContain('disabled=""')
  })

  it('disables + when canIncrease is false and names the input when inputLabel is set', () => {
    const html = render(QuantityStepper, { ...base, value: '3', min: 0, canIncrease: false, inputLabel: 'Số lượng Áo', describedBy: 'w-1' })
    expect(buttons(html)[1]).toContain('disabled=""')
    expect(html).toContain('aria-label="Số lượng Áo"')
    expect(html).toContain('aria-describedby="w-1"')
  })
})
