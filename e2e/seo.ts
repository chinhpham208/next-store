import type { APIRequestContext, APIResponse } from '@playwright/test'

// Helpers for the US-11 spec (M3 Task 15). They read the raw HTML / XML the server sends, which is what a crawler or
// a link preview sees ("khi đọc HTML"), not the DOM after hydration.

// The named and numeric references React and Next.js emit in attribute values and XML text.
const NAMED_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }

export const decodeEntities = (text: string): string =>
  text.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (entity, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10)
      return String.fromCodePoint(code)
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? entity
  })

const attribute = (tag: string, name: string): string | undefined => {
  const match = new RegExp(`\\s${name}="([^"]*)"`, 'i').exec(tag)
  return match ? decodeEntities(match[1]!) : undefined
}

/**
 * Every `<meta property|name=… content=…>` of the page, keyed by the property or name (`og:image`, `description`,
 * `twitter:card`, `robots`), plus `title` from `<title>`. The first tag wins: Next.js writes each key once, and a
 * second one further down would not be what a crawler reads first.
 */
export const readMeta = (html: string): Record<string, string> => {
  const meta: Record<string, string> = {}
  for (const [tag] of html.matchAll(/<meta\s[^>]*>/gi)) {
    const key = attribute(tag, 'property') ?? attribute(tag, 'name')
    const content = attribute(tag, 'content')
    if (key !== undefined && content !== undefined && !(key in meta)) meta[key] = content
  }
  const title = /<title>([^<]*)<\/title>/i.exec(html)
  if (title && !('title' in meta)) meta.title = decodeEntities(title[1]!)
  return meta
}

/**
 * Loads the image an og:image tag names, on the run's baseURL: the tag's host is the build's site URL
 * (http://localhost:3000 for a local `next start`, the branch URL on a preview), which may not be the server under
 * test. Only the path and the query (the content hash Next.js adds) are kept.
 */
export const fetchImage = (request: APIRequestContext, ogImageUrl: string): Promise<APIResponse> => {
  const { pathname, search } = new URL(ogImageUrl)
  return request.get(`${pathname}${search}`)
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/** Width and height from the IHDR chunk, which the PNG format puts first, right after the 8-byte signature. */
export const pngSize = (buffer: Buffer): { width: number; height: number } => {
  if (buffer.length < 24 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) throw new Error('Không phải file PNG')
  if (buffer.subarray(12, 16).toString('latin1') !== 'IHDR') throw new Error('PNG không mở đầu bằng chunk IHDR')
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }
}

export type SitemapEntry = { loc: string; lastmod: string | undefined }

/** The `<url>` entries of a sitemap, in document order. */
export const readSitemap = (xml: string): SitemapEntry[] =>
  [...xml.matchAll(/<url>([\s\S]*?)<\/url>/g)].map(([, body]) => ({
    loc: decodeEntities(/<loc>([^<]*)<\/loc>/.exec(body!)?.[1]?.trim() ?? ''),
    lastmod: /<lastmod>([^<]*)<\/lastmod>/.exec(body!)?.[1]?.trim(),
  }))
