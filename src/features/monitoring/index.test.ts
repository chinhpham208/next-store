import { afterEach, describe, expect, it, vi } from 'vitest'
import { reportRequestError } from '@/features/monitoring'
import { recordErrorReport } from '@/features/monitoring/store'

// The store is what this file is not about: it is replaced, so no database is opened.
vi.mock('@/features/monitoring/store', () => ({
  recordErrorReport: vi.fn(async () => 'recorded'),
  recordHandledError: vi.fn(),
}))

afterEach(() => {
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

const input = (routeType: string) => ({
  error: Object.assign(new Error('x'), { digest: '42' }),
  method: 'GET',
  routeType,
  routePath: '/app/products/[slug]',
})

describe('reportRequestError', () => {
  it('logs only for routeType proxy', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    await reportRequestError(input('proxy'))
    expect(log.mock.calls).toEqual([
      ['monitoring: request error {"routeType":"proxy","routePath":"/app/products/[slug]","digest":"42","errorName":"Error"}'],
    ])
    expect(recordErrorReport).not.toHaveBeenCalled()
  })

  it.each(['render', 'route', 'action'])('logs and records for routeType %s', async (routeType) => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    await reportRequestError(input(routeType))
    expect(log).toHaveBeenCalledTimes(1)
    expect(String(log.mock.calls[0]?.[0])).toContain(`"routeType":"${routeType}"`)
    expect(recordErrorReport).toHaveBeenCalledTimes(1)
    expect(vi.mocked(recordErrorReport).mock.calls[0]?.[0].report).toMatchObject({
      routeType,
      routePath: '/app/products/[slug]',
      digest: '42',
    })
  })
})
