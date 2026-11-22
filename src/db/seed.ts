import 'server-only'
import { pathToFileURL } from 'node:url'
import { categories, db, products } from '@/db'
import { closeConnection, connection, describeError, describeTarget, type DatabaseTarget } from '@/db/client'
import { CATEGORY_SEEDS, PRODUCT_SEEDS } from '@/db/seed-data'

type SeedGuardInput = { targetKind: DatabaseTarget['kind']; vercelEnv: string | undefined }

// Allow-list, not deny-list: a Postgres database is production unless Vercel says it is a preview branch.
// A VPS, a typo ('prod', 'Production') or a missing variable must never be mistaken for a safe target.
// There is deliberately no override (NS-36, owner decision 3): production is seeded from generated SQL in the
// Neon SQL Editor, so nobody needs the production DATABASE_URL on a machine that can run this script.
export const assertSeedAllowed = ({ targetKind, vercelEnv }: SeedGuardInput): void => {
  if (targetKind === 'pglite') return
  if (vercelEnv === 'preview') return
  throw new Error(
    'Từ chối seed Postgres: chỉ preview (VERCEL_ENV=preview) được seed tự động, mọi trường hợp khác coi là production. ' +
      'Seed production: npm run -s db:seed:sql rồi chạy SQL đó trong Neon SQL Editor (README, mục Seed production).',
  )
}

export const seed = async (): Promise<void> => {
  // Guard first: no statement may reach a production database before this check.
  assertSeedAllowed({ targetKind: connection.kind, vercelEnv: process.env.VERCEL_ENV })

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
    await seed()
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
