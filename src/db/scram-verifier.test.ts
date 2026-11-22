import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { PASSWORD_ERRORS, passwordFromInput, scramVerifier } from '../../scripts/scram-verifier.mjs'

// Known vector: Postgres 16.15 itself stored this for `CREATE ROLE … PASSWORD '<VECTOR_PASSWORD>'` (fake password, made
// for this test). Same password and salt must give byte-for-byte the same verifier, which is what the server compares
// a SCRAM login against.
const VECTOR_PASSWORD = 'pencil-Test-Vector-0123456789'
const VECTOR_SALT = 'xO8TxUVfx3i1IFxMjmJz3w=='
const VECTOR =
  'SCRAM-SHA-256$4096:xO8TxUVfx3i1IFxMjmJz3w==$4llW22+4mDgz9C5imeZvwNpawGgb5cT+tC42fnqMmT4=:' +
  'OgwHV074LxOy3b3aYxRPa2RSfiFDcSSv4JoByBDdlPM='
const FORMAT = /^SCRAM-SHA-256\$4096:[A-Za-z0-9+/]{22}==\$[A-Za-z0-9+/]{43}=:[A-Za-z0-9+/]{43}=$/
const PASSWORD = 'Abcdefghij0123456789KLMNOPQRSTuvwxyz9876'

const runCli = (input: string) =>
  spawnSync(process.execPath, ['scripts/scram-verifier.mjs'], { input, encoding: 'utf8', timeout: 20_000 })

describe('scramVerifier (NS-60, audit PR #39 M1)', () => {
  it('matches the verifier Postgres stores for the same password and salt', () => {
    expect(scramVerifier(VECTOR_PASSWORD, Buffer.from(VECTOR_SALT, 'base64'))).toBe(VECTOR)
  })
  it('uses a fresh 16-byte salt and 4096 iterations by default', () => {
    const first = scramVerifier(PASSWORD)
    const second = scramVerifier(PASSWORD)
    expect(first).toMatch(FORMAT)
    expect(second).toMatch(FORMAT)
    expect(first).not.toBe(second)
  })
  it.each([
    ['an empty password', '', PASSWORD_ERRORS.empty],
    ['a non-ASCII password', 'mật-khẩu-có-dấu-0123456789abcdef', PASSWORD_ERRORS.nonAscii],
    ['a password with a tab', 'abcdefghij\t0123456789klmnop', PASSWORD_ERRORS.nonAscii],
    ['a password with a NUL', 'abcdefghij\u00000123456789klmnop', PASSWORD_ERRORS.nonAscii],
    ['a short password', 'Short-but-ascii-1', PASSWORD_ERRORS.tooShort],
    ['an endpoint= password', 'endpoint=ep-x;0123456789abcdefghij', PASSWORD_ERRORS.endpoint],
    ['a project= password', 'Project=p$0123456789abcdefghijkl', PASSWORD_ERRORS.endpoint],
  ])('refuses %s with a fixed message', (_label, password, message) => {
    const run = () => scramVerifier(password)
    expect(run).toThrow(message)
    if (password !== '') expect(run).not.toThrow(password)
  })
  it('strips exactly one trailing line break from stdin', () => {
    expect(passwordFromInput(`${PASSWORD}\n`)).toBe(PASSWORD)
    expect(passwordFromInput(`${PASSWORD}\r\n`)).toBe(PASSWORD)
    expect(passwordFromInput(`${PASSWORD} \n\n`)).toBe(`${PASSWORD} \n`)
  })
})

describe('node scripts/scram-verifier.mjs', () => {
  it('prints one verifier line for the password on stdin and never the password', () => {
    const result = runCli(`${PASSWORD}\n`)
    expect(result.status).toBe(0)
    expect(result.stdout).toMatch(/^SCRAM-SHA-256\$[^\n]+\n$/)
    const verifier = result.stdout.trim()
    expect(verifier).toMatch(FORMAT)
    // Recomputing with the printed salt gives the same keys, so the line is the verifier of exactly this password.
    const salt = verifier.split(':')[1]?.split('$')[0] ?? ''
    expect(scramVerifier(PASSWORD, Buffer.from(salt, 'base64'))).toBe(verifier)
    expect(`${result.stdout}${result.stderr}`).not.toContain(PASSWORD)
  })
  it.each([
    ['non-ASCII', 'mật-khẩu-có-dấu-0123456789abcdef\n', PASSWORD_ERRORS.nonAscii],
    ['empty', '', PASSWORD_ERRORS.empty],
  ])('exits 1 with a clear message on %s input and prints no verifier', (_label, input, message) => {
    const result = runCli(input)
    expect(result.status).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr.trim()).toBe(message)
    if (input.trim() !== '') expect(result.stderr).not.toContain(input.trim())
  })
})
