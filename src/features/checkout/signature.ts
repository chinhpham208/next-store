// The only place that signs or verifies a payment event (ADR-0021, conventions.md §1). No `server-only`, no zod: Web
// Crypto only, like admin/session.ts.
//
// Header `x-fake-signature: t=<unix seconds, 10 digits>,v1=<base64url HMAC-SHA256 of "<t>.<body>">`. The MAC is over
// the bytes of the body as received (a Uint8Array, never text decoded and encoded again: a BOM or an invalid UTF-8
// sequence changes the MAC), never over JSON parsed and written again.

export const FAKE_SIGNATURE_HEADER = 'x-fake-signature'
export const FAKE_SIGNATURE_TOLERANCE_SECONDS = 300
/** The one source of the minimum secret length: config.ts imports it. */
export const MIN_FAKE_SECRET_LENGTH = 32

// 32 bytes are 43 base64url characters; the last one carries 4 bits of data and 2 spare bits, which must be zero, so
// 4 spellings of one MAC are not 4 accepted headers (same rule as the admin token).
const HEADER_PATTERN = /^t=(\d{10}),v1=([A-Za-z0-9_-]{42}[AEIMQUYcgkosw048])$/

// Fixed text: never the secret or its length.
const SECRET_TOO_SHORT = 'fake payment: the secret is too short'

const encoder = new TextEncoder()

const assertSecret = (secret: string): void => {
  if (secret.trim().length < MIN_FAKE_SECRET_LENGTH) throw new Error(SECRET_TOO_SHORT)
}

type Body = string | Uint8Array

// `<t>.` then the body bytes as they are: a string is encoded once here, bytes are used untouched.
const signedBytes = (time: string, body: Body): Uint8Array<ArrayBuffer> => {
  const prefix = encoder.encode(`${time}.`)
  const bytes = typeof body === 'string' ? encoder.encode(body) : body
  const out = new Uint8Array(prefix.length + bytes.length)
  out.set(prefix, 0)
  out.set(bytes, prefix.length)
  return out
}

const importKey = (secret: string): Promise<CryptoKey> =>
  crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'])

const toBase64Url = (bytes: Uint8Array): string => {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

const fromBase64Url = (text: string): Uint8Array<ArrayBuffer> => {
  const binary = atob(`${text.replaceAll('-', '+').replaceAll('_', '/')}=`)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

const unixSeconds = (date: Date): number => Math.floor(date.getTime() / 1000)

/** The header value for `body`, signed at `now`. A secret under 32 characters throws. */
export const signFakeEvent = async ({
  secret,
  body,
  now,
}: {
  secret: string
  body: Body
  now: Date
}): Promise<string> => {
  assertSecret(secret)
  const time = String(unixSeconds(now))
  const mac = await crypto.subtle.sign('HMAC', await importKey(secret), signedBytes(time, body))
  return `t=${time},v1=${toBase64Url(new Uint8Array(mac))}`
}

export type SignatureVerdict = 'ok' | 'unsigned' | 'bad-signature' | 'expired'

/**
 * `unsigned` for a missing header; `bad-signature` for any other shape (verify is not called) or a MAC that
 * crypto.subtle.verify refuses (constant-time inside Web Crypto, never `===` on strings); `expired` when the signing
 * time is more than 300 seconds from `now`, either way. A secret under 32 characters throws: callers check the config.
 */
export const verifyFakeSignature = async ({
  secret,
  body,
  header,
  now,
}: {
  secret: string
  body: Body
  header: string | null
  now: Date
}): Promise<SignatureVerdict> => {
  assertSecret(secret)
  if (header === null) return 'unsigned'
  const match = HEADER_PATTERN.exec(header)
  const time = match?.[1]
  const mac = match?.[2]
  if (time === undefined || mac === undefined) return 'bad-signature'
  // Cheap checks first (shape, then the 300 s window), the MAC last, as the plan orders them (ADR-0021).
  if (Math.abs(unixSeconds(now) - Number(time)) > FAKE_SIGNATURE_TOLERANCE_SECONDS) return 'expired'
  try {
    const valid = await crypto.subtle.verify(
      'HMAC',
      await importKey(secret),
      fromBase64Url(mac),
      signedBytes(time, body),
    )
    return valid ? 'ok' : 'bad-signature'
  } catch {
    return 'bad-signature'
  }
}
