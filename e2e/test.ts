import {
  test as base,
  expect,
  type APIRequestContext,
  type BrowserContext,
  type BrowserContextOptions,
} from '@playwright/test'
import { type Bypass, bypassRequest, RUN_BYPASS, routeBypass } from './bypass'
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
//
// Outside Production the same fixtures carry the preview bypass header, only to the origin of BASE_URL (NS-54,
// e2e/bypass.ts). Order on a context: bypass first, guard second, so the guard's route runs first.

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

// A fresh context (no cookies, storage or history shared with `page`), with the run's baseURL and headers, the
// bypass of `vercelBypass` and, on Production, the same guard as `context`. Closed and checked at teardown.
export type NewContext = (options?: BrowserContextOptions) => Promise<BrowserContext>


// A trace records every request header, the bypass header included (audit PR #61 L1). playwright.config.ts turns
// tracing off when the bypass is on; a spec's test.use({ trace }) or `--trace` would turn it back on. The secret only
// ever enters a client through the fixtures below (`context`, `request`, `newContext`), so each of them refuses to add
// the bypass while tracing is on. Hooks get these same fixtures (audit 2 PR #61 L-B): a failing auto fixture does not
// stop afterEach / afterAll, and neither does a failing worker fixture, so the check sits where the secret is added.
// The auto fixture only fails a test body that uses no client early, with the same message.
export const TRACE_WITH_BYPASS_MESSAGE = 'Không bật trace khi có header bypass Vercel: trace ghi lại secret (NS-54)'

type TraceOption = string | { mode: string }

const assertNoTrace = (trace: TraceOption, bypass: Bypass | undefined) => {
  const mode = typeof trace === 'string' ? trace : trace.mode
  if (bypass && mode !== 'off') throw new Error(TRACE_WITH_BYPASS_MESSAGE)
}

type Fixtures = {
  newContext: NewContext
  // An option so e2e/vercel-bypass.spec.ts can point it at a local server; specs otherwise leave it alone.
  vercelBypass: Bypass | undefined
  bypassWithoutTrace: void
}

const withBypass = async (context: BrowserContext, bypass: Bypass | undefined, baseURL: string | undefined) => {
  if (bypass) await routeBypass(context, bypass, baseURL)
}

export const test = base.extend<Fixtures>({
  vercelBypass: [RUN_BYPASS, { option: true }],
  bypassWithoutTrace: [
    async ({ trace, vercelBypass }, provide) => {
      assertNoTrace(trace, vercelBypass)
      await provide()
    },
    { auto: true },
  ],
  // `provide` is Playwright's `use`, renamed so the React hooks lint rule does not read it as React's use().
  context: async ({ context, baseURL, trace, vercelBypass }, provide) => {
    assertNoTrace(trace, vercelBypass)
    await withBypass(context, vercelBypass, baseURL)
    await withWriteGuard(context, isProductionUrl(baseURL), provide)
    // A route.fetch still in flight when the context closes must not fail the test.
    await context.unrouteAll({ behavior: 'ignoreErrors' })
  },
  request: async ({ request, baseURL, trace, vercelBypass }, provide) => {
    assertNoTrace(trace, vercelBypass)
    const bypassed = vercelBypass ? bypassRequest(request, vercelBypass, baseURL) : request
    await provide(isProductionUrl(baseURL) ? readOnlyRequest(bypassed) : bypassed)
  },
  newContext: async ({ browser, baseURL, extraHTTPHeaders, trace, vercelBypass }, provide) => {
    assertNoTrace(trace, vercelBypass)
    const created: { context: BrowserContext; guard: WriteGuard | undefined; closed: boolean }[] = []
    await provide(async (options = {}) => {
      const resolved = { baseURL, extraHTTPHeaders, ...options }
      const context = await browser.newContext(resolved)
      await withBypass(context, vercelBypass, resolved.baseURL)
      const production = isProductionUrl(baseURL) || isProductionUrl(resolved.baseURL)
      const entry = { context, guard: production ? await guardContext(context) : undefined, closed: false }
      // A spec may close a context itself (US-07 closes the browser and opens it again); its guard is still checked.
      context.once('close', () => {
        entry.closed = true
      })
      created.push(entry)
      return context
    })
    for (const { context, closed } of created) {
      if (closed) continue
      await context.unrouteAll({ behavior: 'ignoreErrors' })
      await context.close()
    }
    for (const { guard } of created) guard?.assertNoWrites()
  },
})

export { expect }
