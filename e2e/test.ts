import { test as base, expect, type APIRequestContext, type BrowserContext } from '@playwright/test'
import { isProductionUrl } from './production'

// Every spec imports `test` from here (conventions §7; eslint forbids `test` from @playwright/test in e2e/*.spec.ts).
// On Production the suite may only read (M3 Task 17, Review Focus 9): outside Production nothing changes.

export const READ_ONLY_MESSAGE = 'E2E trên Production chỉ được đọc'

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])
const WRITE_HELPERS = ['post', 'put', 'patch', 'delete'] as const

// Aborts every browser request that is not GET / HEAD / OPTIONS before it leaves the browser. Returns the blocked
// requests ("POST https://host/path"), so the caller can fail the test even when the page swallowed the network error.
export const blockWrites = async (context: BrowserContext): Promise<string[]> => {
  const blocked: string[] = []
  await context.route('**/*', async (route) => {
    const request = route.request()
    if (READ_METHODS.has(request.method())) return route.fallback()
    const { origin, pathname } = new URL(request.url())
    blocked.push(`${request.method()} ${origin}${pathname}`)
    await route.abort('blockedbyclient')
  })
  return blocked
}

const refuseWrite = (): never => {
  throw new Error(READ_ONLY_MESSAGE)
}

// The `request` fixture with its writing helpers replaced, and `fetch` limited to the read methods.
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

export const test = base.extend({
  // `provide` is Playwright's `use`, renamed so the React hooks lint rule does not read it as React's use().
  context: async ({ context, baseURL }, provide) => {
    if (!isProductionUrl(baseURL)) return provide(context)
    const blocked = await blockWrites(context)
    await provide(context)
    if (blocked.length > 0) throw new Error(`${READ_ONLY_MESSAGE}: đã huỷ ${blocked.join(', ')}`)
  },
  request: async ({ request, baseURL }, provide) => {
    await provide(isProductionUrl(baseURL) ? readOnlyRequest(request) : request)
  },
})

export { expect }
