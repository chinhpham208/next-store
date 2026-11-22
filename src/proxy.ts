import { NextResponse, type NextRequest } from 'next/server'
import { isPostSlug } from '@/features/blog/proxy-api'
import { isKnownProductSlug, isProductSlug } from '@/features/products/proxy-api'

// Under Cache Components a page's notFound() runs after the 200 shell is sent (K3), so an unknown product or blog
// slug is answered here, before render (ADR-0009, ADR-0012). So is the Open Graph image of an unknown slug, which
// would otherwise answer a 200 image and leave a new cache entry (K10). Rewriting to a path no route matches makes
// Next.js render app/not-found.tsx with a real 404; rewrite(<route>, { status: 404 }) keeps 200 (K5). A folder
// starting with `_` is private in the App Router, so this path can never become a route by accident.
const NOT_FOUND_PATH = '/_khong-tim-thay'

// The database client waits up to 10 s to connect. A product request must not hang that long on a slow or dead
// database, so past this bound the request goes through as if the slug were known (ADR-0009 lists the cost).
const LOOKUP_TIMEOUT_MS = 400

// Fixed text only: the error and its `cause` carry the SQL and the database host, and the slug is user input.
const LOOKUP_FAILED_MESSAGE = 'proxy: product slug lookup failed; letting the request through'
const LOOKUP_TIMED_OUT_MESSAGE = 'proxy: product slug lookup timed out; letting the request through'

const TIMED_OUT = Symbol('timed out')

// The matcher also runs the proxy for the App Router transport forms of a page URL (Next.js 16.4.6,
// build/analysis/get-page-static-info.js): `<path>.rsc` and `<path>.segments/<segment path>.segment.rsc`. Measured
// pathnames reaching the proxy: `next start` strips only the final `.rsc` (so `….segments/_tree.segment`), Vercel
// strips nothing (audit PR #26 M1). Both forms are removed here; without that a known product's segment prefetch
// got a 404. An image route inside a route group carries a hash suffix (`opengraph-image-16g1u1`, K10).
// Anything else after the slug fails the pattern → 404. Group 1 is the section, group 2 the slug (not decoded).
const SLUG_PATH =
  /^\/(products|blog)\/([^/]+?)(?:\/opengraph-image(?:-[a-z0-9]+)?)?(?:\.segments\/.+\.segment)?(?:\.rsc)?$/

const lookupWithin = async (slug: string) => {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<typeof TIMED_OUT>((resolve) => {
    timer = setTimeout(() => resolve(TIMED_OUT), LOOKUP_TIMEOUT_MS)
  })
  try {
    // race() keeps a handler on the lookup, so a rejection that arrives after the timeout is not unhandled.
    return await Promise.race([isKnownProductSlug(slug), timeout])
  } finally {
    clearTimeout(timer)
  }
}

const notFound = (request: NextRequest) => NextResponse.rewrite(new URL(NOT_FOUND_PATH, request.url))

// Products: the slug shape is checked first, then the database within LOOKUP_TIMEOUT_MS, failing open (ADR-0009).
const answerProduct = async (request: NextRequest, slug: string | undefined): Promise<NextResponse> => {
  // Not decoded: product URLs are canonical lower-case slugs, so `%2D`, upper case or anything else outside the
  // slug pattern is a 404 decided here without a query, which keeps working when the database is down.
  if (!isProductSlug(slug)) return notFound(request)

  try {
    const result = await lookupWithin(slug)
    if (result === TIMED_OUT) {
      console.error(LOOKUP_TIMED_OUT_MESSAGE)
      return NextResponse.next()
    }
    return result ? NextResponse.next() : notFound(request)
  } catch {
    // Fail open: a prerendered product page still serves, an unknown one shows the error page (K8).
    console.error(LOOKUP_FAILED_MESSAGE)
    return NextResponse.next()
  }
}

export const proxy = async (request: NextRequest): Promise<NextResponse> => {
  const [, section, slug] = SLUG_PATH.exec(request.nextUrl.pathname) ?? []
  if (section === 'products') return answerProduct(request, slug)
  // Blog: posts only change with a deploy, so the static registry is the whole truth (ADR-0012). No query, no
  // timer, no log: the answer is the same with the database down. Not decoded, like products.
  if (section === 'blog' && isPostSlug(slug)) return NextResponse.next()
  return notFound(request)
}

// Constant, so Next.js can analyse it at build time. `:image` is the Open Graph image route of the page (K10); a
// second segment that is not one fails SLUG_PATH → 404, which is what Next.js would answer for it anyway.
export const config = {
  matcher: ['/products/:slug', '/products/:slug/:image', '/blog/:slug', '/blog/:slug/:image'],
}
