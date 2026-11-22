// Where the suite runs against Production (M3 Task 17). The only place the suite names the production domain:
// a domain change is made here and in .github/workflows/production-e2e.yml (PRODUCTION_URL).
export const PRODUCTION_ORIGINS = ['https://next-store-iota-silk.vercel.app'] as const

// Tests that write data (add to cart, place an order, edit a product — from M4) carry this tag; Production skips them.
export const WRITE_TAG = '@ghi'

// Compared by origin: scheme, host and port must match exactly (URL lower-cases the host, drops a trailing `/`).
export const isProductionUrl = (baseUrl: string | undefined): boolean => {
  if (!baseUrl) return false
  try {
    const { origin } = new URL(baseUrl)
    return PRODUCTION_ORIGINS.some((production) => production === origin)
  } catch {
    return false
  }
}

// `grepInvert` of playwright.config.ts: on Production every test tagged WRITE_TAG is left out of the run.
export const grepInvertFor = (baseUrl: string | undefined): RegExp | undefined =>
  isProductionUrl(baseUrl) ? new RegExp(WRITE_TAG) : undefined
