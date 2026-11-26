import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AdminHeader } from '@/features/admin/components/admin-header'
import { LoginForm } from '@/features/admin/components/login-form'
import { LogoutButton } from '@/features/admin/components/logout-button'

// The action module pulls in cookies, headers and the database; the components only hold a reference to it.
vi.mock('@/features/admin/actions', () => ({ loginAction: vi.fn(), logoutAction: vi.fn() }))

afterEach(() => {
  vi.clearAllMocks()
})

const render = (element: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(element)

describe('LoginForm (Gate 2, M5 Task 2)', () => {
  const html = render(createElement(LoginForm))

  it('is a noValidate form with the labelled password field', () => {
    expect(html).toMatch(/<form [^>]*novalidate=""/i)
    expect(html).toContain('<label for="admin-password" class="text-sm font-medium">Mật khẩu</label>')
    const input = /<input [^>]*>/.exec(html)?.[0] ?? ''
    expect(input).toContain('id="admin-password"')
    expect(input).toContain('name="password"')
    expect(input).toContain('type="password"')
    expect(input).toContain('autoComplete="current-password"')
    expect(input).toContain('required=""')
    expect(input).toContain('aria-describedby="admin-password-error"')
    expect(input).not.toContain('aria-invalid=')
  })

  it('has the error alert in the DOM from the start, empty, with the id the field points at', () => {
    expect(html).toContain('<div role="alert" id="admin-password-error"></div>')
  })

  it('has one submit button "Đăng nhập", not disabled, and an empty status region', () => {
    expect(html.match(/<button [^>]*type="submit"[^>]*>Đăng nhập<\/button>/g)).toHaveLength(1)
    expect(html).not.toMatch(/<button [^>]*( disabled=| aria-disabled=)/)
    expect(html).toContain('<div role="status"></div>')
  })

  it('never posts the password in a URL before hydration', () => {
    // React gives a function action a javascript: URL and queues a submit made before hydration (replayed once the
    // form hydrates), so no GET with ?password= can leave.
    const form = /<form [^>]*>/.exec(html)?.[0] ?? ''
    expect(form).not.toMatch(/method="get"/i)
    expect(form).toMatch(/action="javascript:/)
  })

  it('catches a rejected action, rethrowing only Next.js redirects (Gate 2 decision 6)', () => {
    const source = readFileSync('src/features/admin/components/login-form.tsx', 'utf8')
    expect(source).toMatch(/catch \(error\) \{\s*unstable_rethrow\(error\)/)
    expect(source).toContain('LOGIN_NETWORK_ERROR')
  })
})

describe('AdminHeader', () => {
  it('is an Ink band with the title and the given navigation', () => {
    const html = render(createElement(AdminHeader, { layout: 'login' }, createElement('nav', { 'aria-label': 'Quản trị' })))
    expect(html).toMatch(/^<header class="[^"]*bg-inverse[^"]*text-inverse-foreground/)
    expect(html).toContain('Quản trị next-store')
    expect(html).toContain('<nav aria-label="Quản trị"></nav>')
    expect(html).not.toMatch(/<h1/)
  })

  it('stays on one row on the login page and wraps under sm in the shell', () => {
    const login = render(createElement(AdminHeader, { layout: 'login' }))
    const shell = render(createElement(AdminHeader, { layout: 'shell' }))
    const titleOf = (html: string) => /<p class="([^"]*)"/.exec(html)?.[1] ?? ''
    expect(login).toMatch(/ flex-nowrap"/)
    expect(titleOf(login)).not.toContain('w-full')
    expect(shell).toMatch(/ flex-wrap"/)
    expect(titleOf(shell)).toContain('w-full sm:w-auto')
  })
})

describe('LogoutButton', () => {
  it('is a form with one submit button "Đăng xuất" of at least 44 px', () => {
    const html = render(createElement(LogoutButton))
    expect(html).toMatch(/^<form [^>]*class="ml-auto"/)
    expect(html).toMatch(/<button [^>]*type="submit"[^>]*min-h-11[^>]*>Đăng xuất<\/button>/)
  })
})
