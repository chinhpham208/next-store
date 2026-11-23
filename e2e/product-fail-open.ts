import type { APIRequestContext, APIResponse } from '@playwright/test'
import { isProductionUrl } from './production'
import { expect, test } from './test'

// NS-79 (ADR-0009, Hệ quả): on Vercel the proxy runs at the edge nearest the visitor, far from Neon in Singapore, so
// the database lookup of a well-formed product slug can outlast its 400 ms bound and fail open (200 instead of 404).
// Until the fix of M5, the Production E2E run tolerates that one case, as smoke does: same flag, set by
// .github/workflows/production-e2e.yml for both steps. The tolerance needs the flag AND a Production BASE_URL, so a
// preview, a local run or a stray export of the flag still requires the 404. Paths that never reach the database
// (`/khong-ton-tai`, blog slugs, malformed product slugs) do not use this helper: a 200 there is always a failure.
export const PRODUCT_FAIL_OPEN_FLAG = 'SMOKE_PRODUCT_FAIL_OPEN'

export const productFailOpenTolerated = (baseUrl: string | undefined, flag: string | undefined): boolean => {
  if (flag !== undefined && flag !== '' && flag !== 'warn')
    throw new Error(`${PRODUCT_FAIL_OPEN_FLAG} không hợp lệ: cần warn hoặc bỏ trống (có ${JSON.stringify(flag)})`)
  return flag === 'warn' && isProductionUrl(baseUrl)
}

const TOLERATED = productFailOpenTolerated(process.env.BASE_URL, process.env[PRODUCT_FAIL_OPEN_FLAG])

export const FAIL_OPEN_ANNOTATION = 'warning'

/**
 * GET of a well-formed product slug that does not exist, which must 404 on the first hit. Returns the 404 response
 * for the caller to check its content. When the run tolerates the NS-79 fail-open and the answer is 200, adds a
 * `warning` annotation with the time taken and returns undefined: the caller skips the checks of the 404 body.
 * Any other status fails the test.
 */
export const getUnknownProduct = async (
  request: APIRequestContext,
  path: string,
  options?: Parameters<APIRequestContext['get']>[1],
  tolerated: boolean = TOLERATED,
): Promise<APIResponse | undefined> => {
  const started = performance.now()
  const response = await request.get(path, options)
  const elapsed = Math.round(performance.now() - started)
  const status = response.status()
  if (tolerated && status === 200) {
    test.info().annotations.push({
      type: FAIL_OPEN_ANNOTATION,
      description: `GET ${path} trả 200 sau ${elapsed} ms: lookup DB của proxy fail-open (${PRODUCT_FAIL_OPEN_FLAG}=warn, NS-79)`,
    })
    return undefined
  }
  expect(status, `${path} (slug sản phẩm lạ, sau ${elapsed} ms)`).toBe(404)
  return response
}
