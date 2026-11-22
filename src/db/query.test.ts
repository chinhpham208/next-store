import { inspect } from 'node:util'
import { afterEach, expect, it, vi } from 'vitest'
import { db } from '@/db/client'
import { dbQuery, resolveQueryTimeout } from '@/db/query'

// What Drizzle 0.45 throws for a driver failure: the SQL and params in the message and as properties, and the
// postgres-js error (with the host in its message and properties) as `cause`.
const drizzleError = () =>
  Object.assign(new Error('Failed query: select "slug" from "products" where "name" ilike $1\nparams: %bí mật%'), {
    query: 'select "slug" from "products"',
    params: ['%bí mật%'],
    cause: Object.assign(new Error('connect ECONNREFUSED 10.1.2.3:5432'), { code: 'ECONNREFUSED', address: '10.1.2.3' }),
  })

const rejectionOf = (promise: Promise<unknown>): Promise<unknown> =>
  promise.then(
    () => null,
    (reason: unknown) => reason,
  )

afterEach(() => {
  vi.useRealTimers()
})

it('returns what the query returns and passes the client in', async () => {
  await expect(dbQuery({ name: 'test.ok', run: async (client) => (client === db ? 7 : 0) })).resolves.toBe(7)
})

it('accepts a thenable such as a Drizzle query builder', async () => {
  const thenable: PromiseLike<string> = { then: (resolve) => Promise.resolve('row').then(resolve) }
  await expect(dbQuery({ name: 'test.thenable', run: () => thenable })).resolves.toBe('row')
})

it('never carries the SQL, the params, the host or a cause', async () => {
  const error = await rejectionOf(dbQuery({ name: 'test.fail', run: () => Promise.reject(drizzleError()) }))
  expect(error).toBeInstanceOf(Error)
  expect(error).toMatchObject({ message: 'database query failed: test.fail (ECONNREFUSED)', code: 'ECONNREFUSED' })
  expect(JSON.stringify(error, error instanceof Error ? Object.getOwnPropertyNames(error) : [])).not.toMatch(
    /select|bí mật|10\.1\.2\.3|params/,
  )
  expect(error).not.toHaveProperty('cause')
  expect(error).not.toHaveProperty('params')
  expect(error).not.toHaveProperty('query')
  // What Next prints: the inspected object with its own properties and any cause chain.
  const printed = inspect(error, { depth: 10, showHidden: true })
  expect(printed).not.toMatch(/Failed query|select|bí mật|10\.1\.2\.3/)
})

it('keeps a SQLSTATE from the driver error', async () => {
  const failing = () => Promise.reject(Object.assign(new Error('x'), { cause: Object.assign(new Error('y'), { code: '42703' }) }))
  await expect(dbQuery({ name: 'test.state', run: failing })).rejects.toMatchObject({
    message: 'database query failed: test.state (42703)',
    code: '42703',
  })
})

it('reads the code from the error itself when the cause has none', async () => {
  const failing = () => Promise.reject(Object.assign(new Error('x'), { code: 'ECONNRESET', cause: new Error('y') }))
  await expect(dbQuery({ name: 'test.own', run: failing })).rejects.toMatchObject({
    message: 'database query failed: test.own (ECONNRESET)',
    code: 'ECONNRESET',
  })
})

it.each([['host=10.1.2.3'], ['42p01'], ['E'], [`E${'X'.repeat(31)}`], [42703]])(
  'drops a code that is neither a SQLSTATE nor an errno (%j)',
  async (code) => {
    const failing = () => Promise.reject(Object.assign(new Error('x'), { code }))
    const error = await rejectionOf(dbQuery({ name: 'test.code', run: failing }))
    expect(error).toMatchObject({ message: 'database query failed: test.code' })
    expect(error).not.toHaveProperty('code')
  },
)

it('wraps a synchronous throw and a non-Error rejection', async () => {
  const throwing = () => {
    throw new Error('select 1')
  }
  await expect(dbQuery({ name: 'test.sync', run: throwing })).rejects.toThrow(/^database query failed: test\.sync$/)
  await expect(dbQuery({ name: 'test.string', run: () => Promise.reject('select 1') })).rejects.toThrow(
    /^database query failed: test\.string$/,
  )
})

it('rejects after the time limit', async () => {
  vi.useFakeTimers()
  const pending = dbQuery({ name: 'test.slow', run: () => new Promise(() => {}), timeoutMs: 1000 })
  const settled = expect(pending).rejects.toMatchObject({
    message: 'database query timed out: test.slow',
    code: 'DB_QUERY_TIMEOUT',
  })
  await vi.advanceTimersByTimeAsync(999)
  await vi.advanceTimersByTimeAsync(1)
  await settled
})

it('uses DB_QUERY_TIMEOUT_MS when no limit is passed', async () => {
  vi.useFakeTimers()
  vi.stubEnv('DB_QUERY_TIMEOUT_MS', '200')
  try {
    const pending = dbQuery({ name: 'test.env', run: () => new Promise(() => {}) })
    const settled = expect(pending).rejects.toMatchObject({ code: 'DB_QUERY_TIMEOUT' })
    await vi.advanceTimersByTimeAsync(200)
    await settled
  } finally {
    vi.unstubAllEnvs()
  }
})

it('clears its timer once the query settles', async () => {
  vi.useFakeTimers()
  await dbQuery({ name: 'test.fast', run: async () => 1, timeoutMs: 1000 })
  await rejectionOf(dbQuery({ name: 'test.fast-fail', run: () => Promise.reject(new Error('x')), timeoutMs: 1000 }))
  expect(vi.getTimerCount()).toBe(0)
})

it('does not report a late rejection as unhandled', async () => {
  const unhandled = vi.fn()
  process.on('unhandledRejection', unhandled)
  try {
    let rejectLate: (reason: unknown) => void = () => {}
    const late = new Promise<never>((_, reject) => {
      rejectLate = reject
    })
    await expect(dbQuery({ name: 'test.late', run: () => late, timeoutMs: 10 })).rejects.toMatchObject({
      code: 'DB_QUERY_TIMEOUT',
    })
    rejectLate(drizzleError())
    // unhandledRejection fires after the microtask queue drains; give it a macrotask turn.
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(unhandled).not.toHaveBeenCalled()
  } finally {
    process.off('unhandledRejection', unhandled)
  }
})

it.each([
  [undefined, 5000],
  ['', 5000],
  ['1000', 1000],
  ['100', 100],
  ['10000', 10000],
  ['99', 5000],
  ['10001', 5000],
  ['1e3', 5000],
  ['1000.5', 5000],
  [' 1000', 5000],
  ['0x3e8', 5000],
  ['abc', 5000],
])('resolveQueryTimeout(%j) is %i', (raw, expected) => {
  expect(resolveQueryTimeout(raw)).toBe(expected)
})

it('@/db does not export the raw client', async () => {
  const exported = Object.keys(await import('@/db'))
  expect(exported).not.toContain('db')
  expect(exported).toContain('dbQuery')
})
