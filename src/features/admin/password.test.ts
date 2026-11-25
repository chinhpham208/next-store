import { afterEach, describe, expect, it, vi } from 'vitest'

// Spies over the real functions: the comparison must go through timingSafeEqual, and bad input must not be hashed.
const nodeCrypto = vi.hoisted(() => ({ createHash: vi.fn(), timingSafeEqual: vi.fn() }))
vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:crypto')>()
  nodeCrypto.createHash.mockImplementation(actual.createHash)
  nodeCrypto.timingSafeEqual.mockImplementation(actual.timingSafeEqual)
  return { ...actual, default: actual, createHash: nodeCrypto.createHash, timingSafeEqual: nodeCrypto.timingSafeEqual }
})

const { passwordMatches } = await import('@/features/admin/password')

// Fake value, test only.
const EXPECTED = 'test-admin-password-0123'

afterEach(() => {
  nodeCrypto.createHash.mockClear()
  nodeCrypto.timingSafeEqual.mockClear()
})

describe('passwordMatches', () => {
  it('matches the right password', () => {
    expect(passwordMatches(EXPECTED, EXPECTED)).toBe(true)
  })

  it('rejects a wrong password of the same length', () => {
    const wrong = `${EXPECTED.slice(0, -1)}4`
    expect(wrong).toHaveLength(EXPECTED.length)
    expect(passwordMatches(wrong, EXPECTED)).toBe(false)
  })

  it('rejects a wrong password of another length, empty or padded', () => {
    expect(passwordMatches(EXPECTED.slice(0, -1), EXPECTED)).toBe(false)
    expect(passwordMatches(`${EXPECTED}x`, EXPECTED)).toBe(false)
    expect(passwordMatches(` ${EXPECTED}`, EXPECTED)).toBe(false)
    expect(passwordMatches('', EXPECTED)).toBe(false)
  })

  it('rejects non-strings and inputs over 256 characters without hashing', () => {
    for (const input of [undefined, null, 42, {}, [EXPECTED], new Blob([EXPECTED]), 'x'.repeat(257)]) {
      expect(passwordMatches(input, EXPECTED)).toBe(false)
    }
    expect(nodeCrypto.createHash).not.toHaveBeenCalled()
    expect(nodeCrypto.timingSafeEqual).not.toHaveBeenCalled()
    // 256 is still compared.
    expect(passwordMatches('x'.repeat(256), EXPECTED)).toBe(false)
    expect(nodeCrypto.timingSafeEqual).toHaveBeenCalledTimes(1)
  })

  it('uses timingSafeEqual on two 32-byte SHA-256 digests', () => {
    expect(passwordMatches('a', EXPECTED)).toBe(false)
    expect(nodeCrypto.createHash).toHaveBeenCalledWith('sha256')
    expect(nodeCrypto.timingSafeEqual).toHaveBeenCalledTimes(1)
    const [left, right] = nodeCrypto.timingSafeEqual.mock.calls[0] ?? []
    expect(Buffer.isBuffer(left) ? left.byteLength : 0).toBe(32)
    expect(Buffer.isBuffer(right) ? right.byteLength : 0).toBe(32)
  })
})
