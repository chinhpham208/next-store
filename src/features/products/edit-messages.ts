import type { ProductEditErrors, ProductEditField, ProductEditState } from '@/features/products/types'

// Text of the admin edit form (plan M5 Task 9, Cổng 2 M5 decision 4). Types only, so the client form can import it.
// "Giá không được âm" and "Tên không được để trống" are the words of US-13: they do not change.

const STOCK_RANGE = 'Tồn kho là số nguyên từ 0 đến 10.000'

const FIELD_MESSAGES: { [Field in ProductEditField]: Record<ProductEditErrors[Field], string> } = {
  name: { empty: 'Tên không được để trống', 'too-long': 'Tên tối đa 120 ký tự' },
  price: {
    negative: 'Giá không được âm',
    'not-integer': 'Giá phải là số nguyên (đồng)',
    'too-large': 'Giá tối đa 100.000.000 ₫',
  },
  description: { empty: 'Mô tả không được để trống', 'too-long': 'Mô tả tối đa 2.000 ký tự' },
  stock: { negative: STOCK_RANGE, 'not-integer': STOCK_RANGE, 'too-large': STOCK_RANGE },
}

export const productEditErrorMessage = <Field extends ProductEditField>(
  field: Field,
  error: ProductEditErrors[Field],
): string => {
  const messages: Record<ProductEditErrors[Field], string> = FIELD_MESSAGES[field]
  return messages[error]
}

export const PRODUCT_EDIT_SAVING = 'Đang lưu…'

// The hint under each label (Gate 2 decision 3): the field's aria-describedby is the hint, then the error if any.
export const PRODUCT_EDIT_HINTS: Record<ProductEditField, string> = {
  name: 'Tối đa 120 ký tự.',
  price: 'Chỉ gõ chữ số, đơn vị đồng. Ví dụ: 199000.',
  stock: '0 là hết hàng: cửa hàng hiện "Hết hàng" và khoá nút "Thêm vào giỏ".',
  description: 'Tối đa 2.000 ký tự.',
}

/**
 * When the action itself rejects and the session is still there (the network failed, a 500, a new deploy no
 * longer knows the action's id): the cart's CART_NETWORK_ERROR word for word (Gate 2 decision 6), repeated as the
 * login form does, since a client file may not reach into another feature.
 */
export const PRODUCT_EDIT_NETWORK_ERROR = 'Không kết nối được. Vui lòng tải lại trang và thử lại.'

// A sentence with one link inside: before + link.label + after is the whole text of the alert.
export type ProductEditStateMessage = { before: string; link: { label: string; href: string }; after: string }

const RELOAD = 'Tải lại trang'

/** The general message of a refused save, or null when there is none (idle, saved, field errors only). */
export const productEditStateMessage = (state: ProductEditState, slug: string): ProductEditStateMessage | null => {
  const page = `/admin/products/${slug}`
  if (state.status === 'invalid') {
    return state.formError === 'invalid'
      ? { before: 'Biểu mẫu đã cũ. ', link: { label: RELOAD, href: page }, after: ' rồi sửa lại.' }
      : null
  }
  if (state.status !== 'error') return null
  switch (state.error) {
    case 'conflict':
      return { before: 'Sản phẩm vừa được sửa ở nơi khác. ', link: { label: RELOAD, href: page }, after: ' để xem bản mới nhất.' }
    case 'unauthorized':
      return { before: 'Phiên đăng nhập đã hết. ', link: { label: 'Đăng nhập lại', href: '/admin/login' }, after: '.' }
    case 'unavailable':
      // A write that timed out may have been saved (ADR-0011): say so, and the action never retries.
      return {
        before: 'Không chắc thay đổi đã được lưu. ',
        link: { label: RELOAD, href: page },
        after: ' để xem dữ liệu hiện tại rồi thử lại.',
      }
    case 'not-found':
      return {
        before: 'Sản phẩm này không còn trong cửa hàng. ',
        link: { label: 'Về danh sách sản phẩm', href: '/admin/products' },
        after: '.',
      }
    default:
      return assertNever(state.error)
  }
}

const assertNever = (value: never): never => {
  throw new Error(`unexpected product edit error: ${String(value)}`)
}
