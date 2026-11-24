import { defineConfig, devices } from '@playwright/test'
import { RUN_BYPASS } from './e2e/bypass'
import { grepInvertFor } from './e2e/production'

const BASE_URL = process.env.BASE_URL
// Only for machines that cannot download Playwright's Chromium (e.g. PW_CHANNEL=chrome); CI uses the bundled one.
const CHANNEL = process.env.PW_CHANNEL || undefined
// E2E_PORT moves the five local servers (E2E_PORT … E2E_PORT + 4) off 3100, e.g. when scripts/verify.sh holds it;
// CI uses the default.
const LOCAL_PORT = Number(process.env.E2E_PORT) || 3100
const BROKEN_DB_PORT = LOCAL_PORT + 1
const HUNG_DB_PORT = LOCAL_PORT + 2
const SILENT_TCP_PORT = LOCAL_PORT + 3
const FAR_DB_PORT = LOCAL_PORT + 4
// Nothing listens on port 9, so every query fails at once (no 10 s connect wait); a local host needs no TLS.
const BROKEN_DATABASE_URL = 'postgres://ns:ns@127.0.0.1:9/ns'
// The silent listener accepts the connection and never answers, like a database that hangs (NS-55).
const HUNG_DATABASE_URL = `postgres://ns:ns@127.0.0.1:${SILENT_TCP_PORT}/ns`
// Short limit so the test shows the page gives up on its own, long before connect_timeout (10 s).
const HUNG_DB_QUERY_TIMEOUT_MS = '1000'

// Second server of the same build with a dead database, for the US-05 error page (M2 Task 15). Only exists
// without BASE_URL: a deployed database cannot be switched off, so the specs that use it skip there.
export const BROKEN_DB_URL = `http://localhost:${BROKEN_DB_PORT}`
// Third server of the same build whose database accepts TCP and never replies (NS-55).
export const HUNG_DB_URL = `http://localhost:${HUNG_DB_PORT}`
// Server output of the two, read by the NS-55 specs: no SQL, params or host:port may reach it.
export const BROKEN_DB_LOG = '.verify/e2e-broken-db.log'
export const HUNG_DB_LOG = '.verify/e2e-hung-db.log'
// Fifth server of the same build whose every query first waits like a far database (e2e/far-db.mjs, NS-109): the
// proxy's slug lookup fails open on every unknown product slug, as on Production from a far edge (NS-79).
export const FAR_DB_URL = `http://localhost:${FAR_DB_PORT}`
export const FAR_DB_LOG = '.verify/e2e-far-db.log'
// PGlite has no cross-process lock (next.config.ts): two servers on one data directory corrupt it, so this server
// reads a copy of the seeded database made when it starts.
const FAR_DB_PGLITE_DIR = '.verify/e2e-far-db-pglite'

export default defineConfig({
  testDir: 'e2e',
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  // On Production the tests tagged @ghi (they write data) are left out; e2e/test.ts blocks any write that is left.
  grepInvert: grepInvertFor(BASE_URL),
  use: {
    baseURL: BASE_URL ?? `http://localhost:${LOCAL_PORT}`,
    channel: CHANNEL,
    // A trace records request headers, the bypass secret included: never while the bypass is on (audit PR #61 L1;
    // with tracing turned back on, the fixtures of e2e/test.ts refuse to add the bypass, in hooks too).
    trace: RUN_BYPASS ? 'off' : 'retain-on-failure',
    // No extraHTTPHeaders: they go to every origin. The Deployment Protection bypass of previews is added by the
    // fixtures of e2e/test.ts, only for the origin of BASE_URL (NS-54, e2e/bypass.ts).
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } } },
    {
      name: 'mobile',
      use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
    },
  ],
  // A deployed BASE_URL is tested as is; locally the production build from `npm run build` is served.
  webServer: BASE_URL
    ? undefined
    : [
        {
          command: `npm run start -- -p ${LOCAL_PORT}`,
          url: `http://localhost:${LOCAL_PORT}`,
          reuseExistingServer: false,
          timeout: 60_000,
        },
        {
          command: `mkdir -p .verify && npm run start -- -p ${BROKEN_DB_PORT} > ${BROKEN_DB_LOG} 2>&1`,
          url: BROKEN_DB_URL,
          env: { DATABASE_URL: BROKEN_DATABASE_URL },
          reuseExistingServer: false,
          timeout: 60_000,
        },
        {
          command: `node -e "require('net').createServer(() => {}).listen(${SILENT_TCP_PORT}, '127.0.0.1')"`,
          port: SILENT_TCP_PORT,
          reuseExistingServer: false,
          timeout: 10_000,
        },
        {
          command: `mkdir -p .verify && npm run start -- -p ${HUNG_DB_PORT} > ${HUNG_DB_LOG} 2>&1`,
          url: HUNG_DB_URL,
          env: { DATABASE_URL: HUNG_DATABASE_URL, DB_QUERY_TIMEOUT_MS: HUNG_DB_QUERY_TIMEOUT_MS },
          reuseExistingServer: false,
          timeout: 60_000,
        },
        {
          command: `mkdir -p .verify && rm -rf ${FAR_DB_PGLITE_DIR} && cp -R .data/pglite ${FAR_DB_PGLITE_DIR} && npm run start -- -p ${FAR_DB_PORT} > ${FAR_DB_LOG} 2>&1`,
          url: FAR_DB_URL,
          env: { NODE_OPTIONS: '--import ./e2e/far-db.mjs', PGLITE_DATA_DIR: FAR_DB_PGLITE_DIR },
          reuseExistingServer: false,
          timeout: 60_000,
        },
      ],
})
