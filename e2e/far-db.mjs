// NS-109: preloaded (`node --import`) into one `next start` of the E2E run and into scripts/smoke-fail-open.sh, never
// into the app. Every PGlite query waits LATENCY_MS first, like Neon seen from a far Vercel edge (NS-79). Until
// ADR-0017 the proxy's slug lookup outlasted its 400 ms bound and failed open here; now the proxy never queries, so an
// unknown product slug must still get its 404 at once, while the routes' own queries answer well within
// DB_QUERY_TIMEOUT_MS. PGlite is a server external (next.config.ts), so the build
// imports this same module instance through the symlink in .next/node_modules.
import { PGlite } from '@electric-sql/pglite'

const LATENCY_MS = 600

const query = PGlite.prototype.query
PGlite.prototype.query = async function delayedQuery(...args) {
  await new Promise((resolve) => setTimeout(resolve, LATENCY_MS))
  return query.apply(this, args)
}
