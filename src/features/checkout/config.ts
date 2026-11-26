import 'server-only'
import type { PaymentProviderId } from '@/features/orders'

// ADR-0021: fail closed. A missing or weak FAKE_PAYMENT_SECRET, or a provider without an adapter, turns payments off;
// an unknown TEST_PAYMENTS_ACCESS closes them to everyone but admin. Never logs a value, never carries one in a
// disabled answer.

export const MIN_PAYMENT_SECRET_LENGTH = 32

export type PaymentConfig =
  | { enabled: true; provider: PaymentProviderId; fakeSecret: string; access: 'public' | 'admin' }
  | { enabled: false; reason: 'missing' | 'weak' | 'unsupported' }

export type PaymentEnv = {
  PAYMENT_PROVIDER?: string | undefined
  FAKE_PAYMENT_SECRET?: string | undefined
  SESSION_SECRET?: string | undefined
  TEST_PAYMENTS_ACCESS?: string | undefined
}

// Named reads, not process.env as a whole.
const processEnv = (): PaymentEnv => ({
  PAYMENT_PROVIDER: process.env.PAYMENT_PROVIDER,
  FAKE_PAYMENT_SECRET: process.env.FAKE_PAYMENT_SECRET,
  SESSION_SECRET: process.env.SESSION_SECRET,
  TEST_PAYMENTS_ACCESS: process.env.TEST_PAYMENTS_ACCESS,
})

// Trimmed: a value pasted with a trailing newline must not become part of the HMAC key.
const present = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

export const readPaymentConfig = (env: PaymentEnv = processEnv()): PaymentConfig => {
  if ((present(env.PAYMENT_PROVIDER) ?? 'fake') !== 'fake') return { enabled: false, reason: 'unsupported' }
  const secret = present(env.FAKE_PAYMENT_SECRET)
  if (secret === undefined) return { enabled: false, reason: 'missing' }
  if (secret.length < MIN_PAYMENT_SECRET_LENGTH) return { enabled: false, reason: 'weak' }
  // One value for both would let whoever holds a session secret sign payment events.
  if (secret === present(env.SESSION_SECRET)) return { enabled: false, reason: 'weak' }
  // Decision 14A: only the exact word `public` opens test payments to everyone; empty, unset or anything else is admin.
  const access = present(env.TEST_PAYMENTS_ACCESS) === 'public' ? 'public' : 'admin'
  return { enabled: true, provider: 'fake', fakeSecret: secret, access }
}
