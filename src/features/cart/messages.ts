import { MAX_CART_LINES, MAX_LINE_QUANTITY } from '@/features/cart/limits'
import type { CartError } from '@/features/cart/types'

// Client components (M4 Task 8, 9) show these next to the button or the line, so this file imports only
// limits.ts and types.ts (plan M4 Global Constraints). The designer may reword them at Gate 2, except
// "Chỉ còn N sản phẩm", which is the wording of US-08.

/** When the action itself rejects: the network failed, or a new deploy no longer knows the action's id. */
export const CART_NETWORK_ERROR = 'Không kết nối được. Vui lòng tải lại trang và thử lại.'

const assertNever = (value: never): never => {
  throw new Error(`unknown cart error: ${String(value)}`)
}

export const cartErrorMessage = ({ error, available }: { error: CartError; available?: number }): string => {
  switch (error) {
    case 'over-stock':
      // The action always sends `available` with over-stock; without it there is no number to show.
      return available === undefined ? 'Không đủ hàng trong kho' : `Chỉ còn ${available} sản phẩm`
    case 'out-of-stock':
      return 'Sản phẩm đã hết hàng'
    case 'line-limit':
      return `Mỗi sản phẩm tối đa ${MAX_LINE_QUANTITY} cái`
    case 'cart-full':
      return `Giỏ hàng tối đa ${MAX_CART_LINES} loại sản phẩm`
    case 'invalid':
    case 'not-found':
      return 'Không tìm thấy sản phẩm'
    case 'unavailable':
      return 'Không cập nhật được giỏ hàng. Vui lòng thử lại.'
    default:
      return assertNever(error)
  }
}
