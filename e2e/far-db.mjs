// NS-109: preloaded (`node --import`) into one `next start` of the E2E run, never into the app. Every PGlite query
// waits FAR_DB_LATENCY_MS first, like Neon seen from a far Vercel edge (NS-79, ADR-0009): the proxy's slug lookup
// outlasts its 400 ms bound and fails open, so a well-formed unknown slug reaches its route, while the route's own
// queries still answer well within DB_QUERY_TIMEOUT_MS. PGlite is a server external (next.config.ts), so the build
// imports this same module instance through the symlink in .next/node_modules.
import { PGlite } from '@electric-sql/pglite'

const LATENCY_MS = 600

const query = PGlite.prototype.query
PGlite.prototype.query = async function delayedQuery(...args) {
  await new Promise((resolve) => setTimeout(resolve, LATENCY_MS))
  return query.apply(this, args)
}
