import 'server-only'

// No raw client here (ADR-0011): outside src/db every query runs through dbQuery, which replaces driver errors
// with fixed text and bounds the wait. Only tests and src/db scripts import `db` from '@/db/client'.
export { type Db, type DbTx } from '@/db/client'
export { dbQuery, resolveQueryTimeout, type DbQueryName } from '@/db/query'
export {
  adminLoginFailures,
  cartItems,
  carts,
  categories,
  errorEvents,
  orders,
  ORDER_STATUSES,
  products,
  REFUND_REASONS,
  type AdminLoginFailure,
  type Cart,
  type CartItem,
  type Category,
  type ErrorEvent,
  type Order,
  type Product,
} from '@/db/schema'
