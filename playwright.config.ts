import { defineConfig, devices } from '@playwright/test'

const BASE_URL = process.env.BASE_URL
const BYPASS_SECRET = process.env.VERCEL_AUTOMATION_BYPASS_SECRET
// Only for machines that cannot download Playwright's Chromium (e.g. PW_CHANNEL=chrome); CI uses the bundled one.
const CHANNEL = process.env.PW_CHANNEL || undefined
const LOCAL_PORT = 3100

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
    : {
        command: `npm run start -- -p ${LOCAL_PORT}`,
        url: `http://localhost:${LOCAL_PORT}`,
        reuseExistingServer: false,
        timeout: 60_000,
      },
})
