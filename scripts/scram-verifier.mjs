#!/usr/bin/env node
// Tính verifier SCRAM-SHA-256 của Postgres cho mật khẩu role next_store_app (README, mục "Role app").
//
//   pbpaste | node scripts/scram-verifier.mjs      # macOS: mật khẩu từ clipboard, không hiện trên màn hình
//   node scripts/scram-verifier.mjs                # gõ / dán mật khẩu (không hiện), Enter
//
// In ra đúng một dòng `SCRAM-SHA-256$4096:<salt>$<StoredKey>:<ServerKey>` để dán vào
// `CREATE ROLE next_store_app LOGIN PASSWORD '<verifier>';` trong Neon SQL Editor. Server lưu nguyên verifier, nên log
// câu lệnh, pg_stat_statements và lịch sử SQL Editor chỉ thấy verifier, không thấy mật khẩu (audit PR #39 M1).
// Mật khẩu chỉ đi qua stdin (không nằm trong tham số lệnh hay lịch sử shell) và không bao giờ được in ra.
// Không phụ thuộc thư viện nào ngoài Node, chạy được bằng `node` trên máy chủ dự án mà không cần `npm ci`.
import { createHash, createHmac, pbkdf2Sync, randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

// Same as Postgres (SCRAM_SHA_256_DEFAULT_ITERATIONS, SCRAM_DEFAULT_SALT_LEN).
const ITERATIONS = 4096
const SALT_BYTES = 16
const MIN_LENGTH = 20
// Printable ASCII only: Postgres runs SASLprep on the password, this script does not, so any other character could
// give a verifier the server would never match. Control characters are refused by the app as well (client.ts).
const PRINTABLE_ASCII = /^[\x20-\x7e]+$/
// The app refuses these (Neon would route by the password), so a verifier for them would be useless.
const NEON_PASSWORD_ENDPOINT = /^(?:endpoint|project)=/i

// Fixed text only: no message ever contains the password or a part of it.
export const PASSWORD_ERRORS = {
  empty: 'scram-verifier: không có mật khẩu trên stdin.',
  nonAscii:
    'scram-verifier: mật khẩu chỉ được chứa ký tự ASCII in được (chữ, số, dấu câu, khoảng trắng); ' +
    'script không chạy SASLprep nên ký tự khác có thể cho verifier mà Postgres không khớp. Sinh lại mật khẩu.',
  tooShort: `scram-verifier: mật khẩu phải dài ít nhất ${MIN_LENGTH} ký tự (khuyên dùng 40 ký tự chữ và số ngẫu nhiên).`,
  endpoint: 'scram-verifier: mật khẩu không được bắt đầu bằng endpoint= hoặc project= (ứng dụng sẽ từ chối).',
}

/** @param {string} password */
export const assertUsablePassword = (password) => {
  if (password === '') throw new Error(PASSWORD_ERRORS.empty)
  if (!PRINTABLE_ASCII.test(password)) throw new Error(PASSWORD_ERRORS.nonAscii)
  if (password.length < MIN_LENGTH) throw new Error(PASSWORD_ERRORS.tooShort)
  if (NEON_PASSWORD_ENDPOINT.test(password.trimStart())) throw new Error(PASSWORD_ERRORS.endpoint)
}

/**
 * RFC 5802 / RFC 7677 keys in the format of pg_authid.rolpassword.
 * @param {string} password
 * @param {Buffer} [salt]
 * @returns {string}
 */
export const scramVerifier = (password, salt = randomBytes(SALT_BYTES)) => {
  assertUsablePassword(password)
  const salted = pbkdf2Sync(password, salt, ITERATIONS, 32, 'sha256')
  /** @param {string} text */
  const hmac = (text) => createHmac('sha256', salted).update(text).digest()
  const storedKey = createHash('sha256').update(hmac('Client Key')).digest()
  const serverKey = hmac('Server Key')
  return `SCRAM-SHA-256$${ITERATIONS}:${salt.toString('base64')}$${storedKey.toString('base64')}:${serverKey.toString('base64')}`
}

// One trailing line break is what `pbpaste`, `echo` or Enter add; anything else is part of the password.
/** @param {string} raw */
export const passwordFromInput = (raw) => raw.replace(/\r?\n$/, '')

// Terminal: read without echo (raw mode) until Enter. Pipe: read everything.
const readPassword = async () => {
  const stdin = process.stdin
  if (!stdin.isTTY) return passwordFromInput(readFileSync(0, 'utf8'))
  process.stderr.write('Mật khẩu (không hiện khi gõ), rồi Enter: ')
  stdin.setRawMode(true)
  stdin.setEncoding('utf8')
  let typed = ''
  try {
    for await (const chunk of stdin) {
      for (const char of String(chunk)) {
        if (char === '\u0003') throw new Error('scram-verifier: đã huỷ.')
        if (char === '\r' || char === '\n') return typed
        if (char === '\u007f' || char === '\b') typed = typed.slice(0, -1)
        else typed += char
      }
    }
    return typed
  } finally {
    stdin.setRawMode(false)
    stdin.pause()
    process.stderr.write('\n')
  }
}

const isDirectRun = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href

if (isDirectRun) {
  readPassword()
    .then((password) => {
      process.stdout.write(`${scramVerifier(password)}\n`)
    })
    .catch((error) => {
      // Our own errors are fixed text; anything else (e.g. stdin closed) is reduced to a fixed line.
      const known = Object.values(PASSWORD_ERRORS).includes(error?.message) || error?.message === 'scram-verifier: đã huỷ.'
      process.stderr.write(`${known ? error.message : 'scram-verifier: không đọc được mật khẩu từ stdin.'}\n`)
      process.exit(1)
    })
}
