import 'server-only'
import { connection } from 'next/server'
import { hasAdminSession } from '@/features/admin'
import { readPaymentConfig } from '@/features/checkout/config'

export type CheckoutAccess = 'open' | 'not-open' | 'not-configured'

/**
 * Who may use test payments (decision 14A). Payments off → `not-configured`, without reading the session. `public` →
 * `open`. `admin` → `open` only with an admin session. Every entry point (cart box, startCheckoutAction,
 * /checkout/test, fakeGatewayAction) calls this before it reads a cart or an order, touches the database or signs.
 */
export const checkoutAccess = async (): Promise<CheckoutAccess> => {
  // The request first, the env after (audit PR #124 M1, same class as audit PR #105 M1): with cacheComponents, a
  // read of process.env before any dynamic API is prerendered with the env of the build, so a server started with
  // another TEST_PAYMENTS_ACCESS or without FAKE_PAYMENT_SECRET would serve the answer baked at build time.
  await connection()
  const config = readPaymentConfig()
  if (!config.enabled) return 'not-configured'
  if (config.access === 'public') return 'open'
  return (await hasAdminSession()) ? 'open' : 'not-open'
}
