import { z } from 'zod'
import { MAX_LINE_QUANTITY } from '@/features/cart/limits'
import { isProductSlug } from '@/features/products'

// Only ids the server generated (crypto.randomUUID() is v4): anything else in the cookie means "no cart", and a
// malformed value never reaches the database (ADR-0014 3A).
export const cartIdSchema = z.uuidv4().brand<'CartId'>()
export type CartId = z.infer<typeof cartIdSchema>

// The same slug rule as the product pages and the proxy, so an action never looks up a slug no page can have.
const slug = z.string().refine(isProductSlug)

// strict(): an action is a public POST (plan M4 D5), so a key the action does not expect — a cartId, a price — is
// refused rather than silently dropped.
export const addToCartInput = z
  .object({ slug, quantity: z.int().min(1).max(MAX_LINE_QUANTITY) })
  .strict()

// 0 removes the line (US-07).
export const setCartQuantityInput = z
  .object({ slug, quantity: z.int().min(0).max(MAX_LINE_QUANTITY) })
  .strict()

export const removeFromCartInput = z.object({ slug }).strict()
