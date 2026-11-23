// No imports on purpose: client components (M4 Task 8) and the Zod schemas share these numbers.

/** Most of one product in a cart (ADR-0014 5A); stock caps it further. */
export const MAX_LINE_QUANTITY = 10
/** Most distinct products in one cart (ADR-0014 5A). */
export const MAX_CART_LINES = 20
/** Sliding expiry of a cart: the cookie's Max-Age and the age of carts.updated_at (ADR-0014 6A). */
export const CART_TTL_DAYS = 30
/**
 * Most carts in the database, about 23 MB at ~234 bytes a cart (NS-104, ADR-0014 Bổ sung 2026-11-24). Creating a
 * cart is never refused: past this, the oldest carts are evicted instead.
 */
export const MAX_CARTS = 100_000
