import { LOGIN_WINDOW_MINUTES } from '@/features/admin/limits'
import type { LoginError } from '@/features/admin/types'

// Shown by the client login form, so this file imports only limits.ts and types.ts (conventions.md §1). The texts
// are the approved ones of the Gate 2 mock (M5 Task 2, "Văn bản chính xác"); "Mật khẩu không đúng." is US-12's.

/**
 * When the action itself rejects (the network failed, a new deploy no longer knows the action's id): the cart's
 * CART_NETWORK_ERROR word for word (Gate 2 decision 6). Repeated, not imported: a client file may not reach into
 * another feature.
 */
export const LOGIN_NETWORK_ERROR = 'Không kết nối được. Vui lòng tải lại trang và thử lại.'

export const LOGIN_PENDING_MESSAGE = 'Đang đăng nhập…'

const assertNever = (value: never): never => {
  throw new Error(`unknown login error: ${String(value)}`)
}

export const loginErrorMessage = (error: LoginError): string => {
  switch (error) {
    case 'invalid':
      return 'Vui lòng nhập mật khẩu.'
    case 'wrong-password':
      return 'Mật khẩu không đúng.'
    case 'locked':
      return `Đăng nhập sai quá nhiều lần. Vui lòng thử lại sau ${LOGIN_WINDOW_MINUTES} phút.`
    case 'not-configured':
      return 'Khu quản trị chưa được cấu hình.'
    case 'unavailable':
      return 'Không đăng nhập được lúc này. Vui lòng thử lại.'
    default:
      return assertNever(error)
  }
}
