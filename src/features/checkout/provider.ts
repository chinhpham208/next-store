import 'server-only'
import { readPaymentConfig } from '@/features/checkout/config'
import { createFakeProvider } from '@/features/checkout/providers/fake'
import type { PaymentProvider } from '@/features/checkout/types'

/** The configured gateway, or null when payments are off (missing or weak config, unsupported provider). */
export const getPaymentProvider = (): PaymentProvider | null => {
  const config = readPaymentConfig()
  return config.enabled ? createFakeProvider({ secret: config.fakeSecret }) : null
}
