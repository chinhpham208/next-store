import { sql } from 'drizzle-orm'
import { boolean, check, index, integer, pgTable, primaryKey, serial, text, timestamp, uuid } from 'drizzle-orm/pg-core'

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

// ADR-0014 1A. No serial / identity in either table: the DML-only app role (ADR-0010) has no sequence to need.
export const carts = pgTable(
  'carts',
  {
    // No default on purpose: the server generates it (crypto.randomUUID()), never the client.
    id: uuid('id').primaryKey(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    // Sliding 30-day expiry (ADR-0014 6A); every write of the cart sets it.
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  // Purging expired carts scans by age (ADR-0014 7A).
  (table) => [index('carts_updated_at_idx').on(table.updatedAt)],
)

export const cartItems = pgTable(
  'cart_items',
  {
    cartId: uuid('cart_id')
      .notNull()
      .references(() => carts.id, { onDelete: 'cascade' }),
    productId: integer('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    quantity: integer('quantity').notNull(),
    // Line order in the cart.
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // One line per product per cart: adding again updates the line.
    primaryKey({ columns: [table.cartId, table.productId] }),
    // Only the lower bound lives in the DB: the upper limit (ADR-0014 5A) can change without a contract migration.
    check('cart_items_quantity_positive', sql`${table.quantity} > 0`),
    // The primary key covers cart_id first; deleting a product (M5) looks lines up by product_id.
    index('cart_items_product_id_idx').on(table.productId),
  ],
)

export type Category = typeof categories.$inferSelect
export type Product = typeof products.$inferSelect
export type Cart = typeof carts.$inferSelect
export type CartItem = typeof cartItems.$inferSelect
