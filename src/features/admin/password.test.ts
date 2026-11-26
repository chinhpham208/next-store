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
const { readAdminConfig } = await import('@/features/admin/config')

// Fake values, test only.
const EXPECTED = 'test-admin-password-0123'
const SECRET = 'test-session-secret-0123456789abcdef'

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

  it('compares against the trimmed ADMIN_PASSWORD from the config', () => {
    // A password pasted into Vercel with a trailing newline must not lock the admin out.
    const config = readAdminConfig({ ADMIN_PASSWORD: `${EXPECTED}\n`, SESSION_SECRET: SECRET })
    expect(config.enabled).toBe(true)
    if (!config.enabled) return
    expect(passwordMatches(EXPECTED, config.password)).toBe(true)
    expect(passwordMatches(`${EXPECTED}\n`, config.password)).toBe(false)
  })
})

// Audit PR #105 N3: the form check (actions.ts) and the comparison (password.ts) share one input limit.
describe('the password length limit', () => {
  it('lives once in limits.ts and both actions.ts and password.ts import it', async () => {
    const { readFileSync } = await import('node:fs')
    const { MAX_PASSWORD_LENGTH } = await import('@/features/admin/limits')
    expect(MAX_PASSWORD_LENGTH).toBe(256)
    for (const path of ['src/features/admin/actions.ts', 'src/features/admin/password.ts']) {
      const source = readFileSync(path, 'utf8')
      // SHA-256 aside, no second copy of the number.
      expect(source, path).not.toMatch(/(?<!SHA-)\b256\b/)
      expect(source, path).toMatch(/import \{[^}]*\bMAX_PASSWORD_LENGTH\b[^}]*\} from '@\/features\/admin\/limits'/)
    }
  })
})
