import 'server-only'
import { hasAdminSession } from '@/features/admin'
import { readPaymentConfig } from '@/features/checkout/config'

export type CheckoutAccess = 'open' | 'not-open' | 'not-configured'

/**
 * Who may use test payments (decision 14A). Payments off → `not-configured`, without reading the session. `public` →
 * `open`. `admin` → `open` only with an admin session. Every entry point (cart box, startCheckoutAction,
 * /checkout/test, fakeGatewayAction) calls this before it reads a cart or an order, touches the database or signs.
 */
export const checkoutAccess = async (): Promise<CheckoutAccess> => {
  const config = readPaymentConfig()
  if (!config.enabled) return 'not-configured'
  if (config.access === 'public') return 'open'
  return (await hasAdminSession()) ? 'open' : 'not-open'
}
