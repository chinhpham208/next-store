'use client'

import { logoutAction } from '@/features/admin/actions'

// The "Đăng xuất" of the admin bar (Gate 2 decision 1; placed by AdminShell, M5 Task 8). A client file so the form
// gets the action reference as a progressively enhanced form: logging out also works before hydration. The action
// needs no session, so a stale tab can always log out.
export const LogoutButton = () => (
  <form action={logoutAction} className="ml-auto">
    <button
      type="submit"
      className="inline-flex min-h-11 items-center justify-center rounded-md border border-inverse-muted px-4 text-sm font-semibold whitespace-nowrap hover:bg-inverse-border"
    >
      Đăng xuất
    </button>
  </form>
)
