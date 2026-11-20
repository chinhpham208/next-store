import { defineConfig, devices } from '@playwright/test'

const BASE_URL = process.env.BASE_URL
const BYPASS_SECRET = process.env.VERCEL_AUTOMATION_BYPASS_SECRET
// Only for machines that cannot download Playwright's Chromium (e.g. PW_CHANNEL=chrome); CI uses the bundled one.
const CHANNEL = process.env.PW_CHANNEL || undefined
// E2E_PORT only moves the pair of local servers off 3100 (e.g. when scripts/verify.sh holds it); CI uses the default.
const LOCAL_PORT = Number(process.env.E2E_PORT) || 3100
const BROKEN_DB_PORT = LOCAL_PORT + 1
// Nothing listens on port 9, so every query fails at once (no 10 s connect wait); a local host needs no TLS.
const BROKEN_DATABASE_URL = 'postgres://ns:ns@127.0.0.1:9/ns'

// Second server of the same build with a dead database, for the US-05 error page (M2 Task 15). Only exists
// without BASE_URL: a deployed database cannot be switched off, so the specs that use it skip there.
export const BROKEN_DB_URL = `http://localhost:${BROKEN_DB_PORT}`

export default defineConfig({
  testDir: 'e2e',
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: BASE_URL ?? `http://localhost:${LOCAL_PORT}`,
    channel: CHANNEL,
    trace: 'retain-on-failure',
    // Previews sit behind Vercel Deployment Protection; the header is the documented automation bypass.
    extraHTTPHeaders: BYPASS_SECRET ? { 'x-vercel-protection-bypass': BYPASS_SECRET } : undefined,
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
          command: `npm run start -- -p ${BROKEN_DB_PORT}`,
          url: BROKEN_DB_URL,
          env: { DATABASE_URL: BROKEN_DATABASE_URL },
          reuseExistingServer: false,
          timeout: 60_000,
        },
      ],
})
