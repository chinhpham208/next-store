import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { requireAdminPage } from '@/features/admin/cookie'
import { AdminGate } from '@/features/admin/components/admin-gate'
import { AdminHeader } from '@/features/admin/components/admin-header'
import { AdminShell, AdminShellSkeleton } from '@/features/admin/components/admin-shell'
import { LoginForm } from '@/features/admin/components/login-form'
import { LogoutButton } from '@/features/admin/components/logout-button'

// The action module pulls in cookies, headers and the database; the components only hold a reference to it.
vi.mock('@/features/admin/actions', () => ({ loginAction: vi.fn(), logoutAction: vi.fn() }))
// The session check reads cookies() and the env; here only its outcome matters.
vi.mock('@/features/admin/cookie', () => ({ requireAdminPage: vi.fn() }))

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

describe('AdminShell (Gate 2 decision 1, M5 Task 8)', () => {
  const html = render(createElement(AdminShell, null, createElement('h1', null, 'Trang')))

  it('is the shell header with the "Sản phẩm" link and "Đăng xuất", then the page in main', () => {
    expect(html).toMatch(/^<header /)
    expect(html).toMatch(/ flex-wrap"/)
    expect(html).toContain('<nav aria-label="Quản trị" class="-ml-2 flex sm:ml-0">')
    const link = /<a [^>]*>Sản phẩm<\/a>/.exec(html)?.[0] ?? ''
    expect(link).toContain('href="/admin/products"')
    expect(link).toContain('min-h-11')
    expect(html).toContain('>Đăng xuất</button>')
    expect(html).toContain('<main class="flex-1"><h1>Trang</h1></main>')
    expect(html).not.toContain('aria-current')
  })

  it('has a skeleton with the title only: no nav, no button, an empty main', () => {
    const skeleton = render(createElement(AdminShellSkeleton))
    expect(skeleton).toContain('Quản trị next-store')
    expect(skeleton).not.toMatch(/<nav|<button|<form|<a /)
    expect(skeleton).toContain('<main class="flex-1"></main>')
  })
})

describe('AdminGate', () => {
  const gate = vi.mocked(requireAdminPage)

  it('checks the session before rendering the shell and the page', async () => {
    let checkedBeforeRender = false
    gate.mockImplementation(async () => {
      checkedBeforeRender = true
    })
    const element = await AdminGate({ children: createElement('p', null, 'bí mật') })
    expect(checkedBeforeRender).toBe(true)
    expect(gate).toHaveBeenCalledTimes(1)
    const html = render(element)
    expect(html).toContain('Đăng xuất')
    expect(html).toContain('<p>bí mật</p>')
  })

  it('renders nothing of the page when the check redirects', async () => {
    const redirect = new Error('NEXT_REDIRECT')
    gate.mockRejectedValue(redirect)
    const page = vi.fn(() => createElement('p', null, 'bí mật'))
    await expect(AdminGate({ children: createElement(page) })).rejects.toBe(redirect)
    expect(page).not.toHaveBeenCalled()
  })

  it('is the gate of the (protected) layout, inside Suspense with the skeleton as fallback', () => {
    const layout = readFileSync('src/app/admin/(protected)/layout.tsx', 'utf8')
    expect(layout).toMatch(/<Suspense fallback=\{<AdminShellSkeleton \/>\}>\s*<AdminGate>\{children\}<\/AdminGate>\s*<\/Suspense>/)
    const source = readFileSync('src/features/admin/components/admin-gate.tsx', 'utf8')
    expect(source).toMatch(/await requireAdminPage\(\)\s*return <AdminShell>/)
  })
})
