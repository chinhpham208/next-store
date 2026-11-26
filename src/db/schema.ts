import { sql } from 'drizzle-orm'
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core'

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
    // "Mới nhất" and the featured products sort on it (ADR-0019 11A): no $onUpdate, so an admin edit moves nothing.
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
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

// ADR-0018: one row per wrong admin password, counted per IP and globally over 15 minutes, purged after a day.
// No serial / identity (DML-only app role, ADR-0010) and no raw IP: ip_hash is an HMAC keyed by SESSION_SECRET.
export const adminLoginFailures = pgTable(
  'admin_login_failures',
  {
    // No default on purpose: the server generates it (crypto.randomUUID()).
    id: uuid('id').primaryKey(),
    ipHash: text('ip_hash').notNull(),
    failedAt: timestamp('failed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // The per-IP count of the lock check; the global count and the purge scan by age alone.
    index('admin_login_failures_ip_failed_at_idx').on(table.ipHash, table.failedAt),
    index('admin_login_failures_failed_at_idx').on(table.failedAt),
  ],
)

// ADR-0021: the order statuses and refund reasons; the CHECKs below and the order store read the same lists.
export const ORDER_STATUSES = ['pending', 'paid', 'needs_refund', 'cancelled'] as const
export const REFUND_REASONS = ['out-of-stock', 'amount-mismatch'] as const

const inList = (values: readonly string[]) => sql.raw(values.map((value) => `'${value}'`).join(', '))

// ADR-0021: the one serial of the schema (the order code sent to the gateway); the app role has USAGE / SELECT on
// sequences (ADR-0010). No $onUpdate: every write sets updated_at, as for carts. payment_ref is attached after the
// provider answers, so it is nullable (Postgres lets many NULLs share a unique column).
export const orders = pgTable(
  'orders',
  {
    id: serial('id').primaryKey(),
    // Snapshot of the cart lines with the price at the time of the order (ADR-0014 (c)).
    items: jsonb('items').notNull(),
    total: integer('total').notNull(),
    status: text('status', { enum: ORDER_STATUSES }).notNull().default('pending'),
    refundReason: text('refund_reason', { enum: REFUND_REASONS }),
    provider: text('provider').notNull(),
    paymentRef: text('payment_ref').unique(),
    cartId: uuid('cart_id').references(() => carts.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check('orders_total_positive', sql`${table.total} > 0`),
    check('orders_status_known', sql`${table.status} IN (${inList(ORDER_STATUSES)})`),
    check('orders_refund_reason_known', sql`${table.refundReason} IS NULL OR ${table.refundReason} IN (${inList(REFUND_REASONS)})`),
    // A refund reason exists exactly when the order needs a refund.
    check('orders_refund_reason_matches_status', sql`(${table.status} = 'needs_refund') = (${table.refundReason} IS NOT NULL)`),
    // /admin/orders: newest first, optionally one status (ADR-0023).
    index('orders_created_at_idx').on(table.createdAt.desc(), table.id.desc()),
    index('orders_status_created_at_idx').on(table.status, table.createdAt.desc()),
  ],
)

// ADR-0022: one row per fingerprint of (routeType | routePath | errorName | message); the digest is a column of its
// own (latest value, to find the log line) and not part of the fingerprint. No serial / identity (DML-only role).
export const errorEvents = pgTable(
  'error_events',
  {
    fingerprint: text('fingerprint').primaryKey(),
    routeType: text('route_type').notNull(),
    routePath: text('route_path').notNull(),
    method: text('method').notNull(),
    digest: text('digest'),
    errorName: text('error_name').notNull(),
    // Only the fixed message of dbQuery (ADR-0011); null for every other error.
    message: text('message'),
    count: integer('count').notNull().default(1),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
  },
  // /admin/errors and the retention purge scan by age.
  (table) => [index('error_events_last_seen_at_idx').on(table.lastSeenAt)],
)

export type Category = typeof categories.$inferSelect
export type Product = typeof products.$inferSelect
export type Cart = typeof carts.$inferSelect
export type CartItem = typeof cartItems.$inferSelect
export type AdminLoginFailure = typeof adminLoginFailures.$inferSelect
export type Order = typeof orders.$inferSelect
export type ErrorEvent = typeof errorEvents.$inferSelect
