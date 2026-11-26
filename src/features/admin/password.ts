import 'server-only'
import { createHash, timingSafeEqual } from 'node:crypto'
import { MAX_PASSWORD_LENGTH } from '@/features/admin/limits'

// ADR-0018 5A. Input longer than MAX_PASSWORD_LENGTH is refused before hashing: the action body is already capped
// (ADR-0016), this keeps the work per attempt fixed and small.

const sha256 = (value: string): Buffer => createHash('sha256').update(value, 'utf8').digest()

/**
 * Compares SHA-256 digests with timingSafeEqual: both buffers are always 32 bytes, so neither the content nor the
 * length of the expected password shows in the time taken. Anything but a string of at most MAX_PASSWORD_LENGTH
 * characters is false.
 */
export const passwordMatches = (input: unknown, expected: string): boolean => {
  if (typeof input !== 'string' || input.length > MAX_PASSWORD_LENGTH) return false
  return timingSafeEqual(sha256(input), sha256(expected))
}
