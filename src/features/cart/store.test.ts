import { readFile } from 'node:fs/promises'
import { count, eq, getTableName, type Table } from 'drizzle-orm'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cartItems, carts, products } from '@/db'
import { db } from '@/db/client'
import { runMigrations } from '@/db/migrate'
import { seed } from '@/db/seed'
import { PRODUCT_SEEDS } from '@/db/seed-data'
import { CART_TTL_DAYS, MAX_CART_LINES, MAX_LINE_QUANTITY } from '@/features/cart/limits'
import { cartIdSchema, type CartId } from '@/features/cart/schema'
import {
  addLine,
  cartExpiryCutoff,
  countCartItems,
  purgeExpiredCarts,
  readCartLines,
  removeLine,
  setLine,
} from '@/features/cart/store'

// The real dbQuery, with the transaction handle wrapped so a test can see the order in which addLine reaches the
// tables (`locks the cart row before reading the line`). Every other test runs it unchanged.
const statements = vi.hoisted(() => ({ log: [] as string[], recording: false }))
vi.mock('@/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/db')>()
  const tableName = (table: unknown) => getTableName(table as Table)
  const record = <T extends object>(tx: T): T =>
    new Proxy(tx, {
      get(target, prop, receiver) {
        const value: unknown = Reflect.get(target, prop, receiver)
        if (typeof value !== 'function' || !['select', 'update', 'insert', 'delete'].includes(String(prop))) {
          return typeof value === 'function' ? value.bind(target) : value
        }
        return (...args: unknown[]) => {
          const builder = value.apply(target, args)
          if (prop !== 'select') {
            statements.log.push(`${String(prop)} ${tableName(args[0])}`)
            return builder
          }
          // A select names its table in from(), one call later.
          return new Proxy(builder, {
            get(inner, innerProp, innerReceiver) {
              const method: unknown = Reflect.get(inner, innerProp, innerReceiver)
              if (innerProp !== 'from' || typeof method !== 'function') return method
              return (table: unknown, ...rest: unknown[]) => {
                statements.log.push(`select ${tableName(table)}`)
                return method.apply(inner, [table, ...rest])
              }
            },
          })
        }
      },
    })
  const dbQuery: typeof actual.dbQuery = (input) =>
    statements.recording && input.transaction !== undefined
      ? actual.dbQuery({ ...input, transaction: (tx) => input.transaction(record(tx)) })
      : actual.dbQuery(input)
  return { ...actual, dbQuery }
})

const DAY_MS = 86_400_000
const NOW = new Date('2026-11-23T03:00:00.000Z')
const daysAgo = (days: number) => new Date(NOW.getTime() - days * DAY_MS)

const seedOf = (slug: string) => {
  const product = PRODUCT_SEEDS.find((candidate) => candidate.slug === slug)
  if (product === undefined) throw new Error(`no seed product ${slug}`)
  return { ...product, image: `/images/${product.categorySlug}.svg` }
}

const productId = async (slug: string): Promise<number> => {
  const [row] = await db.select({ id: products.id }).from(products).where(eq(products.slug, slug))
  if (row === undefined) throw new Error(`seeded product not found: ${slug}`)
  return row.id
}

// Writes go straight to the tables: the store's own writes belong to Tasks 5 and 6. There is no trigger on
// carts.updated_at (audit PR #69), so the age of a cart is exactly what is written here.
const makeCart = async ({
  updatedAt = NOW,
  lines = [],
}: {
  updatedAt?: Date
  lines?: { slug: string; quantity: number; createdAt?: Date }[]
} = {}): Promise<CartId> => {
  const id = cartIdSchema.parse(crypto.randomUUID())
  await db.insert(carts).values({ id, createdAt: updatedAt, updatedAt })
  for (const line of lines) {
    await db.insert(cartItems).values({
      cartId: id,
      productId: await productId(line.slug),
      quantity: line.quantity,
      createdAt: line.createdAt ?? updatedAt,
    })
  }
  return id
}

beforeAll(async () => {
  await runMigrations()
  await seed()
})

afterEach(() => {
  statements.recording = false
  statements.log = []
})

const newCartId = () => cartIdSchema.parse(crypto.randomUUID())

const linesOf = async (cartId: CartId) =>
  db
    .select({ productId: cartItems.productId, quantity: cartItems.quantity })
    .from(cartItems)
    .where(eq(cartItems.cartId, cartId))

const cartRow = async (cartId: CartId) => {
  const [row] = await db.select().from(carts).where(eq(carts.id, cartId))
  return row
}

const countCarts = async () => {
  const [row] = await db.select({ value: count() }).from(carts)
  return row?.value ?? 0
}

const LEFT_3 = 'ao-sudo-make-me-coffee'
const SOLD_OUT = 'ao-tabs-vs-spaces'
const STOCK_12 = 'ao-git-push-force'

describe('cartExpiryCutoff', () => {
  it(`is ${CART_TTL_DAYS} days before now`, () => {
    expect(cartExpiryCutoff(NOW)).toEqual(daysAgo(30))
  })
})

describe('readCartLines', () => {
  it('US-07: reads lines with the current price and the line total', async () => {
    const shirt = seedOf('ao-git-push-force')
    const other = seedOf('ao-404-not-found')
    const cartId = await makeCart({
      lines: [
        { slug: shirt.slug, quantity: 2, createdAt: daysAgo(1) },
        { slug: other.slug, quantity: 1, createdAt: NOW },
      ],
    })

    expect(await readCartLines(cartId, NOW)).toEqual([
      {
        slug: shirt.slug,
        name: shirt.name,
        image: shirt.image,
        price: shirt.price,
        quantity: 2,
        stock: shirt.stock,
        lineTotal: 2 * shirt.price,
      },
      {
        slug: other.slug,
        name: other.name,
        image: other.image,
        price: other.price,
        quantity: 1,
        stock: other.stock,
        lineTotal: other.price,
      },
    ])
  })

  it('reads the price at read time, not when the line was added (ADR-0014 4A)', async () => {
    const shirt = seedOf('ao-git-push-force')
    const cartId = await makeCart({ lines: [{ slug: shirt.slug, quantity: 3 }] })
    await db.update(products).set({ price: 150_000 }).where(eq(products.slug, shirt.slug))
    try {
      const [line] = await readCartLines(cartId, NOW)
      expect(line).toMatchObject({ price: 150_000, lineTotal: 450_000 })
    } finally {
      await db.update(products).set({ price: shirt.price }).where(eq(products.slug, shirt.slug))
    }
  })

  it('orders lines by when they were added, then by product', async () => {
    const cartId = await makeCart({
      lines: [
        { slug: 'ao-404-not-found', quantity: 1, createdAt: daysAgo(2) },
        { slug: 'ao-git-push-force', quantity: 1, createdAt: daysAgo(3) },
      ],
    })
    expect((await readCartLines(cartId, NOW)).map((line) => line.slug)).toEqual([
      'ao-git-push-force',
      'ao-404-not-found',
    ])
  })

  it('an unknown cart id reads as empty', async () => {
    const unknown = cartIdSchema.parse(crypto.randomUUID())
    expect(await readCartLines(unknown, NOW)).toEqual([])
    expect(await countCartItems(unknown, NOW)).toBe(0)
  })

  it('a cart without lines reads as empty', async () => {
    const cartId = await makeCart()
    expect(await readCartLines(cartId, NOW)).toEqual([])
    expect(await countCartItems(cartId, NOW)).toBe(0)
  })

  it('does not read another cart', async () => {
    await makeCart({ lines: [{ slug: 'ao-git-push-force', quantity: 4 }] })
    const mine = await makeCart({ lines: [{ slug: 'ao-404-not-found', quantity: 1 }] })
    expect((await readCartLines(mine, NOW)).map((line) => line.slug)).toEqual(['ao-404-not-found'])
    expect(await countCartItems(mine, NOW)).toBe(1)
  })
})

describe('expiry', () => {
  it('treats an expired cart as empty', async () => {
    const expired = await makeCart({ updatedAt: daysAgo(31), lines: [{ slug: 'ao-git-push-force', quantity: 2 }] })
    expect(await readCartLines(expired, NOW)).toEqual([])
    expect(await countCartItems(expired, NOW)).toBe(0)

    const fresh = await makeCart({ updatedAt: daysAgo(29), lines: [{ slug: 'ao-git-push-force', quantity: 2 }] })
    expect(await readCartLines(fresh, NOW)).toHaveLength(1)
    expect(await countCartItems(fresh, NOW)).toBe(2)
  })

  it('keeps a cart that is exactly at the cutoff', async () => {
    const edge = await makeCart({
      updatedAt: daysAgo(CART_TTL_DAYS),
      lines: [{ slug: 'ao-git-push-force', quantity: 1 }],
    })
    expect(await countCartItems(edge, NOW)).toBe(1)
    expect(await countCartItems(edge, new Date(NOW.getTime() + 1))).toBe(0)
  })

  it('reading does not extend the cart (ADR-0014 6A: only writes slide the expiry)', async () => {
    const updatedAt = daysAgo(10)
    const cartId = await makeCart({ updatedAt, lines: [{ slug: 'ao-git-push-force', quantity: 1 }] })
    await readCartLines(cartId, NOW)
    await countCartItems(cartId, NOW)
    const [row] = await db.select({ updatedAt: carts.updatedAt }).from(carts).where(eq(carts.id, cartId))
    expect(row?.updatedAt).toEqual(updatedAt)
  })
})

describe('countCartItems', () => {
  it('counts quantities, not lines', async () => {
    const cartId = await makeCart({
      lines: [
        { slug: 'ao-git-push-force', quantity: 2 },
        { slug: 'ao-404-not-found', quantity: 1 },
      ],
    })
    expect(await countCartItems(cartId, NOW)).toBe(3)
  })
})

describe('addLine', () => {
  it('seed invariants the add tests rely on', () => {
    expect(seedOf(LEFT_3).stock).toBe(3)
    expect(seedOf(SOLD_OUT).stock).toBe(0)
    expect(seedOf(STOCK_12).stock).toBe(12)
    expect(PRODUCT_SEEDS.filter((product) => (product.stock ?? 0) > 0).length).toBeGreaterThan(MAX_CART_LINES)
  })

  it('US-08: refuses 4 when 3 are left with available 3', async () => {
    const cartId = await makeCart()
    expect(await addLine({ cartId, slug: LEFT_3, quantity: 4, create: false, now: NOW })).toEqual({
      ok: false,
      error: 'over-stock',
      available: 3,
    })
    expect(await linesOf(cartId)).toEqual([])
  })

  it('US-08: refuses 2 more when 2 of 3 are already in the cart', async () => {
    const cartId = await makeCart({ lines: [{ slug: LEFT_3, quantity: 2 }] })
    expect(await addLine({ cartId, slug: LEFT_3, quantity: 2, create: false, now: NOW })).toEqual({
      ok: false,
      error: 'over-stock',
      available: 3,
    })
    expect(await linesOf(cartId)).toEqual([{ productId: await productId(LEFT_3), quantity: 2 }])
  })

  it('US-08: refuses an out-of-stock product', async () => {
    const cartId = await makeCart()
    expect(await addLine({ cartId, slug: SOLD_OUT, quantity: 1, create: false, now: NOW })).toEqual({
      ok: false,
      error: 'out-of-stock',
    })
    expect(await linesOf(cartId)).toEqual([])
  })

  it('adds 3 of 3', async () => {
    const cartId = await makeCart()
    expect(await addLine({ cartId, slug: LEFT_3, quantity: 3, create: false, now: NOW })).toEqual({
      ok: true,
      count: 3,
    })
  })

  it('US-06: adding the same product twice sums the quantity on one line', async () => {
    const cartId = await makeCart()
    expect(await addLine({ cartId, slug: STOCK_12, quantity: 1, create: false, now: NOW })).toEqual({
      ok: true,
      count: 1,
    })
    expect(await addLine({ cartId, slug: STOCK_12, quantity: 1, create: false, now: NOW })).toEqual({
      ok: true,
      count: 2,
    })
    expect(await linesOf(cartId)).toEqual([{ productId: await productId(STOCK_12), quantity: 2 }])
  })

  it('counts every line of the cart, not only the one added', async () => {
    const cartId = await makeCart({ lines: [{ slug: 'ao-404-not-found', quantity: 2 }] })
    expect(await addLine({ cartId, slug: STOCK_12, quantity: 3, create: false, now: NOW })).toEqual({
      ok: true,
      count: 5,
    })
  })

  it('refuses the 11th of one product', async () => {
    const cartId = await makeCart()
    expect(await addLine({ cartId, slug: STOCK_12, quantity: MAX_LINE_QUANTITY, create: false, now: NOW })).toEqual(
      { ok: true, count: MAX_LINE_QUANTITY },
    )
    expect(await addLine({ cartId, slug: STOCK_12, quantity: 1, create: false, now: NOW })).toEqual({
      ok: false,
      error: 'line-limit',
    })
    expect(await linesOf(cartId)).toEqual([{ productId: await productId(STOCK_12), quantity: MAX_LINE_QUANTITY }])
  })

  it('reports over-stock before line-limit when both apply', async () => {
    // stock 3 < 10: 2 in the cart + 9 is over both; the stock is what the customer can act on (US-08).
    const cartId = await makeCart({ lines: [{ slug: LEFT_3, quantity: 2 }] })
    expect(await addLine({ cartId, slug: LEFT_3, quantity: 9, create: false, now: NOW })).toMatchObject({
      error: 'over-stock',
    })
  })

  it('refuses the 21st line', async () => {
    const inStock = PRODUCT_SEEDS.filter((product) => (product.stock ?? 0) > 0)
    const cartId = await makeCart({
      lines: inStock.slice(0, MAX_CART_LINES - 1).map((product) => ({ slug: product.slug, quantity: 1 })),
    })
    const twentieth = inStock[MAX_CART_LINES - 1]
    const twentyFirst = inStock[MAX_CART_LINES]
    if (twentieth === undefined || twentyFirst === undefined) throw new Error('not enough products in stock')

    expect(await addLine({ cartId, slug: twentieth.slug, quantity: 1, create: false, now: NOW })).toEqual({
      ok: true,
      count: MAX_CART_LINES,
    })
    expect(await addLine({ cartId, slug: twentyFirst.slug, quantity: 1, create: false, now: NOW })).toEqual({
      ok: false,
      error: 'cart-full',
    })
    expect(await linesOf(cartId)).toHaveLength(MAX_CART_LINES)
    // A full cart still takes more of a product it already has.
    expect(await addLine({ cartId, slug: twentieth.slug, quantity: 1, create: false, now: NOW })).toEqual({
      ok: true,
      count: MAX_CART_LINES + 1,
    })
  })

  it('reports not-found for a slug no product has', async () => {
    const cartId = await makeCart()
    expect(await addLine({ cartId, slug: 'khong-ton-tai', quantity: 1, create: false, now: NOW })).toEqual({
      ok: false,
      error: 'not-found',
    })
  })

  it('creates the cart with the new id, now as both timestamps', async () => {
    const cartId = newCartId()
    expect(await addLine({ cartId, slug: STOCK_12, quantity: 2, create: true, now: NOW })).toEqual({
      ok: true,
      count: 2,
    })
    expect(await cartRow(cartId)).toEqual({ id: cartId, createdAt: NOW, updatedAt: NOW })
    expect(await countCartItems(cartId, NOW)).toBe(2)
  })

  it('creates no cart when the first add is refused', async () => {
    const before = await countCarts()
    for (const [slug, quantity] of [
      [LEFT_3, 4],
      [SOLD_OUT, 1],
      ['khong-ton-tai', 1],
    ] as const) {
      const cartId = newCartId()
      expect(await addLine({ cartId, slug, quantity, create: true, now: NOW })).toMatchObject({ ok: false })
      expect(await cartRow(cartId)).toBeUndefined()
    }
    expect(await countCarts()).toBe(before)
  })

  it('reports missing-cart for an unknown or expired id', async () => {
    const unknown = newCartId()
    expect(await addLine({ cartId: unknown, slug: STOCK_12, quantity: 1, create: false, now: NOW })).toEqual({
      ok: false,
      error: 'missing-cart',
    })
    expect(await cartRow(unknown)).toBeUndefined()

    const expired = await makeCart({ updatedAt: daysAgo(31) })
    expect(await addLine({ cartId: expired, slug: STOCK_12, quantity: 1, create: false, now: NOW })).toEqual({
      ok: false,
      error: 'missing-cart',
    })
    // Not revived: an expired cart stays expired and gets no line.
    expect(await cartRow(expired)).toMatchObject({ updatedAt: daysAgo(31) })
    expect(await linesOf(expired)).toEqual([])
  })

  it('touches updated_at on every successful add', async () => {
    const cartId = await makeCart({ updatedAt: daysAgo(20) })
    await addLine({ cartId, slug: STOCK_12, quantity: 1, create: false, now: daysAgo(5) })
    expect(await cartRow(cartId)).toMatchObject({ updatedAt: daysAgo(5) })
    await addLine({ cartId, slug: STOCK_12, quantity: 1, create: false, now: NOW })
    expect(await cartRow(cartId)).toMatchObject({ updatedAt: NOW })
    // The extended cart is alive 30 days from the last add, not from its creation.
    expect(await countCartItems(cartId, new Date(NOW.getTime() + 29 * DAY_MS))).toBe(2)
  })

  it('locks the cart row before reading the line', async () => {
    // Two tabs are two requests running side by side (plan M4 D3): without the lock both could read "0 in the
    // cart" and each add 2 of 3. UPDATE carts … RETURNING takes the row lock first, so the second transaction
    // waits for the first to commit and then reads its line. PGlite runs one transaction at a time, so the race
    // itself cannot be shown here; the order of statements is what the lock depends on.
    const cartId = await makeCart()
    statements.recording = true
    await addLine({ cartId, slug: STOCK_12, quantity: 1, create: false, now: NOW })
    expect(statements.log[0]).toBe('update carts')
    expect(statements.log.indexOf('update carts')).toBeLessThan(statements.log.indexOf('select products'))
    expect(statements.log.indexOf('update carts')).toBeLessThan(statements.log.indexOf('select cart_items'))
  })

  it('writes the new cart after every check, and its line after it', async () => {
    statements.recording = true
    await addLine({ cartId: newCartId(), slug: STOCK_12, quantity: 1, create: true, now: NOW })
    const insertCart = statements.log.indexOf('insert carts')
    expect(insertCart).toBeGreaterThan(statements.log.lastIndexOf('select products'))
    expect(statements.log.indexOf('insert cart_items')).toBeGreaterThan(insertCart)
    expect(statements.log).not.toContain('update carts')
  })

  it('reads stock inside the transaction, not from the cache', async () => {
    const cartId = await makeCart()
    statements.recording = true
    expect(await addLine({ cartId, slug: LEFT_3, quantity: 1, create: false, now: NOW })).toMatchObject({ ok: true })
    expect(statements.log).toContain('select products')

    await db.update(products).set({ stock: 1 }).where(eq(products.slug, LEFT_3))
    try {
      expect(await addLine({ cartId, slug: LEFT_3, quantity: 1, create: false, now: NOW })).toEqual({
        ok: false,
        error: 'over-stock',
        available: 1,
      })
    } finally {
      await db.update(products).set({ stock: 3 }).where(eq(products.slug, LEFT_3))
    }

    // getProductBySlug is cached for hours (plan M4 Global Constraints): the store must not reach for it.
    const source = await readFile(new URL('./store.ts', import.meta.url), 'utf8')
    expect(source).not.toMatch(/from '@\/features\/products|getProductBySlug\(|^\s*'use cache/m)
  })
})

describe('setLine', () => {
  const quantityOf = async (cartId: CartId, slug: string) => {
    const id = await productId(slug)
    return (await linesOf(cartId)).find((line) => line.productId === id)?.quantity
  }

  it('US-07: setting the quantity to 0 removes the line', async () => {
    const cartId = await makeCart({
      lines: [
        { slug: STOCK_12, quantity: 2 },
        { slug: 'ao-404-not-found', quantity: 1 },
      ],
    })
    expect(await setLine({ cartId, slug: STOCK_12, quantity: 0, now: NOW })).toEqual({ ok: true, count: 1 })
    expect(await linesOf(cartId)).toEqual([{ productId: await productId('ao-404-not-found'), quantity: 1 }])
  })

  it('US-07: changing the quantity changes the total', async () => {
    const first = seedOf(STOCK_12)
    const second = seedOf('ao-404-not-found')
    const cartId = await makeCart({
      lines: [
        { slug: first.slug, quantity: 1, createdAt: daysAgo(1) },
        { slug: second.slug, quantity: 1 },
      ],
    })
    expect(await setLine({ cartId, slug: first.slug, quantity: 2, now: NOW })).toEqual({ ok: true, count: 3 })
    const lines = await readCartLines(cartId, NOW)
    expect(lines.map((line) => [line.slug, line.quantity])).toEqual([
      [first.slug, 2],
      [second.slug, 1],
    ])
    expect(lines.reduce((sum, line) => sum + line.lineTotal, 0)).toBe(2 * first.price + 1 * second.price)
  })

  it('US-08: refuses raising a line above the stock', async () => {
    const cartId = await makeCart({ lines: [{ slug: LEFT_3, quantity: 2 }] })
    expect(await setLine({ cartId, slug: LEFT_3, quantity: 4, now: NOW })).toEqual({
      ok: false,
      error: 'over-stock',
      available: 3,
    })
    expect(await quantityOf(cartId, LEFT_3)).toBe(2)
  })

  it('raises a line up to the stock', async () => {
    const cartId = await makeCart({ lines: [{ slug: LEFT_3, quantity: 1 }] })
    expect(await setLine({ cartId, slug: LEFT_3, quantity: 3, now: NOW })).toEqual({ ok: true, count: 3 })
    expect(await quantityOf(cartId, LEFT_3)).toBe(3)
  })

  it('allows lowering a line that is above the stock', async () => {
    // Stock fell after the add (ADR-0014 10A): the customer is going the right way, so lowering is always allowed;
    // the cart page keeps warning until the line fits.
    const cartId = await makeCart({ lines: [{ slug: LEFT_3, quantity: 5 }] })
    expect(await setLine({ cartId, slug: LEFT_3, quantity: 4, now: NOW })).toEqual({ ok: true, count: 4 })
    expect(await quantityOf(cartId, LEFT_3)).toBe(4)
    // Keeping it as it is, is not raising it either.
    expect(await setLine({ cartId, slug: LEFT_3, quantity: 4, now: NOW })).toEqual({ ok: true, count: 4 })
    expect(await setLine({ cartId, slug: LEFT_3, quantity: 5, now: NOW })).toEqual({
      ok: false,
      error: 'over-stock',
      available: 3,
    })
    expect(await quantityOf(cartId, LEFT_3)).toBe(4)
  })

  it('allows lowering a line of a product that sold out, and refuses raising it', async () => {
    const cartId = await makeCart({ lines: [{ slug: SOLD_OUT, quantity: 2 }] })
    expect(await setLine({ cartId, slug: SOLD_OUT, quantity: 3, now: NOW })).toEqual({
      ok: false,
      error: 'out-of-stock',
    })
    expect(await setLine({ cartId, slug: SOLD_OUT, quantity: 1, now: NOW })).toEqual({ ok: true, count: 1 })
    expect(await setLine({ cartId, slug: SOLD_OUT, quantity: 0, now: NOW })).toEqual({ ok: true, count: 0 })
    expect(await linesOf(cartId)).toEqual([])
  })

  it('does not create a line when setting an absent product', async () => {
    const cartId = await makeCart({ lines: [{ slug: 'ao-404-not-found', quantity: 1 }] })
    expect(await setLine({ cartId, slug: STOCK_12, quantity: 2, now: NOW })).toEqual({
      ok: false,
      error: 'not-found',
    })
    expect(await linesOf(cartId)).toEqual([{ productId: await productId('ao-404-not-found'), quantity: 1 }])
  })

  it('reports not-found for a slug no product has', async () => {
    const cartId = await makeCart({ lines: [{ slug: STOCK_12, quantity: 1 }] })
    for (const quantity of [0, 1]) {
      expect(await setLine({ cartId, slug: 'khong-ton-tai', quantity, now: NOW })).toEqual({
        ok: false,
        error: 'not-found',
      })
    }
    expect(await quantityOf(cartId, STOCK_12)).toBe(1)
  })

  it('reads stock inside the transaction, not from the cache', async () => {
    const cartId = await makeCart({ lines: [{ slug: STOCK_12, quantity: 1 }] })
    await db.update(products).set({ stock: 2 }).where(eq(products.slug, STOCK_12))
    try {
      expect(await setLine({ cartId, slug: STOCK_12, quantity: 3, now: NOW })).toEqual({
        ok: false,
        error: 'over-stock',
        available: 2,
      })
    } finally {
      await db.update(products).set({ stock: 12 }).where(eq(products.slug, STOCK_12))
    }
  })

  it('reports missing-cart for an unknown or expired id and writes nothing', async () => {
    const unknown = newCartId()
    expect(await setLine({ cartId: unknown, slug: STOCK_12, quantity: 1, now: NOW })).toEqual({
      ok: false,
      error: 'missing-cart',
    })
    expect(await cartRow(unknown)).toBeUndefined()

    const expired = await makeCart({ updatedAt: daysAgo(31), lines: [{ slug: STOCK_12, quantity: 2 }] })
    for (const quantity of [0, 1]) {
      expect(await setLine({ cartId: expired, slug: STOCK_12, quantity, now: NOW })).toEqual({
        ok: false,
        error: 'missing-cart',
      })
    }
    expect(await cartRow(expired)).toMatchObject({ updatedAt: daysAgo(31) })
    expect(await quantityOf(expired, STOCK_12)).toBe(2)
  })

  it('touches updated_at on every successful set', async () => {
    const cartId = await makeCart({ updatedAt: daysAgo(20), lines: [{ slug: STOCK_12, quantity: 1 }] })
    await setLine({ cartId, slug: STOCK_12, quantity: 2, now: daysAgo(5) })
    expect(await cartRow(cartId)).toMatchObject({ updatedAt: daysAgo(5) })
    await setLine({ cartId, slug: STOCK_12, quantity: 0, now: NOW })
    expect(await cartRow(cartId)).toMatchObject({ updatedAt: NOW })
  })

  it('does not change another cart', async () => {
    const other = await makeCart({ lines: [{ slug: STOCK_12, quantity: 3 }] })
    const mine = await makeCart({ lines: [{ slug: STOCK_12, quantity: 1 }] })
    expect(await setLine({ cartId: mine, slug: STOCK_12, quantity: 2, now: NOW })).toEqual({ ok: true, count: 2 })
    expect(await setLine({ cartId: mine, slug: STOCK_12, quantity: 0, now: NOW })).toEqual({ ok: true, count: 0 })
    expect(await quantityOf(other, STOCK_12)).toBe(3)
  })

  it('locks the cart row before reading the line', async () => {
    // As in addLine: two tabs run side by side (plan M4 D3), and the row lock makes the second wait for the first.
    const cartId = await makeCart({ lines: [{ slug: STOCK_12, quantity: 1 }] })
    statements.recording = true
    await setLine({ cartId, slug: STOCK_12, quantity: 2, now: NOW })
    expect(statements.log[0]).toBe('update carts')
    statements.log = []
    await setLine({ cartId, slug: STOCK_12, quantity: 0, now: NOW })
    expect(statements.log[0]).toBe('update carts')
    expect(statements.log).toContain('delete cart_items')
    expect(statements.log).not.toContain('insert cart_items')
  })
})

describe('removeLine', () => {
  it('US-07: removes the line and returns the count of the rest', async () => {
    const cartId = await makeCart({
      lines: [
        { slug: STOCK_12, quantity: 2 },
        { slug: 'ao-404-not-found', quantity: 1 },
      ],
    })
    expect(await removeLine({ cartId, slug: STOCK_12, now: NOW })).toEqual({ ok: true, count: 1 })
    expect(await linesOf(cartId)).toEqual([{ productId: await productId('ao-404-not-found'), quantity: 1 }])
  })

  it('removing an absent line is ok', async () => {
    const cartId = await makeCart({ lines: [{ slug: 'ao-404-not-found', quantity: 2 }] })
    expect(await removeLine({ cartId, slug: STOCK_12, now: NOW })).toEqual({ ok: true, count: 2 })
    expect(await removeLine({ cartId, slug: 'khong-ton-tai', now: NOW })).toEqual({ ok: true, count: 2 })
    expect(await linesOf(cartId)).toHaveLength(1)
  })

  it('removes a line above the stock or of a sold-out product', async () => {
    const cartId = await makeCart({
      lines: [
        { slug: LEFT_3, quantity: 5 },
        { slug: SOLD_OUT, quantity: 1 },
      ],
    })
    expect(await removeLine({ cartId, slug: LEFT_3, now: NOW })).toEqual({ ok: true, count: 1 })
    expect(await removeLine({ cartId, slug: SOLD_OUT, now: NOW })).toEqual({ ok: true, count: 0 })
  })

  it('reports missing-cart for an unknown or expired id and writes nothing', async () => {
    expect(await removeLine({ cartId: newCartId(), slug: STOCK_12, now: NOW })).toEqual({
      ok: false,
      error: 'missing-cart',
    })
    const expired = await makeCart({ updatedAt: daysAgo(31), lines: [{ slug: STOCK_12, quantity: 2 }] })
    expect(await removeLine({ cartId: expired, slug: STOCK_12, now: NOW })).toEqual({
      ok: false,
      error: 'missing-cart',
    })
    expect(await cartRow(expired)).toMatchObject({ updatedAt: daysAgo(31) })
    expect(await linesOf(expired)).toHaveLength(1)
  })

  it('touches updated_at, even when the line was absent', async () => {
    const cartId = await makeCart({ updatedAt: daysAgo(20), lines: [{ slug: STOCK_12, quantity: 1 }] })
    await removeLine({ cartId, slug: 'ao-404-not-found', now: daysAgo(5) })
    expect(await cartRow(cartId)).toMatchObject({ updatedAt: daysAgo(5) })
    await removeLine({ cartId, slug: STOCK_12, now: NOW })
    expect(await cartRow(cartId)).toMatchObject({ updatedAt: NOW })
  })

  it('does not remove the line of another cart', async () => {
    const other = await makeCart({ lines: [{ slug: STOCK_12, quantity: 3 }] })
    const mine = await makeCart({ lines: [{ slug: STOCK_12, quantity: 1 }] })
    expect(await removeLine({ cartId: mine, slug: STOCK_12, now: NOW })).toEqual({ ok: true, count: 0 })
    expect(await linesOf(other)).toEqual([{ productId: await productId(STOCK_12), quantity: 3 }])
  })

  it('locks the cart row first, in one transaction', async () => {
    const cartId = await makeCart({ lines: [{ slug: STOCK_12, quantity: 1 }] })
    statements.recording = true
    await removeLine({ cartId, slug: STOCK_12, now: NOW })
    expect(statements.log[0]).toBe('update carts')
    expect(statements.log).toContain('delete cart_items')
  })
})

describe('purgeExpiredCarts', () => {
  it('purgeExpiredCarts deletes at most 50 expired carts and their lines', async () => {
    // Start from no carts so the count below is exact.
    await db.delete(carts)
    const expired: CartId[] = []
    for (let index = 0; index < 60; index += 1) {
      // Oldest first: the purge takes the 50 oldest.
      expired.push(
        await makeCart({ updatedAt: daysAgo(90 - index), lines: [{ slug: STOCK_12, quantity: 1 }] }),
      )
    }
    const live = await makeCart({ updatedAt: daysAgo(1), lines: [{ slug: STOCK_12, quantity: 1 }] })

    await purgeExpiredCarts(NOW)

    expect(await countCarts()).toBe(11)
    const remaining = await db.select({ id: carts.id }).from(carts)
    expect(new Set(remaining.map((row) => row.id))).toEqual(new Set([...expired.slice(50), live]))
    for (const cartId of expired.slice(0, 50)) expect(await linesOf(cartId)).toEqual([])
    expect(await linesOf(live)).toHaveLength(1)

    await purgeExpiredCarts(NOW)
    expect(await db.select({ id: carts.id }).from(carts)).toEqual([{ id: live }])
  })

  it('keeps a cart that is exactly at the cutoff', async () => {
    const edge = await makeCart({ updatedAt: daysAgo(CART_TTL_DAYS) })
    await purgeExpiredCarts(NOW)
    expect(await cartRow(edge)).toBeDefined()
  })
})
