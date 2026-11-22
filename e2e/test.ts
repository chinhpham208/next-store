import {
  test as base,
  expect,
  type APIRequestContext,
  type BrowserContext,
  type BrowserContextOptions,
} from '@playwright/test'
import { isProductionUrl } from './production'

// Every spec imports `test` from here (conventions §7; eslint forbids `test` from @playwright/test in e2e/*.spec.ts,
// and a context of its own only through the `newContext` fixture). On Production the suite may only read (M3 Task 17,
// Review Focus 9); outside Production nothing changes.
//
// What the guard covers on Production, per path a request can take:
// - browser requests of a guarded context (pages, fetch, forms, sendBeacon): not GET / HEAD / OPTIONS → aborted;
// - a write that still leaves the browser (a spec's own page.route / context.route registered later runs first, and
//   its route.continue() goes straight to the network): not prevented, but recorded from the `request` event;
// - `request`, `context.request`, `page.request`: post / put / patch / delete, and fetch with a writing method, throw.
// Anything aborted or recorded fails the test at teardown with READ_ONLY_MESSAGE.

export const READ_ONLY_MESSAGE = 'E2E trên Production chỉ được đọc'

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])
const WRITE_HELPERS = ['post', 'put', 'patch', 'delete'] as const

const refuseWrite = (): never => {
  throw new Error(READ_ONLY_MESSAGE)
}

// An APIRequestContext with its writing helpers replaced, and `fetch` limited to the read methods.
export const readOnlyRequest = (request: APIRequestContext): APIRequestContext =>
  new Proxy(request, {
    get(target, property, receiver) {
      if (WRITE_HELPERS.some((helper) => helper === property)) return refuseWrite
      if (property === 'fetch') {
        const fetch: APIRequestContext['fetch'] = (urlOrRequest, options) => {
          const method = (options?.method ?? (typeof urlOrRequest === 'string' ? 'GET' : urlOrRequest.method())).toUpperCase()
          if (!READ_METHODS.has(method)) refuseWrite()
          return target.fetch(urlOrRequest, options)
        }
        return fetch
      }
      const value: unknown = Reflect.get(target, property, receiver)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })

export type WriteGuard = {
  // Writes seen so far, each once: "POST https://host/path".
  writes: () => string[]
  // Throws READ_ONLY_MESSAGE with the writes when there is any; the fixtures call it at teardown.
  assertNoWrites: () => void
}

// Installs the guard on a context. Must run before the context's first page: page.request is copied from
// context.request when the page is created.
export const guardContext = async (context: BrowserContext): Promise<WriteGuard> => {
  const writes = new Set<string>()
  const record = (method: string, url: string) => {
    const { origin, pathname } = new URL(url)
    writes.add(`${method} ${origin}${pathname}`)
  }
  context.on('request', (request) => {
    if (!READ_METHODS.has(request.method())) record(request.method(), request.url())
  })
  await context.route('**/*', async (route) => {
    const request = route.request()
    if (READ_METHODS.has(request.method())) return route.fallback()
    record(request.method(), request.url())
    await route.abort('blockedbyclient')
  })
  Object.defineProperty(context, 'request', { value: readOnlyRequest(context.request), configurable: true })
  return {
    writes: () => [...writes],
    assertNoWrites: () => {
      if (writes.size > 0) throw new Error(`${READ_ONLY_MESSAGE}: đã chặn hoặc ghi nhận ${[...writes].join(', ')}`)
    },
  }
}

// Runs `body` with the context guarded when `production`, then fails if anything wrote. The `context` fixture is
// this function; exported so the teardown failure itself is tested (e2e/production-guard.spec.ts).
export const withWriteGuard = async (
  context: BrowserContext,
  production: boolean,
  body: (context: BrowserContext) => Promise<void>,
): Promise<void> => {
  if (!production) return body(context)
  const guard = await guardContext(context)
  await body(context)
  guard.assertNoWrites()
}

// A fresh context (no cookies, storage or history shared with `page`), with the run's baseURL and headers (the
// preview bypass) and, on Production, the same guard as `context`. Closed and checked at teardown.
export type NewContext = (options?: BrowserContextOptions) => Promise<BrowserContext>

export const test = base.extend<{ newContext: NewContext }>({
  // `provide` is Playwright's `use`, renamed so the React hooks lint rule does not read it as React's use().
  context: async ({ context, baseURL }, provide) => {
    await withWriteGuard(context, isProductionUrl(baseURL), provide)
  },
  request: async ({ request, baseURL }, provide) => {
    await provide(isProductionUrl(baseURL) ? readOnlyRequest(request) : request)
  },
  newContext: async ({ browser, baseURL, extraHTTPHeaders }, provide) => {
    const created: { context: BrowserContext; guard: WriteGuard | undefined }[] = []
    await provide(async (options = {}) => {
      const resolved = { baseURL, extraHTTPHeaders, ...options }
      const context = await browser.newContext(resolved)
      const production = isProductionUrl(baseURL) || isProductionUrl(resolved.baseURL)
      created.push({ context, guard: production ? await guardContext(context) : undefined })
      return context
    })
    for (const { context } of created) await context.close()
    for (const { guard } of created) guard?.assertNoWrites()
  },
})

export { expect }
