// No imports on purpose: client components (M4 Task 8) and the Zod schemas share these numbers.

/** Most of one product in a cart (ADR-0014 5A); stock caps it further. */
export const MAX_LINE_QUANTITY = 10
/** Most distinct products in one cart (ADR-0014 5A). */
export const MAX_CART_LINES = 20
/** Sliding expiry of a cart: the cookie's Max-Age and the age of carts.updated_at (ADR-0014 6A). */
export const CART_TTL_DAYS = 30
