import 'server-only'
import { sql } from 'drizzle-orm'
import { products } from '@/db'

// products.updated_at as text, UTC to the microsecond (timestamptz precision). A Date holds milliseconds only, and
// the admin save compares the form's value exactly with the column (conflict check, ADR-0019 13A), so the admin
// read and the save's RETURNING both use this one expression.
export const UPDATED_AT_TEXT = sql<string>`to_char(${products.updatedAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`

// The value every product write sets updated_at to (audit PR #125 L1). now() is the start of the transaction, so two
// writes in one transaction, or one microsecond, would store the same value and a form opened between them would
// still save over the newer stock. clock_timestamp() moves with the wall clock; the `+ 1 microsecond` arm keeps the
// value strictly increasing even if the clock reads the same microsecond or lags the stored value.
export const NEXT_UPDATED_AT = sql`greatest(clock_timestamp(), ${products.updatedAt} + interval '1 microsecond')`
