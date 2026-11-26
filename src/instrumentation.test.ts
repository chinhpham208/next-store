import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { onRequestError } from '@/instrumentation'

// The writing half is replaced: this file is about what onRequestError hands to it, and when it loads it.
const reporting = vi.hoisted(() => ({ reportRequestError: vi.fn<(input: unknown) => Promise<void>>() }))
vi.mock('@/features/monitoring', () => ({ reportRequestError: reporting.reportRequestError }))

const REQUEST = {
  path: '/products/ao?ref=bi-mat',
  method: 'GET',
  headers: { cookie: 'ns_cart=bi-mat; __Host-ns_admin=bi-mat', 'x-forwarded-for': '203.0.113.9' },
}
const CONTEXT = {
  routerKind: 'App Router',
  routePath: '/app/products/[slug]',
  routeType: 'render',
  renderSource: 'react-server-components',
  revalidateReason: undefined,
  renderType: 'dynamic',
} as const

beforeEach(() => {
  vi.stubEnv('NEXT_RUNTIME', 'nodejs')
  reporting.reportRequestError.mockResolvedValue(undefined)
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

describe('onRequestError', () => {
  it('passes on the error, the method, the route type and the route path, and nothing of the request', async () => {
    const error = new Error('x')
    await onRequestError(error, REQUEST, CONTEXT)
    expect(reporting.reportRequestError).toHaveBeenCalledExactlyOnceWith({
      error,
      method: 'GET',
      routeType: 'render',
      routePath: '/app/products/[slug]',
    })
    expect(JSON.stringify(reporting.reportRequestError.mock.calls)).not.toMatch(/bi-mat|cookie|203\.0\.113/)
  })

  it('only logs a fixed line for the proxy, and does not load the writing half', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    await onRequestError(Object.assign(new Error('x'), { digest: '7' }), REQUEST, { ...CONTEXT, routeType: 'proxy' })
    expect(reporting.reportRequestError).not.toHaveBeenCalled()
    expect(log.mock.calls).toEqual([
      ['monitoring: request error {"routeType":"proxy","routePath":"/app/products/[slug]","digest":"7","errorName":"Error"}'],
    ])
  })

  it('only logs on the edge runtime', async () => {
    vi.stubEnv('NEXT_RUNTIME', 'edge')
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    await onRequestError(new Error('x'), REQUEST, CONTEXT)
    expect(reporting.reportRequestError).not.toHaveBeenCalled()
    expect(log).toHaveBeenCalledTimes(1)
    expect(String(log.mock.calls[0]?.[0])).not.toMatch(/bi-mat|\?/)
  })

  it('does not throw when reporting fails, so the failure is not reported in turn', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    reporting.reportRequestError.mockRejectedValue(new Error('boom bi-mat'))
    await expect(onRequestError(new Error('x'), REQUEST, CONTEXT)).resolves.toBeUndefined()
    expect(log.mock.calls).toEqual([['monitoring: reporting failed']])
  })

  it('imports the pure report statically and the writing half only with import()', () => {
    const source = readFileSync('src/instrumentation.ts', 'utf8')
    const staticImports = [...source.matchAll(/^import (?:type )?[^\n]* from '([^']+)'/gm)].map((match) => match[1])
    expect(staticImports).toEqual(['next', '@/features/monitoring/report'])
    expect(source).toMatch(/await import\('@\/features\/monitoring'\)/)
  })
})
