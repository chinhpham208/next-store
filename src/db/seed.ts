import 'server-only'
import { pathToFileURL } from 'node:url'
import { categories, db, products } from '@/db'
import { closeConnection, connection, describeError, describeTarget, type DatabaseTarget } from '@/db/client'
import { CATEGORY_SEEDS, PRODUCT_SEEDS } from '@/db/seed-data'

type SeedOptions = { allowProduction?: boolean }

type SeedGuardInput = { targetKind: DatabaseTarget['kind']; vercelEnv: string | undefined; allowProduction: boolean }

// Allow-list, not deny-list: a Postgres database is production unless Vercel says it is a preview branch.
// A VPS, a typo ('prod', 'Production') or a missing variable must never be mistaken for a safe target.
export const assertSeedAllowed = ({ targetKind, vercelEnv, allowProduction }: SeedGuardInput): void => {
  if (targetKind === 'pglite') return
  if (vercelEnv === 'preview' || allowProduction) return
  throw new Error(
    'Từ chối seed Postgres: chỉ preview (VERCEL_ENV=preview) được seed tự động, mọi trường hợp khác coi là production. ' +
      'Production chỉ seed một lần, chạy lại với --allow-production.',
  )
}

export const seed = async ({ allowProduction = false }: SeedOptions = {}): Promise<void> => {
  // Guard first: no statement may reach a production database before this check.
  assertSeedAllowed({ targetKind: connection.kind, vercelEnv: process.env.VERCEL_ENV, allowProduction })

  await db.transaction(async (tx) => {
    await tx.insert(categories).values(CATEGORY_SEEDS).onConflictDoNothing({ target: categories.slug })

    const rows = await tx.select({ id: categories.id, slug: categories.slug }).from(categories)
    const categoryIds = new Map(rows.map((row) => [row.slug, row.id]))

    const values = PRODUCT_SEEDS.map(({ categorySlug, ...product }) => {
      const categoryId = categoryIds.get(categorySlug)
      if (categoryId === undefined) throw new Error(`Seed: không tìm thấy danh mục "${categorySlug}"`)
      return { ...product, categoryId, image: `/images/${categorySlug}.svg` }
    })

    await tx.insert(products).values(values).onConflictDoNothing({ target: products.slug })
  })
}

const isDirectRun = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href

if (isDirectRun) {
  const main = async () => {
    console.log(`db:seed: ${describeTarget(connection.target)}`)
    await seed({ allowProduction: process.argv.includes('--allow-production') })
    console.log('db:seed: xong')
    // postgres-js keeps the pool open and PGlite must flush to disk; close both before exiting.
    await closeConnection()
  }
  main()
    .then(() => process.exit(0))
    .catch((error: unknown) => {
      console.error(`db:seed: ${describeError(error)}`)
      process.exit(1)
    })
}
