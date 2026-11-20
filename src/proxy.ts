import { NextResponse, type NextRequest } from 'next/server'
import { isKnownProductSlug, isProductSlug } from '@/features/products'

// Under Cache Components a page's notFound() runs after the 200 shell is sent (K3), so an unknown product slug is
// answered here, before render (ADR-0009). Rewriting to a path no route matches makes Next.js render
// app/not-found.tsx with a real 404; rewrite(<route>, { status: 404 }) keeps 200 (K5). A folder starting with `_`
// is private in the App Router, so this path can never become a route by accident.
const NOT_FOUND_PATH = '/_khong-tim-thay'

// The database client waits up to 10 s to connect. A product request must not hang that long on a slow or dead
// database, so past this bound the request goes through as if the slug were known (ADR-0009 lists the cost).
const LOOKUP_TIMEOUT_MS = 400

// Fixed text only: the error and its `cause` carry the SQL and the database host, and the slug is user input.
const LOOKUP_FAILED_MESSAGE = 'proxy: product slug lookup failed; letting the request through'
const LOOKUP_TIMED_OUT_MESSAGE = 'proxy: product slug lookup timed out; letting the request through'

const TIMED_OUT = Symbol('timed out')

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

export const proxy = async (request: NextRequest): Promise<NextResponse> => {
  // Not decoded: product URLs are canonical lower-case slugs, so `%2D`, upper case or anything else outside the
  // slug pattern is a 404 decided here without a query, which keeps working when the database is down.
  const slug = request.nextUrl.pathname.split('/').at(-1)
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

export const config = {
  matcher: '/products/:slug',
}
