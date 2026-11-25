// The only place that signs or verifies an admin session token (ADR-0018 6A, conventions.md §1). No `server-only`,
// no zod: src/proxy.ts uses it through proxy-api.ts. Web Crypto only, so it runs in the proxy and in the app alike.
//
// Token: `v1.<exp>.<sig>`. `exp` is the absolute expiry in Unix seconds (10 digits), `sig` the base64url HMAC-SHA256
// of `v1.<exp>` with SESSION_SECRET. Nothing else is in the cookie.

export const ADMIN_SESSION_TTL_SECONDS = 8 * 60 * 60

export const MIN_SESSION_SECRET_LENGTH = 32

const VERSION = 'v1'

// 32 bytes are 43 base64url characters; the last one carries 4 bits of data and 2 spare bits, which must be zero.
// Without that, 4 spellings of one signature would verify (a decoder ignores the spare bits), so a "changed"
// cookie could still be accepted. Hence the last character is limited to the 16 canonical ones.
const TOKEN_PATTERN = /^v1\.(\d{10})\.([A-Za-z0-9_-]{42}[AEIMQUYcgkosw048])$/

// Fixed text: never the secret, its length or the token.
const SECRET_TOO_SHORT = 'admin session: the secret is too short'

const encoder = new TextEncoder()

const assertSecret = (secret: string): void => {
  // Counted without surrounding whitespace, like readAdminConfig: 40 spaces are not a secret.
  if (secret.trim().length < MIN_SESSION_SECRET_LENGTH) throw new Error(SECRET_TOO_SHORT)
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

/** A new token valid for ADMIN_SESSION_TTL_SECONDS from `now`. A secret under 32 characters throws. */
export const signSession = async ({ secret, now }: { secret: string; now: Date }): Promise<string> => {
  assertSecret(secret)
  const payload = `${VERSION}.${String(unixSeconds(now) + ADMIN_SESSION_TTL_SECONDS)}`
  const signature = await crypto.subtle.sign('HMAC', await importKey(secret), encoder.encode(payload))
  return `${payload}.${toBase64Url(new Uint8Array(signature))}`
}

/**
 * True only for a well-formed token, not expired, expiring no later than `now` + TTL, whose signature
 * crypto.subtle.verify accepts (constant-time comparison inside Web Crypto, never `===` on strings). Every other
 * case, a Web Crypto error included, is false. A secret under 32 characters throws: callers check the config first.
 */
export const verifySession = async ({
  token,
  secret,
  now,
}: {
  token: string | undefined
  secret: string
  now: Date
}): Promise<boolean> => {
  assertSecret(secret)
  if (token === undefined) return false
  const match = TOKEN_PATTERN.exec(token)
  const exp = match?.[1]
  const signature = match?.[2]
  if (exp === undefined || signature === undefined) return false
  const expiry = Number(exp)
  const current = unixSeconds(now)
  if (expiry <= current || expiry > current + ADMIN_SESSION_TTL_SECONDS) return false
  try {
    return await crypto.subtle.verify(
      'HMAC',
      await importKey(secret),
      fromBase64Url(signature),
      encoder.encode(`${VERSION}.${exp}`),
    )
  } catch {
    return false
  }
}
