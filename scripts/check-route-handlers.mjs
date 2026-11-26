#!/usr/bin/env node
// Sau `next build`: danh sách route handler của bản build đúng bằng allowlist (ADR-0021; quy tắc 2 của retro M5).
// Kiểm 5 của `npm run check:bundle`.
//
//   node scripts/check-route-handlers.mjs [thư-mục-.next]    # mặc định .next
//
// Route handler duy nhất của repo là POST /api/webhooks/payment; ngoài nó chỉ có route metadata do Next.js sinh
// (`sitemap.xml`, `robots.txt`, `favicon.ico`, ảnh `opengraph-image` của `/`, `/products/[slug]`, `/blog/[slug]`).
// Một route handler thứ hai, hay một route dưới /admin, là lỗi: cần ADR mới và sửa allowlist cùng PR (Vitest tĩnh
// `src/route-handlers.test.ts` giữ cùng quy tắc trên mã nguồn; kiểm này nhìn bản build thật).
// Thiếu webhook cũng là lỗi: một manifest rỗng hay sai chỗ không được xanh vì rỗng.
// Mã thoát: 0 = đúng allowlist, 1 = có lỗi (in từng dòng), 2 = thiếu bản build.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const WEBHOOK_ROUTE = '/api/webhooks/payment/route'

// Hậu tố băm của ảnh metadata (`opengraph-image-16g1u1`) đổi theo nội dung, nên khớp theo mẫu.
const HASH = '(?:-[a-z0-9]{1,12})?'
const ALLOWED = [
  new RegExp(`^${WEBHOOK_ROUTE}$`),
  /^\/(?:sitemap\.xml|robots\.txt|favicon\.ico)\/route$/,
  new RegExp(`^/opengraph-image${HASH}/route$`),
  new RegExp(`^/\\(shop\\)/(?:products|blog)/\\[slug\\]/opengraph-image${HASH}/route$`),
]

/** Route handlers (khoá kết thúc bằng /route) của một app-paths-manifest, đưa về mảng. */
export const routeHandlersOf = (manifest) => Object.keys(manifest).filter((key) => key.endsWith('/route'))

export const routeHandlerProblems = (nextDir) => {
  const path = join(nextDir, 'server/app-paths-manifest.json')
  if (!existsSync(path)) return [`không thấy ${path} (kiểm sẽ xanh vì rỗng)`]
  const routes = routeHandlersOf(JSON.parse(readFileSync(path, 'utf8')))
  const problems = []
  if (!routes.includes(WEBHOOK_ROUTE)) {
    problems.push(`bản build không có route handler ${WEBHOOK_ROUTE}: webhook thanh toán thiếu (kiểm sẽ xanh vì rỗng)`)
  }
  for (const route of routes) {
    if (!ALLOWED.some((pattern) => pattern.test(route))) problems.push(`route handler ngoài allowlist: ${route}`)
  }
  return problems
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const nextDir = process.argv[2] ?? '.next'
  if (!existsSync(join(nextDir, 'server'))) {
    console.error(`check-route-handlers: không thấy bản build trong ${nextDir} (chạy next build trước)`)
    process.exit(2)
  }
  const problems = routeHandlerProblems(nextDir)
  for (const problem of problems) console.error(`check-route-handlers: ${problem}`)
  if (problems.length > 0) process.exit(1)
  console.log('check-route-handlers: route handler của bản build đúng allowlist (webhook thanh toán + route metadata)')
}
