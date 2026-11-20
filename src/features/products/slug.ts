// No imports on purpose: src/proxy.ts reaches this through proxy-api.ts and is bundled on its own, so anything
// imported here (zod, for one) would ride along into every /products/<slug> request (audit PR #26 L1).

export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const MAX_SLUG_LENGTH = 80

// unknown, not string: RegExp.test coerces its argument (['ao-x'] → 'ao-x'), and the proxy must never throw on input.
export const isProductSlug = (value: unknown): value is string =>
  typeof value === 'string' && value.length <= MAX_SLUG_LENGTH && SLUG_PATTERN.test(value)
