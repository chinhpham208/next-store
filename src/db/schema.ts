import { sql } from 'drizzle-orm'
import { boolean, check, index, integer, pgTable, serial, text, timestamp } from 'drizzle-orm/pg-core'

export const categories = pgTable('categories', {
  id: serial('id').primaryKey(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
})

export const products = pgTable(
  'products',
  {
    id: serial('id').primaryKey(),
    slug: text('slug').notNull().unique(),
    name: text('name').notNull(),
    description: text('description').notNull(),
    // Integer VND: no fractional đồng, and integers avoid float rounding in totals.
    price: integer('price').notNull(),
    image: text('image').notNull(),
    categoryId: integer('category_id')
      .notNull()
      .references(() => categories.id),
    stock: integer('stock').notNull().default(0),
    featured: boolean('featured').notNull().default(false),
    // timestamptz: Vercel functions run in UTC; without a zone, values written from another TZ would shift.
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    // Last line of defence for stock decrements (M4) and admin edits (M5): app checks can race.
    check('products_price_non_negative', sql`${table.price} >= 0`),
    check('products_stock_non_negative', sql`${table.stock} >= 0`),
    // Category listing filters on it; Postgres does not index foreign keys automatically.
    index('products_category_id_idx').on(table.categoryId),
  ],
)

export type Category = typeof categories.$inferSelect
export type Product = typeof products.$inferSelect
