import { readFile } from 'node:fs/promises'
import { count, eq } from 'drizzle-orm'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { cartItems, carts, orders, products } from '@/db'
import { db } from '@/db/client'
import { runMigrations } from '@/db/migrate'
import { seed } from '@/db/seed'
import { PRODUCT_SEEDS } from '@/db/seed-data'
import { orderItemsSchema } from '@/features/orders/schema'
import { applyPaymentEvent, attachPaymentRef, createPendingOrder } from '@/features/orders/store'
import type { PaymentEvent } from '@/features/orders/types'

// PGlite runs one transaction at a time (plan M6 C7), so the "two deliveries at once" test proves the logic of the
// idempotent apply (the second delivery sees the first one's result), not the row locks: that is Postgres's job and
// a later task proves it there. The order of the lock queries is what the code review reads.

// The real dbQuery; `failure` makes the next call throw, as a deadlock (40P01) or a timeout would, and `attempts`
// counts how many times the store asked (audit PR #122 L1: a database error is thrown out, never retried inside).
const driver = vi.hoisted(() => ({ failure: undefined as Error | undefined, attempts: 0 }))
vi.mock('@/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/db')>()
  const dbQuery: typeof actual.dbQuery = (input) => {
    driver.attempts += 1
    if (driver.failure !== undefined) return Promise.reject(driver.failure)
    return actual.dbQuery(input)
  }
  return { ...actual, dbQuery }
})

const NOW = new Date('2026-11-26T10:00:00.000Z')
const LIVE_SINCE = new Date('2026-10-27T10:00:00.000Z')
const DAY = 86_400_000
const CART_A = '4f0c1c4e-2f43-4a0e-8d52-5d6a3b8a9c11'
const CART_B = '9b2d7e55-61d2-4c0c-9a77-3e1f5b0a2d22'
const SHIRT = 'ao-git-push-force'
const MUG = 'ao-404-not-found'

const productOf = async (slug: string) => {
  const [row] = await db.select().from(products).where(eq(products.slug, slug))
  if (row === undefined) throw new Error(`no product ${slug}`)
  return row
}

type LineInput = { slug: string; quantity: number }

const makeCart = async (cartId: string, lines: LineInput[], updatedAt: Date = NOW) => {
  await db.insert(carts).values({ id: cartId, createdAt: updatedAt, updatedAt })
  let offset = 0
  for (const { slug, quantity } of lines) {
    const product = await productOf(slug)
    await db
      .insert(cartItems)
      .values({ cartId, productId: product.id, quantity, createdAt: new Date(NOW.getTime() + offset++) })
  }
}

const setStock = async (slug: string, stock: number) => {
  await db.update(products).set({ stock }).where(eq(products.slug, slug))
}

const create = (cartId: string, liveSince: Date = LIVE_SINCE) =>
  createPendingOrder({ cartId, liveSince, provider: 'fake', now: NOW })

// An order for a cart, with a payment ref attached (the state the gateway knows about).
const orderFor = async (cartId: string, ref: string) => {
  const result = await create(cartId)
  if (!result.ok) throw new Error(`could not create the order: ${result.error}`)
  await attachPaymentRef({ orderId: result.orderId, paymentRef: ref, now: NOW })
  return result
}

const paid = (orderId: number, ref: string, amount: number): PaymentEvent => ({
  type: 'paid',
  paymentRef: ref,
  orderCode: orderId,
  amount,
})
const cancelled = (orderId: number, ref: string): PaymentEvent => ({ type: 'cancelled', paymentRef: ref, orderCode: orderId })

const apply = (event: PaymentEvent, now: Date = NOW) => applyPaymentEvent({ event, provider: 'fake', now })

const orderRow = async (orderId: number) => {
  const [row] = await db.select().from(orders).where(eq(orders.id, orderId))
  if (row === undefined) throw new Error(`no order ${orderId}`)
  return row
}

const stockOf = async (slug: string) => (await productOf(slug)).stock

const cartLineCount = async (cartId: string) => {
  const [row] = await db.select({ value: count() }).from(cartItems).where(eq(cartItems.cartId, cartId))
  return row?.value ?? 0
}

const orderCount = async () => {
  const [row] = await db.select({ value: count() }).from(orders)
  return row?.value ?? 0
}

beforeAll(async () => {
  await runMigrations()
})

beforeEach(async () => {
  driver.failure = undefined
  driver.attempts = 0
  await db.delete(orders)
  await db.delete(carts)
  await seed()
  // A known stock for the products used here, whatever the seed says.
  for (const seeded of PRODUCT_SEEDS) {
    // seed() keeps rows that exist, so what an earlier test changed is put back here.
    await db
      .update(products)
      .set({ price: seeded.price, stock: 10, name: seeded.name })
      .where(eq(products.slug, seeded.slug))
  }
})

describe('createPendingOrder', () => {
  it("US-09: creates a pending order with the cart's current prices snapshotted in items", async () => {
    const shirt = await productOf(SHIRT)
    const mug = await productOf(MUG)
    await makeCart(CART_A, [
      { slug: SHIRT, quantity: 2 },
      { slug: MUG, quantity: 1 },
    ])

    const result = await create(CART_A)

    const items = [
      { productId: shirt.id, slug: SHIRT, name: shirt.name, price: shirt.price, quantity: 2, lineTotal: shirt.price * 2 },
      { productId: mug.id, slug: MUG, name: mug.name, price: mug.price, quantity: 1, lineTotal: mug.price },
    ]
    const total = shirt.price * 2 + mug.price
    expect(result).toEqual({ ok: true, orderId: expect.any(Number) as number, total, items })
    if (!result.ok) throw new Error('unreachable')
    expect(await orderRow(result.orderId)).toMatchObject({
      status: 'pending',
      refundReason: null,
      provider: 'fake',
      paymentRef: null,
      cartId: CART_A,
      total,
      items,
    })
    // Nothing is held or decremented, and reading the cart does not slide its expiry (ADR-0014).
    expect(await stockOf(SHIRT)).toBe(10)
    expect(await cartLineCount(CART_A)).toBe(2)
  })

  it('the snapshot keeps the old price after an admin price change', async () => {
    const shirt = await productOf(SHIRT)
    await makeCart(CART_A, [{ slug: SHIRT, quantity: 2 }])
    const result = await create(CART_A)
    if (!result.ok) throw new Error('order not created')

    await db.update(products).set({ price: shirt.price + 50000 }).where(eq(products.slug, SHIRT))

    const row = await orderRow(result.orderId)
    expect(row.total).toBe(shirt.price * 2)
    expect(row.items).toMatchObject([{ price: shirt.price, lineTotal: shirt.price * 2 }])
  })

  it('refuses a missing or expired cart', async () => {
    expect(await create(CART_A)).toEqual({ ok: false, error: 'missing-cart' })
    await makeCart(CART_B, [{ slug: SHIRT, quantity: 1 }], new Date(LIVE_SINCE.getTime() - 1))
    expect(await create(CART_B)).toEqual({ ok: false, error: 'missing-cart' })
    expect(await orderCount()).toBe(0)
  })

  it('accepts a cart written exactly at the cutoff', async () => {
    await makeCart(CART_A, [{ slug: SHIRT, quantity: 1 }], LIVE_SINCE)
    expect((await create(CART_A)).ok).toBe(true)
  })

  it('refuses an empty cart', async () => {
    await makeCart(CART_A, [])
    expect(await create(CART_A)).toEqual({ ok: false, error: 'empty' })
    expect(await orderCount()).toBe(0)
  })

  it('refuses a cart with a line over stock and writes no order', async () => {
    await setStock(MUG, 1)
    await makeCart(CART_A, [
      { slug: SHIRT, quantity: 1 },
      { slug: MUG, quantity: 2 },
    ])
    expect(await create(CART_A)).toEqual({ ok: false, error: 'over-stock' })
    expect(await orderCount()).toBe(0)
  })

  it('refuses an out-of-stock line', async () => {
    await setStock(MUG, 0)
    await makeCart(CART_A, [
      { slug: SHIRT, quantity: 1 },
      { slug: MUG, quantity: 1 },
    ])
    expect(await create(CART_A)).toEqual({ ok: false, error: 'out-of-stock' })
    expect(await orderCount()).toBe(0)
  })

  it('refuses a zero total', async () => {
    await db.update(products).set({ price: 0 }).where(eq(products.slug, SHIRT))
    await makeCart(CART_A, [{ slug: SHIRT, quantity: 3 }])
    expect(await create(CART_A)).toEqual({ ok: false, error: 'zero-total' })
    expect(await orderCount()).toBe(0)
  })

  it('refuses a total above int4 with too-large, before the INSERT (audit PR #126 L2)', async () => {
    // 3 lines x 10 x 100.000.000 = 3.000.000.000 > 2.147.483.647.
    const slugs = PRODUCT_SEEDS.slice(0, 3).map((product) => product.slug)
    for (const slug of slugs) await db.update(products).set({ price: 100_000_000, stock: 10 }).where(eq(products.slug, slug))
    await makeCart(
      CART_A,
      slugs.map((slug) => ({ slug, quantity: 10 })),
    )
    expect(await create(CART_A)).toEqual({ ok: false, error: 'too-large' })
    expect(await orderCount()).toBe(0)
    // Two lines (2.000.000.000) still fit.
    await db.delete(cartItems).where(eq(cartItems.productId, (await productOf(slugs[2] ?? '')).id))
    expect((await create(CART_A)).ok).toBe(true)
  })

  it('throws and writes no order when the snapshot would not pass orderItemsSchema (audit PR #126 L3)', async () => {
    await db.update(products).set({ name: 'x'.repeat(201) }).where(eq(products.slug, SHIRT))
    await makeCart(CART_A, [{ slug: SHIRT, quantity: 1 }])
    await expect(create(CART_A)).rejects.toThrow('database query failed: orders.create')
    expect(await orderCount()).toBe(0)
  })

  it('the schema bounds cover the limits of the cart and of the product edit form', async () => {
    // orders must not import cart or the admin entry of products, so the limits are read from their source files.
    const limit = async (file: string, name: string) => {
      const match = new RegExp(`${name}\\s*[=:]\\s*(\\d+)`).exec(await readFile(file, 'utf8'))
      if (match?.[1] === undefined) throw new Error(`no ${name} in ${file}`)
      return Number(match[1])
    }
    const maxQuantity = await limit('src/features/cart/limits.ts', 'MAX_LINE_QUANTITY')
    const maxLines = await limit('src/features/cart/limits.ts', 'MAX_CART_LINES')
    const nameMax = await limit('src/features/products/schema.ts', 'nameMax')
    const item = { productId: 1, slug: 'a', name: 'n'.repeat(nameMax), price: 1, quantity: maxQuantity, lineTotal: maxQuantity }
    expect(orderItemsSchema.safeParse(Array.from({ length: maxLines }, () => item)).success).toBe(true)
  })

  it('two checkouts of one cart create two pending orders', async () => {
    // Recorded behaviour, not a promise (plan M6 "Cố ý không làm" 4): the second order simply never gets paid.
    await makeCart(CART_A, [{ slug: SHIRT, quantity: 1 }])
    const first = await create(CART_A)
    const second = await create(CART_A)
    if (!first.ok || !second.ok) throw new Error('order not created')
    expect(second.orderId).not.toBe(first.orderId)
    expect(await orderCount()).toBe(2)
  })
})

describe('attachPaymentRef', () => {
  it('sets the ref on a pending order that has none', async () => {
    await makeCart(CART_A, [{ slug: SHIRT, quantity: 1 }])
    const { orderId } = await orderFor(CART_A, 'fake_attach01')
    expect((await orderRow(orderId)).paymentRef).toBe('fake_attach01')
  })

  it('refuses a ref outside the shape getOrderByRef accepts (audit PR #126 N2)', async () => {
    await makeCart(CART_A, [{ slug: SHIRT, quantity: 1 }])
    const result = await create(CART_A)
    if (!result.ok) throw new Error('order not created')
    for (const paymentRef of ['short', 'has space1', 'x'.repeat(65), "a'b'c'd'e'f'g"]) {
      await expect(attachPaymentRef({ orderId: result.orderId, paymentRef, now: NOW })).rejects.toThrow(
        'orders: payment ref not attached',
      )
    }
    expect((await orderRow(result.orderId)).paymentRef).toBeNull()
  })

  it('throws a fixed message for an order that already has a ref or is not pending', async () => {
    await makeCart(CART_A, [{ slug: SHIRT, quantity: 1 }])
    const { orderId } = await orderFor(CART_A, 'fake_attach02')
    await expect(attachPaymentRef({ orderId, paymentRef: 'fake_attach03', now: NOW })).rejects.toThrow(
      'orders: payment ref not attached',
    )
    await expect(attachPaymentRef({ orderId: 999_999, paymentRef: 'fake_attach04', now: NOW })).rejects.toThrow(
      'orders: payment ref not attached',
    )
  })
})

describe('applyPaymentEvent', () => {
  it('US-09: a paid event marks the order paid, decrements stock by the ordered quantities and empties the cart', async () => {
    await makeCart(CART_A, [
      { slug: SHIRT, quantity: 2 },
      { slug: MUG, quantity: 3 },
    ])
    const { orderId, total } = await orderFor(CART_A, 'fake_paid0001')
    const later = new Date(NOW.getTime() + 60_000)

    const result = await apply(paid(orderId, 'fake_paid0001', total), later)

    expect(result.outcome).toBe('paid')
    expect([...result.slugs].sort()).toEqual([MUG, SHIRT].sort())
    expect(await stockOf(SHIRT)).toBe(8)
    expect(await stockOf(MUG)).toBe(7)
    expect(await orderRow(orderId)).toMatchObject({ status: 'paid', refundReason: null, updatedAt: later })
    expect(await cartLineCount(CART_A)).toBe(0)
    // The cart itself stays; only its lines go.
    const [cart] = await db.select().from(carts).where(eq(carts.id, CART_A))
    expect(cart).toBeDefined()
  })

  it('US-09: the same paid event twice decrements stock once', async () => {
    await makeCart(CART_A, [{ slug: SHIRT, quantity: 2 }])
    const { orderId, total } = await orderFor(CART_A, 'fake_twice001')
    const event = paid(orderId, 'fake_twice001', total)

    expect((await apply(event)).outcome).toBe('paid')
    const second = await apply(event)

    expect(second.outcome).toBe('duplicate')
    expect(await stockOf(SHIRT)).toBe(8)
    expect((await orderRow(orderId)).status).toBe('paid')
  })

  it('US-09: two concurrent deliveries of one event decrement stock once', async () => {
    await makeCart(CART_A, [{ slug: SHIRT, quantity: 2 }])
    const { orderId, total } = await orderFor(CART_A, 'fake_concur01')
    const event = paid(orderId, 'fake_concur01', total)

    // C7: PGlite serializes transactions, so this proves the second delivery sees the first one's commit, not that
    // the row lock makes it wait; the proof on Postgres comes with the E2E and the preview database.
    const results = await Promise.all([apply(event), apply(event)])

    expect(results.map((result) => result.outcome).sort()).toEqual(['duplicate', 'paid'])
    expect(await stockOf(SHIRT)).toBe(8)
  })

  it('US-09: two orders for the last item: the second paid event marks needs_refund and leaves stock at 0', async () => {
    await setStock(SHIRT, 1)
    await makeCart(CART_A, [{ slug: SHIRT, quantity: 1 }])
    await makeCart(CART_B, [{ slug: SHIRT, quantity: 1 }])
    const first = await orderFor(CART_A, 'fake_last0001')
    const second = await orderFor(CART_B, 'fake_last0002')

    expect((await apply(paid(first.orderId, 'fake_last0001', first.total))).outcome).toBe('paid')
    const result = await apply(paid(second.orderId, 'fake_last0002', second.total))

    expect(result).toEqual({ outcome: 'needs_refund', slugs: [] })
    expect(await stockOf(SHIRT)).toBe(0)
    expect(await orderRow(second.orderId)).toMatchObject({ status: 'needs_refund', refundReason: 'out-of-stock' })
    // The second buyer keeps the cart (decision 3A).
    expect(await cartLineCount(CART_B)).toBe(1)
  })

  it('needs_refund decrements nothing for any line when one line is short', async () => {
    await makeCart(CART_A, [
      { slug: SHIRT, quantity: 2 },
      { slug: MUG, quantity: 3 },
    ])
    const { orderId, total } = await orderFor(CART_A, 'fake_short001')
    // Someone else bought the mugs between the order and the payment.
    await setStock(MUG, 2)
    const before = await productOf(SHIRT)

    const result = await apply(paid(orderId, 'fake_short001', total))

    expect(result.outcome).toBe('needs_refund')
    expect(await stockOf(SHIRT)).toBe(10)
    expect(await stockOf(MUG)).toBe(2)
    expect((await productOf(SHIRT)).updatedAt).toEqual(before.updatedAt)
    expect(await orderRow(orderId)).toMatchObject({ status: 'needs_refund', refundReason: 'out-of-stock' })
    expect(await cartLineCount(CART_A)).toBe(2)
  })

  it('an amount that differs from the total marks needs_refund (amount-mismatch) without touching stock', async () => {
    await makeCart(CART_A, [{ slug: SHIRT, quantity: 2 }])
    const { orderId, total } = await orderFor(CART_A, 'fake_amount01')
    const before = await productOf(SHIRT)

    for (const amount of [total - 1, total + 1]) {
      await db.update(orders).set({ status: 'pending', refundReason: null }).where(eq(orders.id, orderId))
      expect(await apply(paid(orderId, 'fake_amount01', amount))).toEqual({ outcome: 'needs_refund', slugs: [] })
      expect(await orderRow(orderId)).toMatchObject({ status: 'needs_refund', refundReason: 'amount-mismatch' })
    }

    expect((await productOf(SHIRT)).stock).toBe(10)
    expect((await productOf(SHIRT)).updatedAt).toEqual(before.updatedAt)
    expect(await cartLineCount(CART_A)).toBe(1)
  })

  it('a cancelled event cancels a pending order and keeps the cart', async () => {
    await makeCart(CART_A, [{ slug: SHIRT, quantity: 2 }])
    const { orderId } = await orderFor(CART_A, 'fake_cancel01')

    expect(await apply(cancelled(orderId, 'fake_cancel01'))).toEqual({ outcome: 'cancelled', slugs: [] })

    expect(await orderRow(orderId)).toMatchObject({ status: 'cancelled', refundReason: null })
    expect(await cartLineCount(CART_A)).toBe(1)
    expect(await stockOf(SHIRT)).toBe(10)
  })

  it('a cancelled event after paid changes nothing', async () => {
    await makeCart(CART_A, [{ slug: SHIRT, quantity: 2 }])
    const { orderId, total } = await orderFor(CART_A, 'fake_cafter01')
    await apply(paid(orderId, 'fake_cafter01', total))

    const result = await apply(cancelled(orderId, 'fake_cafter01'))

    expect(result.outcome).toBe('duplicate')
    expect((await orderRow(orderId)).status).toBe('paid')
    expect(await stockOf(SHIRT)).toBe(8)
  })

  it('a paid event after cancelled changes nothing', async () => {
    await makeCart(CART_A, [{ slug: SHIRT, quantity: 2 }])
    const { orderId, total } = await orderFor(CART_A, 'fake_pafter01')
    await apply(cancelled(orderId, 'fake_pafter01'))

    expect(await apply(paid(orderId, 'fake_pafter01', total))).toEqual({ outcome: 'duplicate', slugs: [] })

    expect((await orderRow(orderId)).status).toBe('cancelled')
    expect(await stockOf(SHIRT)).toBe(10)
    expect(await cartLineCount(CART_A)).toBe(1)
  })

  it('an event whose ref and order code do not match is ignored', async () => {
    await makeCart(CART_A, [{ slug: SHIRT, quantity: 1 }])
    await makeCart(CART_B, [{ slug: SHIRT, quantity: 1 }])
    const first = await orderFor(CART_A, 'fake_match001')
    const second = await orderFor(CART_B, 'fake_match002')

    // The ref of one order with the code of the other.
    expect(await apply(paid(second.orderId, 'fake_match001', first.total))).toEqual({ outcome: 'ignored', slugs: [] })
    expect(await apply(cancelled(first.orderId, 'fake_match002'))).toEqual({ outcome: 'ignored', slugs: [] })

    expect((await orderRow(first.orderId)).status).toBe('pending')
    expect((await orderRow(second.orderId)).status).toBe('pending')
    expect(await stockOf(SHIRT)).toBe(10)
  })

  it('an event of another provider is ignored', async () => {
    await makeCart(CART_A, [{ slug: SHIRT, quantity: 1 }])
    const { orderId, total } = await orderFor(CART_A, 'fake_provid01')
    // The row says another gateway created it.
    await db.update(orders).set({ provider: 'other' }).where(eq(orders.id, orderId))

    expect(await apply(paid(orderId, 'fake_provid01', total))).toEqual({ outcome: 'ignored', slugs: [] })
    expect((await orderRow(orderId)).status).toBe('pending')
  })

  it('an unknown ref is ignored', async () => {
    expect(await apply(paid(1, 'fake_unknown1', 1000))).toEqual({ outcome: 'ignored', slugs: [] })
    expect(await apply(cancelled(1, 'fake_unknown1'))).toEqual({ outcome: 'ignored', slugs: [] })
  })

  it("clears only the order's own cart", async () => {
    await makeCart(CART_A, [{ slug: SHIRT, quantity: 1 }])
    await makeCart(CART_B, [{ slug: SHIRT, quantity: 1 }])
    const { orderId, total } = await orderFor(CART_A, 'fake_clear001')

    await apply(paid(orderId, 'fake_clear001', total))

    expect(await cartLineCount(CART_A)).toBe(0)
    expect(await cartLineCount(CART_B)).toBe(1)
  })

  it('pays an order whose cart is gone and clears nothing', async () => {
    await makeCart(CART_A, [{ slug: SHIRT, quantity: 1 }])
    const { orderId, total } = await orderFor(CART_A, 'fake_nocart01')
    await db.delete(carts).where(eq(carts.id, CART_A))
    expect((await orderRow(orderId)).cartId).toBeNull()

    expect((await apply(paid(orderId, 'fake_nocart01', total))).outcome).toBe('paid')
    expect(await stockOf(SHIRT)).toBe(9)
  })

  it('returns the product slugs for a paid event and for a duplicate of a paid order, and none otherwise', async () => {
    await makeCart(CART_A, [
      { slug: SHIRT, quantity: 1 },
      { slug: MUG, quantity: 1 },
    ])
    await makeCart(CART_B, [{ slug: SHIRT, quantity: 1 }])
    const first = await orderFor(CART_A, 'fake_slugs001')
    const second = await orderFor(CART_B, 'fake_slugs002')

    const slugs = async (event: PaymentEvent) => [...(await apply(event)).slugs].sort()
    expect(await slugs(paid(first.orderId, 'fake_slugs001', first.total))).toEqual([MUG, SHIRT].sort())
    // audit PR #120 L1: a duplicate of a paid order still names its products, so the webhook refreshes the cache
    // again when the first delivery died between the commit and revalidateTag.
    expect(await slugs(paid(first.orderId, 'fake_slugs001', first.total))).toEqual([MUG, SHIRT].sort())
    expect(await slugs(cancelled(second.orderId, 'fake_slugs002'))).toEqual([])
    expect(await slugs(cancelled(second.orderId, 'fake_slugs002'))).toEqual([])
    expect(await slugs(paid(second.orderId, 'fake_slugs002', second.total))).toEqual([])
    expect(await slugs(paid(1, 'fake_unknown1', 1))).toEqual([])
  })

  it('revalidates again for a duplicate of a paid order', async () => {
    await makeCart(CART_A, [{ slug: SHIRT, quantity: 1 }])
    const { orderId, total } = await orderFor(CART_A, 'fake_reval001')
    const event = paid(orderId, 'fake_reval001', total)
    const first = await apply(event)
    const duplicate = await apply(event)

    expect(first).toEqual({ outcome: 'paid', slugs: [SHIRT] })
    // The caller refreshes the tags of these slugs after every `paid` and every `duplicate` that carries them.
    expect(duplicate).toEqual({ outcome: 'duplicate', slugs: [SHIRT] })
    expect(await stockOf(SHIRT)).toBe(9)
  })

  it('throws a database error out instead of swallowing or retrying it (40P01 deadlock)', async () => {
    await makeCart(CART_A, [{ slug: SHIRT, quantity: 2 }])
    const { orderId, total } = await orderFor(CART_A, 'fake_dead0001')
    const deadlock = Object.assign(new Error('database query failed: orders.apply-payment (40P01)'), { code: '40P01' })
    driver.failure = deadlock
    driver.attempts = 0

    // audit PR #122 L1: the webhook answers 503 and the gateway sends the event again; applying is idempotent.
    await expect(apply(paid(orderId, 'fake_dead0001', total))).rejects.toBe(deadlock)
    expect(driver.attempts).toBe(1)

    driver.failure = undefined
    expect((await orderRow(orderId)).status).toBe('pending')
    expect(await stockOf(SHIRT)).toBe(10)
    // The next delivery applies normally.
    expect((await apply(paid(orderId, 'fake_dead0001', total))).outcome).toBe('paid')
  })

  it('throws when the stored items are invalid and leaves the order pending', async () => {
    await makeCart(CART_A, [{ slug: SHIRT, quantity: 1 }])
    const { orderId, total } = await orderFor(CART_A, 'fake_badjson1')
    await db.update(orders).set({ items: [{ productId: 'x' }] }).where(eq(orders.id, orderId))

    // dbQuery replaces the message of whatever the transaction threw (ADR-0011): the caller sees the query name only.
    await expect(apply(paid(orderId, 'fake_badjson1', total))).rejects.toThrow('database query failed: orders.apply-payment')

    expect((await orderRow(orderId)).status).toBe('pending')
    expect(await stockOf(SHIRT)).toBe(10)
  })

  it('merges lines of one product before decrementing', async () => {
    await makeCart(CART_A, [{ slug: SHIRT, quantity: 2 }])
    const { orderId, total } = await orderFor(CART_A, 'fake_merge001')
    const shirt = await productOf(SHIRT)
    // A snapshot with the same product on two lines (the cart cannot make one, but the store must not trust that).
    const line = { productId: shirt.id, slug: SHIRT, name: shirt.name, price: shirt.price, quantity: 1, lineTotal: shirt.price }
    await db.update(orders).set({ items: [line, line] }).where(eq(orders.id, orderId))

    expect((await apply(paid(orderId, 'fake_merge001', total))).outcome).toBe('paid')
    expect(await stockOf(SHIRT)).toBe(8)
  })
})

describe('the clock', () => {
  it('uses the given now for every order write', async () => {
    await makeCart(CART_A, [{ slug: SHIRT, quantity: 1 }])
    const { orderId, total } = await orderFor(CART_A, 'fake_clock001')
    const row = await orderRow(orderId)
    expect(row.createdAt).toEqual(NOW)
    expect(row.updatedAt).toEqual(NOW)
    const later = new Date(NOW.getTime() + DAY)
    await apply(paid(orderId, 'fake_clock001', total), later)
    expect((await orderRow(orderId)).updatedAt).toEqual(later)
  })
})
