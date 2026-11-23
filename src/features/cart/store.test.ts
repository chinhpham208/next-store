import { eq } from 'drizzle-orm'
import { beforeAll, describe, expect, it } from 'vitest'
import { cartItems, carts, products } from '@/db'
import { db } from '@/db/client'
import { runMigrations } from '@/db/migrate'
import { seed } from '@/db/seed'
import { PRODUCT_SEEDS } from '@/db/seed-data'
import { CART_TTL_DAYS } from '@/features/cart/limits'
import { cartIdSchema, type CartId } from '@/features/cart/schema'
import { cartExpiryCutoff, countCartItems, readCartLines } from '@/features/cart/store'

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
