import { describe, expect, it } from 'vitest'
import { LOGIN_NETWORK_ERROR, LOGIN_PENDING_MESSAGE, loginErrorMessage } from '@/features/admin/messages'
import { LOGIN_WINDOW_MINUTES } from '@/features/admin/limits'
import type { LoginError } from '@/features/admin/types'

// The exact strings of the Gate 2 mock ("Văn bản chính xác"); "Mật khẩu không đúng." is the wording of US-12.
// `satisfies Record` makes typecheck fail when a LoginError has no line here.
const EXPECTED = {
  invalid: 'Vui lòng nhập mật khẩu.',
  'wrong-password': 'Mật khẩu không đúng.',
  locked: 'Đăng nhập sai quá nhiều lần. Vui lòng thử lại sau 15 phút.',
  'not-configured': 'Khu quản trị chưa được cấu hình.',
  unavailable: 'Không đăng nhập được lúc này. Vui lòng thử lại.',
} satisfies Record<LoginError, string>
const CASES: [LoginError, string][] = [
  ['invalid', EXPECTED.invalid],
  ['wrong-password', EXPECTED['wrong-password']],
  ['locked', EXPECTED.locked],
  ['not-configured', EXPECTED['not-configured']],
  ['unavailable', EXPECTED.unavailable],
]

describe('loginErrorMessage', () => {
  it.each(CASES)('has the approved text for %s', (error, text) => {
    expect(loginErrorMessage(error)).toBe(text)
  })

  it('covers every LoginError', () => {
    expect(CASES.map(([error]) => error).sort()).toEqual(Object.keys(EXPECTED).sort())
  })

  it('US-12: wrong-password reads "Mật khẩu không đúng."', () => {
    expect(loginErrorMessage('wrong-password')).toBe('Mật khẩu không đúng.')
  })

  it('the lock message names the real window', () => {
    expect(loginErrorMessage('locked')).toContain(`${LOGIN_WINDOW_MINUTES} phút`)
  })
})

describe('form strings', () => {
  it('a rejected action reads like the cart (CART_NETWORK_ERROR, Gate 2 decision 6)', () => {
    expect(LOGIN_NETWORK_ERROR).toBe('Không kết nối được. Vui lòng tải lại trang và thử lại.')
  })

  it('waiting reads "Đang đăng nhập…"', () => {
    expect(LOGIN_PENDING_MESSAGE).toBe('Đang đăng nhập…')
  })
})
