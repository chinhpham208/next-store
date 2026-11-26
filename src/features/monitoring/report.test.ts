import { readFileSync } from 'node:fs'
import { describe, expect, expectTypeOf, it } from 'vitest'
import { formatErrorLogLine, isRecordable, toErrorReport } from '@/features/monitoring/report'

const BASE = { method: 'GET', routeType: 'render', routePath: '/app/products/[slug]' }
const DB_MESSAGE = 'database query failed: products.list (08006)'

describe('toErrorReport', () => {
  it('never reads request headers or path', async () => {
    // The signature is the first line of defence: there is no field to put them in (ADR-0022).
    expectTypeOf<Parameters<typeof toErrorReport>[0]>().toEqualTypeOf<{
      error: unknown
      method: string
      routeType: string
      routePath: string
    }>()
    const plain = await toErrorReport({ error: new TypeError('x'), ...BASE })
    // What Next.js hands to onRequestError carries both; handed over by mistake they change nothing.
    const request: unknown = {
      path: '/products/ao?ref=bi-mat',
      headers: { cookie: 'ns_cart=bi-mat', 'x-forwarded-for': '203.0.113.9' },
    }
    const input = { error: new TypeError('x'), ...BASE, ...Object(request) }
    const withExtras = await toErrorReport(input)
    expect(withExtras).toEqual(plain)
    expect(JSON.stringify(withExtras)).not.toMatch(/bi-mat|203\.0\.113|cookie/)
    // And the module does not name them at all.
    const source = readFileSync('src/features/monitoring/report.ts', 'utf8').replace(/\/\/.*$/gm, '')
    expect(source).not.toMatch(/headers|\.path\b|cookie/i)
  })

  it('stores a message only when it is a fixed dbQuery message', async () => {
    const fixed = [
      'database query failed: products.list',
      DB_MESSAGE,
      'database query failed: cart.add (ECONNREFUSED)',
      'database query timed out: orders.admin-list',
    ]
    for (const message of fixed) {
      expect((await toErrorReport({ error: new Error(message), ...BASE })).message).toBe(message)
    }
    const free = [
      'secret user@example.com',
      'database query failed: products.list; drop table products',
      'database query failed: Products.List',
      `${DB_MESSAGE}\nsecond line`,
      `prefix ${DB_MESSAGE}`,
      'database query failed: ' + 'a'.repeat(61),
      'database query failed: products.list (lower)',
      '',
    ]
    for (const message of free) {
      expect((await toErrorReport({ error: new Error(message), ...BASE })).message).toBeNull()
    }
    expect((await toErrorReport({ error: DB_MESSAGE, ...BASE })).message).toBeNull()
  })

  it('keeps the error name only when it is a plain identifier', async () => {
    class DatabaseError extends Error {
      override name = 'DatabaseError'
    }
    expect((await toErrorReport({ error: new TypeError('x'), ...BASE })).errorName).toBe('TypeError')
    expect((await toErrorReport({ error: new DatabaseError('x'), ...BASE })).errorName).toBe('DatabaseError')
    for (const name of ['Error 500', 'Err_or', 'Fehler\nGET /x', 'a'.repeat(41), '', '<script>', 'Édith']) {
      const error = Object.assign(new Error('x'), { name })
      expect((await toErrorReport({ error, ...BASE })).errorName).toBe('Error')
    }
    expect((await toErrorReport({ error: 'a string', ...BASE })).errorName).toBe('Error')
    expect((await toErrorReport({ error: { name: 'Plain' }, ...BASE })).errorName).toBe('Error')
    expect((await toErrorReport({ error: null, ...BASE })).errorName).toBe('Error')
  })

  it('the same error on the same route gives one fingerprint, whatever its digest', async () => {
    const a = await toErrorReport({ error: Object.assign(new Error('x'), { digest: '111' }), ...BASE })
    const b = await toErrorReport({ error: Object.assign(new Error('y'), { digest: '222' }), ...BASE })
    expect(a.fingerprint).toBe(b.fingerprint)
    expect(a.fingerprint).toMatch(/^[0-9a-f]{64}$/)
    expect([a.digest, b.digest]).toEqual(['111', '222'])
    const otherRoute = await toErrorReport({ error: new Error('x'), ...BASE, routePath: '/app/blog/[slug]' })
    const otherType = await toErrorReport({ error: new Error('x'), ...BASE, routeType: 'action' })
    const otherName = await toErrorReport({ error: new RangeError('x'), ...BASE })
    const otherMessage = await toErrorReport({ error: new Error(DB_MESSAGE), ...BASE })
    const fingerprints = new Set([a, otherRoute, otherType, otherName, otherMessage].map((report) => report.fingerprint))
    expect(fingerprints.size).toBe(5)
  })

  it('keeps a digest only when it is a short identifier', async () => {
    const digestOf = async (digest: unknown) => (await toErrorReport({ error: Object.assign(new Error('x'), { digest }), ...BASE })).digest
    expect(await digestOf('1234567890')).toBe('1234567890')
    expect(await digestOf('a-B_9'.repeat(12))).toBe('a-B_9'.repeat(12))
    expect(await digestOf('a'.repeat(65))).toBeNull()
    expect(await digestOf('has space')).toBeNull()
    expect(await digestOf('')).toBeNull()
    expect(await digestOf(12345)).toBeNull()
    expect((await toErrorReport({ error: new Error('x'), ...BASE })).digest).toBeNull()
  })

  it('normalises the method, the route type and the route path', async () => {
    const report = (input: Partial<typeof BASE>) => toErrorReport({ error: new Error('x'), ...BASE, ...input })
    expect((await report({ method: 'post' })).method).toBe('POST')
    expect((await report({ method: 'PROPFIND' })).method).toBe('OTHER')
    expect((await report({ method: 'GET /x' })).method).toBe('OTHER')
    expect((await report({ routeType: 'proxy' })).routeType).toBe('proxy')
    expect((await report({ routeType: 'nonsense' })).routeType).toBe('unknown')
    expect(isRecordable(await report({ routeType: 'nonsense' }))).toBe(false)
    expect(isRecordable(await report({ routeType: 'proxy' }))).toBe(false)
    for (const routeType of ['render', 'route', 'action']) expect(isRecordable(await report({ routeType }))).toBe(true)
    expect((await report({ routePath: `/${'a'.repeat(300)}` })).routePath).toHaveLength(200)
    // A query or a fragment never reaches the report, even if a caller passed one in the route path.
    expect((await report({ routePath: '/app/products/[slug]?ref=bi-mat#top' })).routePath).toBe('/app/products/[slug]')
    // 200 characters, not 200 UTF-16 units: a cut inside a surrogate pair would be refused by the database.
    const emoji = (await report({ routePath: `/${'😀'.repeat(300)}` })).routePath
    expect(Array.from(emoji)).toHaveLength(200)
    expect(emoji.endsWith('😀')).toBe(true)
  })
})

describe('formatErrorLogLine', () => {
  it('has no cookie, query or header', async () => {
    const report = await toErrorReport({
      error: Object.assign(new Error('secret ?ref=bi-mat'), { digest: '987' }),
      method: 'GET',
      routeType: 'render',
      routePath: '/app/products/[slug]?ref=bi-mat',
    })
    const line = formatErrorLogLine(report)
    expect(line).toBe(
      'monitoring: request error {"routeType":"render","routePath":"/app/products/[slug]","digest":"987","errorName":"Error"}',
    )
    expect(line).not.toMatch(/bi-mat|cookie|\?|header/i)
    expect(line).not.toContain('\n')
  })

  it('writes a null digest and keeps the field order', async () => {
    const line = formatErrorLogLine(await toErrorReport({ error: new RangeError('x'), ...BASE, routeType: 'proxy' }))
    expect(line).toBe(
      'monitoring: request error {"routeType":"proxy","routePath":"/app/products/[slug]","digest":null,"errorName":"RangeError"}',
    )
  })
})
