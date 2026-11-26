import 'server-only'

// ADR-0018 8A. Vercel overwrites X-Forwarded-For with the client's public address and does not forward one sent by
// the client (plan M5 D10), so on Vercel the first entry is the visitor. Under `next start` (local, CI) Next.js only
// fills the header when the request has none, so there a client may choose it: the per-IP limit means something on
// Vercel only, the global one everywhere (ADR-0018 Hệ quả).

// The longest textual IPv6 address (with an embedded IPv4) is 45 characters; anything longer is cut, not trusted.
const MAX_IP_LENGTH = 45
const UNKNOWN_IP = 'unknown'

export const readClientIp = (headers: Headers): string => {
  const first = headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? ''
  return first === '' ? UNKNOWN_IP : first.slice(0, MAX_IP_LENGTH)
}

const encoder = new TextEncoder()

const toHex = (bytes: ArrayBuffer): string =>
  Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('')

/**
 * HMAC-SHA256 (hex) of the address, keyed with SESSION_SECRET: the table never holds a raw IP, and without the
 * secret a hash cannot be matched to an address by trying the whole IPv4 space. Neither value is ever logged.
 */
export const hashClientIp = async ({ ip, secret }: { ip: string; secret: string }): Promise<string> => {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ])
  return toHex(await crypto.subtle.sign('HMAC', key, encoder.encode(ip)))
}
