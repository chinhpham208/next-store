import 'server-only'

// ADR-0018 8A. Vercel overwrites X-Forwarded-For with the client's public address and does not forward one sent by
// the client (plan M5 D10), so on Vercel the first entry is the visitor. Under `next start` (local, CI) Next.js only
// fills the header when the request has none, so there a client may choose it: the limit means something on Vercel
// only (ADR-0018 Hệ quả).

// The longest textual IPv6 address (with an embedded IPv4) is 45 characters; anything longer is cut, not trusted.
const MAX_IP_LENGTH = 45
const UNKNOWN_IP = 'unknown'

export const readClientIp = (headers: Headers): string => {
  const first = headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? ''
  return first === '' ? UNKNOWN_IP : first.slice(0, MAX_IP_LENGTH)
}

// IPv4 in dotted decimal, no leading zeros (`07` could be read as octal: refused, not guessed).
const parseIpv4 = (text: string): number[] | undefined => {
  const parts = text.split('.')
  if (parts.length !== 4 || !parts.every((part) => /^(0|[1-9]\d{0,2})$/.test(part))) return undefined
  const bytes = parts.map(Number)
  return bytes.every((byte) => byte <= 255) ? bytes : undefined
}

const HEXTET = /^[0-9a-f]{1,4}$/
const hexGroups = (text: string): string[] => (text === '' ? [] : text.split(':'))

// The eight 16-bit groups of an IPv6 address in any RFC 4291 spelling: `::`, leading zeros or not, any case, a dotted
// IPv4 tail. No zone (`%eth0`) and no brackets: Vercel sends neither, anything else is left alone.
const parseIpv6 = (text: string): number[] | undefined => {
  let hex = text.toLowerCase()
  const lastColon = hex.lastIndexOf(':')
  if (lastColon === -1) return undefined
  if (hex.includes('.')) {
    const ipv4 = parseIpv4(hex.slice(lastColon + 1))
    if (ipv4 === undefined) return undefined
    const [a = 0, b = 0, c = 0, d = 0] = ipv4
    hex = `${hex.slice(0, lastColon + 1)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`
  }
  const halves = hex.split('::')
  if (halves.length > 2) return undefined
  const left = hexGroups(halves[0] ?? '')
  const right = hexGroups(halves[1] ?? '')
  const zeros = 8 - left.length - right.length
  if (halves.length === 1 ? zeros !== 0 : zeros < 1) return undefined
  const groups = [...left, ...Array<string>(zeros).fill('0'), ...right]
  return groups.every((group) => HEXTET.test(group)) ? groups.map((group) => parseInt(group, 16)) : undefined
}

const isIpv4Mapped = (groups: readonly number[]): boolean =>
  groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff

/**
 * What the failed-login limit counts by (NS-132, audit M5 M1): an IPv4 address as it is, an IPv6 address by its /64
 * (`2001:db8:abcd:12::/64`), whatever its spelling. A /64 is one network, often one machine, with 2^64 addresses: keyed
 * by the whole address, each of them had its own 5 tries. An IPv4-mapped IPv6 address (`::ffff:192.0.2.7`) is the
 * IPv4 address. Anything else ('unknown', a header that is not an address) is its own key, unchanged.
 */
export const clientLimitKey = (ip: string): string => {
  const ipv4 = parseIpv4(ip)
  if (ipv4 !== undefined) return ipv4.join('.')
  const groups = parseIpv6(ip)
  if (groups === undefined) return ip
  if (isIpv4Mapped(groups)) {
    const [high = 0, low = 0] = groups.slice(6)
    return [high >> 8, high & 0xff, low >> 8, low & 0xff].join('.')
  }
  return `${groups
    .slice(0, 4)
    .map((group) => group.toString(16))
    .join(':')}::/64`
}

const encoder = new TextEncoder()

const toHex = (bytes: ArrayBuffer): string =>
  Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('')

/**
 * HMAC-SHA256 (hex) of the address (in loginAction: its clientLimitKey), keyed with SESSION_SECRET: the table never holds a raw IP, and without the
 * secret a hash cannot be matched to an address by trying the whole IPv4 space. Neither value is ever logged.
 */
export const hashClientIp = async ({ ip, secret }: { ip: string; secret: string }): Promise<string> => {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ])
  return toHex(await crypto.subtle.sign('HMAC', key, encoder.encode(ip)))
}
