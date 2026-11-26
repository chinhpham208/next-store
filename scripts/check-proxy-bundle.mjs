#!/usr/bin/env node
// Sau `next build`: bundle của proxy và bundle edge của `instrumentation` không chứa mã DB (ADR-0022, C4; audit PR
// #120 L5; quy tắc 2 của retro M5). Kiểm 4 của `npm run check:bundle`.
//
//   node scripts/check-proxy-bundle.mjs [thư-mục-.next]    # mặc định .next
//
// Vì sao kiểm trên bản build: `proxy-no-db` của dependency-cruiser chỉ nhìn graph của src/proxy.ts; `import()` động có
// điều kiện lúc chạy (`src/instrumentation.ts`) không ngăn bundler gộp module vào bundle edge. Chỉ bản build thật cho
// biết chunk nào đi cùng bundle nào.
//
// Hai nơi, đều bắt buộc có (không xanh vì rỗng):
//   1. Proxy. Next.js 16 chạy proxy trên runtime `nodejs` mặc định: `server/middleware.js` nạp danh sách chunk bằng
//      `R.c("server/chunks/…")`; proxy chọn `runtime: 'edge'` thì danh sách nằm ở `server/middleware-manifest.json`
//      (`middleware.<tên>.files`). Cả hai dạng đều đọc; thiếu cả hai là lỗi. Bundle phải chứa mã của proxy (`/admin/login`).
//   2. Bundle edge của `instrumentation`: `server/instrumentation/middleware-manifest.json` (`instrumentation.files`).
//      Bundle node của `instrumentation` (`server/instrumentation.js`) KHÔNG kiểm: nó nạp phần ghi DB bằng `import()`.
// Chuỗi bị cấm: `drizzle`, `postgres`, `pglite` (không phân biệt hoa thường) trong mọi file .js của hai bundle.
// Mã thoát: 0 = sạch, 1 = có lỗi (in từng dòng), 2 = thiếu bản build.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const FORBIDDEN = /drizzle|postgres|pglite/i
// A string only the proxy has (the redirect target of a visitor without a session, ADR-0018): a bundle without it is
// not the proxy's, so a clean result would be an empty one.
const PROXY_MARKER = '/admin/login'

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'))

// `R.c("server/chunks/[root-of-the-server]__x._.js")` lines of the Node.js entry, plus the entry and the runtime.
const nodeProxyFiles = (nextDir) => {
  const entry = join(nextDir, 'server/middleware.js')
  if (!existsSync(entry)) return undefined
  const chunks = [...readFileSync(entry, 'utf8').matchAll(/R\.c\("([^"]+)"\)/g)].map((match) => match[1])
  return ['server/middleware.js', 'server/chunks/[turbopack]_runtime.js', ...chunks]
}

const edgeProxyFiles = (nextDir) => {
  const manifest = join(nextDir, 'server/middleware-manifest.json')
  if (!existsSync(manifest)) return undefined
  const entries = Object.values(readJson(manifest).middleware ?? {})
  if (entries.length === 0) return undefined
  return entries.flatMap((entry) => entry.files ?? [])
}

const instrumentationEdgeFiles = (nextDir) => {
  const manifest = join(nextDir, 'server/instrumentation/middleware-manifest.json')
  if (!existsSync(manifest)) return undefined
  return readJson(manifest).instrumentation?.files
}

const scan = (nextDir, label, files) => {
  const problems = []
  let text = ''
  for (const file of files) {
    const path = join(nextDir, file)
    if (!file.endsWith('.js')) continue
    if (!existsSync(path)) {
      problems.push(`${label}: không thấy file ${file} (danh sách chunk lệch bản build)`)
      continue
    }
    const content = readFileSync(path, 'utf8')
    text += content
    const found = FORBIDDEN.exec(content)
    if (found !== null) problems.push(`${label} chứa mã DB (${found[0]}) trong ${file}`)
  }
  return { problems, text }
}

export const proxyBundleProblems = (nextDir) => {
  const problems = []

  const proxyFiles = edgeProxyFiles(nextDir) ?? nodeProxyFiles(nextDir)
  if (proxyFiles === undefined) {
    problems.push('không thấy proxy: server/middleware-manifest.json không có middleware và không có server/middleware.js (kiểm sẽ xanh vì rỗng)')
  } else {
    const proxy = scan(nextDir, 'bundle proxy', proxyFiles)
    problems.push(...proxy.problems)
    if (!proxy.text.includes(PROXY_MARKER)) {
      problems.push(`bundle proxy không chứa mã của proxy (${PROXY_MARKER}): danh sách file sai, kiểm sẽ xanh vì rỗng`)
    }
  }

  const edgeFiles = instrumentationEdgeFiles(nextDir)
  if (edgeFiles === undefined || edgeFiles.length === 0) {
    problems.push(
      'không thấy bundle edge của instrumentation: server/instrumentation/middleware-manifest.json không có `instrumentation.files` (kiểm sẽ xanh vì rỗng)',
    )
  } else {
    problems.push(...scan(nextDir, 'bundle edge của instrumentation', edgeFiles).problems)
  }
  return problems
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const nextDir = process.argv[2] ?? '.next'
  if (!existsSync(join(nextDir, 'server'))) {
    console.error(`check-proxy-bundle: không thấy bản build trong ${nextDir} (chạy next build trước)`)
    process.exit(2)
  }
  const problems = proxyBundleProblems(nextDir)
  for (const problem of problems) console.error(`check-proxy-bundle: ${problem}`)
  if (problems.length > 0) process.exit(1)
  console.log('check-proxy-bundle: bundle proxy và bundle edge của instrumentation không có drizzle, postgres, pglite')
}
