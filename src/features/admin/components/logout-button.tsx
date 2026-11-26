'use client'

import { unstable_rethrow } from 'next/navigation'
import { logoutAction } from '@/features/admin/actions'

const LOGIN_PATH = '/admin/login'

// The action needs no session, but on a protected page the proxy answers a stale tab's POST (expired session, new
// SESSION_SECRET) with an empty 401 before the action runs, and Next.js rejects (audit PR #106 M1). The 401 has
// already cleared the cookie, so a full load of /admin/login ends the logout instead of the error page. The
// action's own redirect also rejects: unstable_rethrow hands it to the router (Gate 2 decision 6, as LoginForm).
export const submitLogout = async (): Promise<void> => {
  try {
    await logoutAction()
  } catch (error) {
    unstable_rethrow(error)
    window.location.assign(LOGIN_PATH)
  }
}

// The "Đăng xuất" of the admin bar (Gate 2 decision 1; placed by AdminShell, M5 Task 8). A function action: React
// gives the form a javascript: URL and replays a submit made before hydration once the form hydrates.
export const LogoutButton = () => (
  <form action={submitLogout} className="ml-auto">
    <button
      type="submit"
      className="inline-flex min-h-11 items-center justify-center rounded-md border border-inverse-muted px-4 text-sm font-semibold whitespace-nowrap hover:bg-inverse-border"
    >
      Đăng xuất
    </button>
  </form>
)
