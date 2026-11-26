import { eq } from 'drizzle-orm'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { cartItems, carts, orders, products } from '@/db'
import { db } from '@/db/client'
import { runMigrations } from '@/db/migrate'
import { seed } from '@/db/seed'
import { PRODUCT_SEEDS } from '@/db/seed-data'
import { FAKE_SIGNATURE_HEADER, signFakeEvent } from '@/features/checkout/signature'
import { handlePaymentWebhook } from '@/features/checkout/webhook'
import { recordHandledError } from '@/features/monitoring'
import { attachPaymentRef, createPendingOrder } from '@/features/orders'

// The webhook end to end on PGlite: signature, the apply of the event, the cache tags. next/cache and the recording
// of a handled error are replaced; dbQuery is the real one, wrapped so a test can see whether it was asked at all and
// make it fail.
const driver = vi.hoisted(() => ({ failure: undefined as Error | undefined, calls: 0 }))
vi.mock('@/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/db')>()
  const dbQuery: typeof actual.dbQuery = (input) => {
    driver.calls += 1
    if (driver.failure !== undefined) return Promise.reject(driver.failure)
    return actual.dbQuery(input)
  }
  return { ...actual, dbQuery }
})
vi.mock('next/cache', () => ({ revalidateTag: vi.fn() }))
vi.mock('@/features/monitoring', () => ({ recordHandledError: vi.fn(async () => undefined) }))
const { revalidateTag } = await import('next/cache')

// Fake values, test only.
const SECRET = 'test-fake-payment-secret-0123456789ab'
const NOW = new Date('2026-11-26T10:00:00.000Z')
const CART = '4f0c1c4e-2f43-4a0e-8d52-5d6a3b8a9c11'
const REF = 'fake_5b0f1a9e-3c1d-4d5e-8f20-6a7b8c9d0e1f'
const SHIRT = 'ao-git-push-force'
const MUG = 'ao-404-not-found'
const URL = 'https://shop.test/api/webhooks/payment'

const stubConfig = () => {
  vi.stubEnv('FAKE_PAYMENT_SECRET', SECRET)
  vi.stubEnv('SESSION_SECRET', 'a-different-session-secret-0123456789')
  vi.stubEnv('PAYMENT_PROVIDER', 'fake')
}

const productOf = async (slug: string) => {
  const [row] = await db.select().from(products).where(eq(products.slug, slug))
  if (row === undefined) throw new Error(`no product ${slug}`)
  return row
}

// A pending order for one cart with the given lines, with a payment ref attached.
const orderOf = async (slugs: string[]) => {
  await db.insert(carts).values({ id: CART, createdAt: NOW, updatedAt: NOW })
  let offset = 0
  for (const slug of slugs) {
    const product = await productOf(slug)
    await db
      .insert(cartItems)
      .values({ cartId: CART, productId: product.id, quantity: 1, createdAt: new Date(NOW.getTime() + offset++) })
  }
  const created = await createPendingOrder({
    cartId: CART,
    liveSince: new Date(NOW.getTime() - 86_400_000),
    provider: 'fake',
    now: NOW,
  })
  if (!created.ok) throw new Error(`could not create the order: ${created.error}`)
  await attachPaymentRef({ orderId: created.orderId, paymentRef: REF, now: NOW })
  return created
}

const signedRequest = async (body: string, now: Date = new Date()) =>
  new Request(URL, {
    method: 'POST',
    body,
    headers: { [FAKE_SIGNATURE_HEADER]: await signFakeEvent({ secret: SECRET, body, now }) },
  })

const paidBody = (orderId: number, amount: number, ref: string = REF) =>
  JSON.stringify({ type: 'paid', paymentRef: ref, orderCode: orderId, amount })

const send = async (body: string) => handlePaymentWebhook(await signedRequest(body))

// A header of the right shape and a fresh time, with a MAC that is not the body's.
const forgedHeader = () => `t=${Math.floor(Date.now() / 1000)},v1=${'A'.repeat(43)}`

const json = async (response: Response) => (await response.json()) as unknown

const revalidated = () => vi.mocked(revalidateTag).mock.calls.map(([tag]) => tag)

beforeAll(async () => {
  await runMigrations()
})

beforeEach(async () => {
  vi.unstubAllEnvs()
  stubConfig()
  driver.failure = undefined
  driver.calls = 0
  vi.mocked(revalidateTag).mockClear()
  vi.mocked(recordHandledError).mockClear()
  await db.delete(orders)
  await db.delete(carts)
  await seed()
  for (const seeded of PRODUCT_SEEDS) {
    await db.update(products).set({ price: seeded.price, stock: 10, name: seeded.name }).where(eq(products.slug, seeded.slug))
  }
})

describe('handlePaymentWebhook', () => {
  it('answers 503 when payments are not configured', async () => {
    vi.stubEnv('FAKE_PAYMENT_SECRET', '')
    const response = await handlePaymentWebhook(new Request(URL, { method: 'POST', body: '{}' }))
    expect(response.status).toBe(503)
    expect(await json(response)).toEqual({ error: 'not-configured' })
    expect(driver.calls).toBe(0)
  })

  it('answers 413 past 8 KB and 400 when unsigned, badly signed, expired or malformed', async () => {
    const big = await handlePaymentWebhook(
      new Request(URL, { method: 'POST', body: 'x'.repeat(8193), headers: { [FAKE_SIGNATURE_HEADER]: 'junk' } }),
    )
    expect(big.status).toBe(413)
    expect(await json(big)).toEqual({ error: 'too-large' })

    const unsigned = await handlePaymentWebhook(new Request(URL, { method: 'POST', body: '{}' }))
    expect(unsigned.status).toBe(400)
    expect(await json(unsigned)).toEqual({ error: 'unsigned' })

    const wrong = await handlePaymentWebhook(
      new Request(URL, { method: 'POST', body: '{}', headers: { [FAKE_SIGNATURE_HEADER]: forgedHeader() } }),
    )
    expect(wrong.status).toBe(400)
    expect(await json(wrong)).toEqual({ error: 'bad-signature' })

    const old = await handlePaymentWebhook(await signedRequest('{}', new Date(Date.now() - 10 * 60_000)))
    expect(old.status).toBe(400)
    expect(await json(old)).toEqual({ error: 'expired' })

    const malformed = await handlePaymentWebhook(await signedRequest('not json'))
    expect(malformed.status).toBe(400)
    expect(await json(malformed)).toEqual({ error: 'malformed' })
    expect(revalidateTag).not.toHaveBeenCalled()
  })

  it('does not touch the database before the signature is verified', async () => {
    await handlePaymentWebhook(new Request(URL, { method: 'POST', body: paidBody(1, 1) }))
    await handlePaymentWebhook(
      new Request(URL, { method: 'POST', body: paidBody(1, 1), headers: { [FAKE_SIGNATURE_HEADER]: forgedHeader() } }),
    )
    expect(driver.calls).toBe(0)
  })

  it('US-09: answers 200 and revalidates product:<slug> and products for a paid event', async () => {
    const order = await orderOf([SHIRT, MUG])
    const response = await send(paidBody(order.orderId, order.total))
    expect(response.status).toBe(200)
    expect(await json(response)).toEqual({ received: true, outcome: 'paid' })
    expect(revalidated().sort()).toEqual(['product:ao-404-not-found', 'product:ao-git-push-force', 'products'].sort())
    for (const [, profile] of vi.mocked(revalidateTag).mock.calls) expect(profile).toBe('max')
  })

  it('never revalidates product-slugs', async () => {
    const order = await orderOf([SHIRT])
    await send(paidBody(order.orderId, order.total))
    expect(revalidated()).not.toContain('product-slugs')
    expect(revalidated()).toEqual(['product:ao-git-push-force', 'products'])
  })

  it('answers 200 without revalidating for an ignored event, a cancelled event or a duplicate of an order that is not paid', async () => {
    const order = await orderOf([SHIRT])
    const ignored = await send(paidBody(order.orderId, order.total, 'fake_00000000-0000-4000-8000-000000000000'))
    expect(await json(ignored)).toEqual({ received: true, outcome: 'ignored' })

    const cancel = await send(JSON.stringify({ type: 'cancelled', paymentRef: REF, orderCode: order.orderId }))
    expect(cancel.status).toBe(200)
    expect(await json(cancel)).toEqual({ received: true, outcome: 'cancelled' })

    const duplicate = await send(paidBody(order.orderId, order.total))
    expect(await json(duplicate)).toEqual({ received: true, outcome: 'duplicate' })
    expect(revalidateTag).not.toHaveBeenCalled()
  })

  it('revalidates again for a duplicate of a paid order within 300 seconds', async () => {
    const order = await orderOf([SHIRT])
    await send(paidBody(order.orderId, order.total))
    vi.mocked(revalidateTag).mockClear()
    const again = await send(paidBody(order.orderId, order.total))
    expect(await json(again)).toEqual({ received: true, outcome: 'duplicate' })
    expect(revalidated()).toEqual(['product:ao-git-push-force', 'products'])
  })

  it('does not revalidate a duplicate of an order paid more than 300 seconds ago, and the handler now rules the expiry', async () => {
    const order = await orderOf([SHIRT])
    await send(paidBody(order.orderId, order.total))
    vi.mocked(revalidateTag).mockClear()
    const later = new Date(Date.now() + 301_000)
    const body = paidBody(order.orderId, order.total)
    const request = await signedRequest(body, later)
    // Signed 301 s from now: valid only because the handler's own clock is the one that is read.
    const again = await handlePaymentWebhook(request, later)
    expect(await json(again)).toEqual({ received: true, outcome: 'duplicate' })
    expect(revalidateTag).not.toHaveBeenCalled()
  })

  it('answers 503 when applying the event fails, and logs a fixed line only', async () => {
    const order = await orderOf([SHIRT])
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    driver.failure = Object.assign(new Error('database query failed: orders.apply-payment (40P01)'), { code: '40P01' })
    const response = await send(paidBody(order.orderId, order.total))
    expect(response.status).toBe(503)
    expect(await json(response)).toEqual({ error: 'unavailable' })
    expect(log.mock.calls).toEqual([['checkout: applying a payment event failed']])
    expect(revalidateTag).not.toHaveBeenCalled()
    log.mockRestore()
  })

  it('records an error without a SQLSTATE (a broken invariant) and still answers 503', async () => {
    const order = await orderOf([SHIRT])
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    driver.failure = new Error('orders: stored items are invalid')
    const response = await send(paidBody(order.orderId, order.total))
    expect(response.status).toBe(503)
    expect(await json(response)).toEqual({ error: 'unavailable' })
    expect(recordHandledError).toHaveBeenCalledTimes(1)
    expect(vi.mocked(recordHandledError).mock.calls[0]?.[0]).toMatchObject({ routePath: '/api/webhooks/payment', method: 'POST' })
    // Neither the body, the signature nor the ref is in anything that was logged.
    expect(JSON.stringify(log.mock.calls)).not.toContain(REF)
    log.mockRestore()
  })
})
