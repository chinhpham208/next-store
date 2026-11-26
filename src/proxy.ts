import { NextResponse, type NextRequest } from 'next/server'
import { freshAdminCsp, hasValidAdminCookie, isAdminLoginPath, isGuardedAdminPath } from '@/features/admin/proxy-api'
import { isPostSlug } from '@/features/blog/proxy-api'
import { isCatalogSlug, isProductSlug } from '@/features/products/proxy-api'

// Under Cache Components a page's notFound() runs after the 200 shell is sent (K3), so an unknown product or blog
// slug is answered here, before render (ADR-0009, ADR-0012). So is the Open Graph image of an unknown slug, which
// would otherwise answer a 200 image and leave a new cache entry (K10). Rewriting to a path no route matches makes
// Next.js render app/not-found.tsx with a real 404; rewrite(<route>, { status: 404 }) keeps 200 (K5). A folder
// starting with `_` is private in the App Router, so this path can never become a route by accident.
const NOT_FOUND_PATH = '/_khong-tim-thay'

// The matcher also runs the proxy for the App Router transport forms of a page URL (Next.js 16.4.6,
// build/analysis/get-page-static-info.js): `<path>.rsc` and `<path>.segments/<segment path>.segment.rsc`. Measured
// pathnames reaching the proxy: `next start` strips only the final `.rsc` (so `….segments/_tree.segment`), Vercel
// strips nothing (audit PR #26 M1). Both forms are removed here; without that a known product's segment prefetch
// got a 404. An image route inside a route group carries a hash suffix (`opengraph-image-16g1u1`, K10).
// Anything else after the slug fails the pattern → 404. Group 1 is the section, group 2 the slug (not decoded).
const SLUG_PATH =
  /^\/(products|blog)\/([^/]+?)(?:\/opengraph-image(?:-[a-z0-9]+)?)?(?:\.segments\/.+\.segment)?(?:\.rsc)?$/

const notFound = (request: NextRequest) => NextResponse.rewrite(new URL(NOT_FOUND_PATH, request.url))

// Products: the slug shape, then the static registry (ADR-0017, NS-79). On Vercel the proxy runs at the edge nearest
// the visitor, far from the database in sin1, so it never asks the database (dependency-cruiser `proxy-no-db`): the
// answer is the same in every region and with the database down. Not decoded: product URLs are canonical lower-case
// slugs, so `%2D`, upper case or anything else outside the slug pattern is a 404.
const answerProduct = (request: NextRequest, slug: string | undefined): NextResponse => {
  if (!isProductSlug(slug)) return notFound(request)
  return isCatalogSlug(slug) ? NextResponse.next() : notFound(request)
}

// A Server Action is a POST to the page that renders it and the matcher cannot filter by method, so under the database
// lookup of ADR-0009 every action on /products/<slug> waited for it (measured on `next start`, M4 C3, NS-92). Next.js
// 16.4.6 knows a fetch action by this header on a POST (client/components/app-router-headers.js ACTION_HEADER, read in
// server/lib/server-action-request-meta.js) and answers it before render; the action checks the product itself.
// Any other request is rendered like a GET, whatever its method, so it gets the same slug check: passing every
// non-GET through let PUT, DELETE or a plain POST leave a 200 and a new route cache entry for any path (NS-103).
// Headers.has ignores case, like Next.js's own read. A form posted before hydration (no header) would also be an
// action to Next.js; no form here posts without JavaScript (ADR-0014).
const ACTION_HEADER = 'next-action'
const isServerAction = (request: NextRequest) => request.method === 'POST' && request.headers.has(ACTION_HEADER)

// US-12 (ADR-0018, plan M5 Task 8): an optimistic check of the session cookie alone, no database (D2, `proxy-no-db`);
// every admin page, admin read and admin action checks again itself (the layout cannot: audit PR #106 H1). Action ids
// are global and /admin/login lets everything through, so an admin action posted there is not stopped here: it
// must refuse without a session on its own (ADR-0018 7A, audit PR #106 L1). The proxy is the source of the real 307:
// a redirect() in a streamed page is only a meta tag (D5). Both cookie names are cleared when the request carries
// them, so a junk or stale cookie of either scheme does not stay behind (audit PR #104 note). __Host- needs Secure and
// Path=/ on the deleting Set-Cookie too. Not logged.
const LOGIN_PATH = '/admin/login'
const ADMIN_COOKIES = [
  { name: '__Host-ns_admin', secure: true },
  { name: 'ns_admin', secure: false },
] as const

const clearAdminCookies = (request: NextRequest, response: NextResponse): NextResponse => {
  for (const { name, secure } of ADMIN_COOKIES) {
    if (!request.cookies.has(name)) continue
    response.cookies.set({ name, value: '', path: '/', maxAge: 0, httpOnly: true, sameSite: 'strict', secure })
  }
  return response
}

// No next / returnTo parameter: nothing to turn into an open redirect.
const redirectToLogin = (request: NextRequest): NextResponse =>
  clearAdminCookies(request, NextResponse.redirect(new URL(LOGIN_PATH, request.url), 307))

// ADR-0020: every admin request let through carries a strict policy with a fresh nonce, on the request (Next.js reads
// the nonce from the request's Content-Security-Policy and puts it on its scripts, D3) and on the response (the
// browser enforces it). Set, never appended: a CSP request header sent by the client is replaced, so it cannot choose
// the nonce. Shop pages never get it, so they stay prerendered; the 307 and the 401 carry no page and keep the
// baseline of next.config.ts.
const passAdmin = (request: NextRequest): NextResponse => {
  const policy = freshAdminCsp()
  const headers = new Headers(request.headers)
  headers.set('content-security-policy', policy)
  const response = NextResponse.next({ request: { headers } })
  response.headers.set('content-security-policy', policy)
  return response
}

const answerAdmin = async (request: NextRequest): Promise<NextResponse> => {
  // Canonical spelling only: `/Admin/login` or `/%61dmin/login` is guarded like any other admin page.
  if (isAdminLoginPath(request.nextUrl.pathname)) return passAdmin(request)
  if (await hasValidAdminCookie(request)) return passAdmin(request)
  if (request.method === 'GET' || request.method === 'HEAD') return redirectToLogin(request)
  // A Server Action (POST + next-action) or any other method: no redirect for a fetch to follow, an empty 401. It
  // clears a junk or stale cookie like the 307 (audit PR #106 L2): the client sends a refused tab to /admin/login
  // (LogoutButton; the edit form of Task 10), and that GET then carries no broken cookie.
  return clearAdminCookies(request, new NextResponse(null, { status: 401 }))
}

// Fixed order (plan M5 Global Constraints): (1) admin, (2) the Server Action shortcut, (3) product and blog slugs.
// The admin branch comes first, or a POST with `next-action` to /admin/* would skip it. Everything else stays
// synchronous: only the admin branch waits, on Web Crypto.
export const proxy = (request: NextRequest): NextResponse | Promise<NextResponse> => {
  // Also the spellings a decoding or case-folding router would read as admin (audit PR #104 L4).
  if (isGuardedAdminPath(request.nextUrl.pathname)) return answerAdmin(request)
  if (isServerAction(request)) return NextResponse.next()
  const [, section, slug] = SLUG_PATH.exec(request.nextUrl.pathname) ?? []
  if (section === 'products') return answerProduct(request, slug)
  // Blog: posts only change with a deploy, so the static registry is the whole truth (ADR-0012), as for products.
  // Not decoded, like products.
  if (section === 'blog' && isPostSlug(slug)) return NextResponse.next()
  return notFound(request)
}

// Constant, so Next.js can analyse it at build time. `:image` is the Open Graph image route of the page (K10); a
// second segment that is not one fails SLUG_PATH → 404, which is what Next.js would answer for it anyway. `/admin`
// and everything under it, with their transport forms (Next.js adds those to every matcher), for the admin guard.
export const config = {
  matcher: ['/admin', '/admin/:path*', '/products/:slug', '/products/:slug/:image', '/blog/:slug', '/blog/:slug/:image'],
}
