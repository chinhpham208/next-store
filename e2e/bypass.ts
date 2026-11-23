import type { APIRequestContext, APIResponse, BrowserContext, Request } from '@playwright/test'
import { isProductionUrl } from './production'

// NS-54: the Vercel Deployment Protection bypass secret goes only to the exact origin of BASE_URL. Playwright's
// extraHTTPHeaders sent it with every request, to any origin, and carried it along every redirect.
//
// - Browser requests: a context route matches the origin and sends the request itself (route.fetch) with the header
//   and maxRedirects: 0, then hands the response to the browser. The browser follows a redirect on its own, and a
//   redirect hop is never routed again, so it never carries the header, not even back to the same origin.
// - `request`, `context.request`, `page.request`: wrapped so each hop is sent with maxRedirects: 0, the header added
//   only when that hop's origin is the bypass origin, and the redirects followed here.
// A spec's own route registered later runs first; if it calls route.continue() for this origin, the request leaves
// without the header (route.fallback() keeps it).

export const BYPASS_HEADER = 'x-vercel-protection-bypass'

export type Bypass = { origin: string; secret: string }

// Same rules as scripts/smoke.sh: a secret, an https BASE_URL, and never Production (it has no Deployment
// Protection, M3 Task 17).
export const bypassFor = (baseUrl: string | undefined, secret: string | undefined): Bypass | undefined => {
  if (!baseUrl || !secret || isProductionUrl(baseUrl)) return undefined
  try {
    const url = new URL(baseUrl)
    return url.protocol === 'https:' ? { origin: url.origin, secret } : undefined
  } catch {
    return undefined
  }
}

type FetchOptions = NonNullable<Parameters<APIRequestContext['fetch']>[1]>

const HELPER_METHODS = { get: 'GET', head: 'HEAD', post: 'POST', put: 'PUT', patch: 'PATCH', delete: 'DELETE' } as const
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])
// Playwright's default for APIRequestContext.
const DEFAULT_MAX_REDIRECTS = 20

const isHelper = (property: string | symbol): property is keyof typeof HELPER_METHODS =>
  typeof property === 'string' && Object.hasOwn(HELPER_METHODS, property)

// What the next hop sends, as a browser (and Playwright) would: 303, and 301 / 302 after POST, become a body-less
// GET. `params` are already in the Location.
const nextHopOptions = (options: FetchOptions, status: number): FetchOptions => {
  const method = (options.method ?? 'GET').toUpperCase()
  const toGet = (status === 303 && method !== 'HEAD') || ((status === 301 || status === 302) && method === 'POST')
  const next = { ...options, params: undefined }
  return toGet ? { ...next, method: 'GET', data: undefined, form: undefined, multipart: undefined } : next
}

const fromRequest = (request: Request, options: FetchOptions = {}): [string, FetchOptions] => [
  request.url(),
  { method: request.method(), headers: request.headers(), data: request.postDataBuffer() ?? undefined, ...options },
]

// An APIRequestContext that adds the bypass header to the hops whose origin is the bypass origin, and to no other.
export const bypassRequest = (request: APIRequestContext, bypass: Bypass, baseURL?: string): APIRequestContext => {
  const originOf = (url: string) => {
    try {
      return new URL(url, baseURL).origin
    } catch {
      return undefined
    }
  }

  const send = async (url: string, options: FetchOptions = {}): Promise<APIResponse> => {
    if (originOf(url) !== bypass.origin) return request.fetch(url, options)
    const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS
    let hopUrl = url
    let hopOptions = options
    for (let redirects = 0; ; redirects++) {
      const headers = originOf(hopUrl) === bypass.origin ? { ...hopOptions.headers, [BYPASS_HEADER]: bypass.secret } : hopOptions.headers
      const response = await request.fetch(hopUrl, { ...hopOptions, headers, maxRedirects: 0 })
      const location = response.headers()['location']
      if (maxRedirects === 0 || !REDIRECT_STATUSES.has(response.status()) || location === undefined) return response
      if (redirects >= maxRedirects) throw new Error(`Max redirect count exceeded: ${url}`)
      hopUrl = new URL(location, response.url()).toString()
      hopOptions = nextHopOptions(hopOptions, response.status())
      await response.dispose()
    }
  }

  return new Proxy(request, {
    get(target, property, receiver) {
      if (isHelper(property)) {
        const method = HELPER_METHODS[property]
        return (url: string, options?: FetchOptions) => send(url, { ...options, method })
      }
      if (property === 'fetch') {
        const fetch: APIRequestContext['fetch'] = (urlOrRequest, options) =>
          typeof urlOrRequest === 'string' ? send(urlOrRequest, options) : send(...fromRequest(urlOrRequest, options))
        return fetch
      }
      const value: unknown = Reflect.get(target, property, receiver)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
}

// Installs the bypass on a context: its browser requests and context.request (page.request is copied from it when a
// page is created, so this must run before the first page). Install before guardContext of e2e/test.ts: the route
// registered last runs first, so the write guard sees every request and only the reads it lets through get here.
export const routeBypass = async (context: BrowserContext, bypass: Bypass, baseURL?: string): Promise<void> => {
  await context.route(
    (url) => url.origin === bypass.origin,
    async (route) => {
      const request = route.request()
      let response: APIResponse
      try {
        response = await route.fetch({ headers: { ...request.headers(), [BYPASS_HEADER]: bypass.secret }, maxRedirects: 0 })
      } catch {
        // No answer (network error, or the context closed): the page sees a failed request, as without the route.
        return route.abort('failed').catch(() => undefined)
      }
      // A request the page has already cancelled can no longer be fulfilled; nothing waits for it.
      await route.fulfill({ response }).catch(() => undefined)
    },
  )
  Object.defineProperty(context, 'request', { value: bypassRequest(context.request, bypass, baseURL), configurable: true })
}
