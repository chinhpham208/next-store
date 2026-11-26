import 'server-only'
import { sql } from 'drizzle-orm'
import { products } from '@/db'

// products.updated_at as text, UTC to the microsecond (timestamptz precision). A Date holds milliseconds only, and
// the admin save compares the form's value exactly with the column (conflict check, ADR-0019 13A), so the admin
// read and the save's RETURNING both use this one expression.
export const UPDATED_AT_TEXT = sql<string>`to_char(${products.updatedAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`
