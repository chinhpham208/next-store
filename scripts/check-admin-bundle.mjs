#!/usr/bin/env node
// Sau `next build`: phần admin của feature products không lọt vào trang cửa hàng (audit PR #108 M-1).
//
//   node scripts/check-admin-bundle.mjs [thư-mục-.next]    # mặc định .next
//
// Kiểm trên bản build thật, vì Turbopack quyết định chunk nào đi theo trang nào; depcruise chỉ thấy import:
//   1. Mọi Server Action của src/features/products/actions.ts và src/features/admin/actions.ts chỉ có worker
//      dưới app/admin/ trong .next/server/server-reference-manifest.json, và id của nó không có trong manifest
//      riêng (server/app/**/server-reference-manifest.json) của route nào ngoài admin.
//   2. Chunk client chứa id của updateProductAction (chunk của ProductEditForm) không được HTML / RSC / meta
//      prerender nào ngoài server/app/admin/ tham chiếu, và id không nằm thẳng trong file nào ở đó.
// Kiểm cả chiều ngược để không xanh vì rỗng: id phải có trong manifest, chunk phải tồn tại, và trang sửa
// app/admin/(protected)/products/[slug] phải có id trong manifest riêng.
//   3. ADR-0020 (NS-133): mọi route /admin trong prerender-manifest.json không có vỏ tĩnh (`response: "empty"`,
//      htmlSize 0), tức là render theo request (ƒ) và mọi <script> mang nonce của proxy. Vỏ prerender (○ hay ◐ có
//      HTML) mang script không nonce: dưới CSP nonce của /admin trình duyệt chặn hết, trang không hydrate (audit PR
//      #105 L3, audit M5 L1). Ngoại lệ duy nhất: /admin, redirect tĩnh có .meta status 307 (trình duyệt theo Location,
//      không render HTML). Không xanh vì rỗng: /admin/login, /admin/products, /admin/errors (M6) và catch-all
//      /admin/[...rest] phải có.
// Mã thoát: 0 = sạch, 1 = có lỗi (in từng dòng), 2 = thiếu bản build.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const ADMIN_ACTION_FILES = new Set(['src/features/products/actions.ts', 'src/features/admin/actions.ts'])
const EDIT_ACTION = { filename: 'src/features/products/actions.ts', exportedName: 'updateProductAction' }
const EDIT_PAGE_MANIFEST = 'server/app/admin/(protected)/products/[slug]/page/server-reference-manifest.json'

const walk = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? walk(path) : [path]
  })

const posix = (path) => path.split(sep).join('/')

// The admin routes that must be in the manifest, so check 3 cannot pass on an empty one.
const REQUIRED_ADMIN_ROUTES = ['/admin/login', '/admin/products', '/admin/errors', '/admin/[...rest]']
const STATIC_REDIRECT = { route: '/admin', meta: 'server/app/admin.meta', status: 307 }
const isAdminRoute = (route) => route === '/admin' || route.startsWith('/admin/')

/** Check 3: no /admin route but the static redirect has a prerendered shell (ADR-0020, NS-133). */
export const adminShellProblems = (nextDir) => {
  const manifest = JSON.parse(readFileSync(join(nextDir, 'prerender-manifest.json'), 'utf8'))
  const entries = [...Object.entries(manifest.routes ?? {}), ...Object.entries(manifest.dynamicRoutes ?? {})].filter(
    ([route]) => isAdminRoute(route),
  )
  const problems = REQUIRED_ADMIN_ROUTES.filter((route) => !entries.some(([name]) => name === route)).map(
    (route) => `prerender-manifest.json không có ${route} (kiểm sẽ xanh vì rỗng)`,
  )
  for (const [route, entry] of entries) {
    if (entry.response === 'empty' && !(entry.htmlSize > 0)) continue
    if (route === STATIC_REDIRECT.route) {
      const meta = join(nextDir, STATIC_REDIRECT.meta)
      const status = existsSync(meta) ? JSON.parse(readFileSync(meta, 'utf8')).status : undefined
      if (status === STATIC_REDIRECT.status) continue
    }
    problems.push(`${route} có vỏ prerender (response ${entry.response}, htmlSize ${entry.htmlSize}): script không mang nonce (ADR-0020)`)
  }
  return problems
}
const isAdminOutput = (rel) => /^server\/app\/admin(\/|\.|$)/.test(rel)

export const bundleProblems = (nextDir) => {
  const problems = []
  const manifestPath = join(nextDir, 'server/server-reference-manifest.json')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const actions = Object.entries(manifest.node ?? {})

  const adminActions = actions.filter(([, entry]) => ADMIN_ACTION_FILES.has(entry.filename))
  for (const [, entry] of adminActions) {
    const outside = Object.keys(entry.workers ?? {}).filter((worker) => !worker.startsWith('app/admin/'))
    if (outside.length > 0) {
      problems.push(`${entry.exportedName} (${entry.filename}) có worker ngoài admin: ${outside.join(', ')}`)
    }
  }

  const edit = actions.find(([, e]) => e.filename === EDIT_ACTION.filename && e.exportedName === EDIT_ACTION.exportedName)
  if (edit === undefined) {
    problems.push(`không thấy ${EDIT_ACTION.exportedName} trong server-reference-manifest.json (kiểm sẽ xanh vì rỗng)`)
    return problems
  }
  const editId = edit[0]
  const adminIds = adminActions.map(([id]) => id)

  const serverApp = join(nextDir, 'server/app')
  const outputs = walk(serverApp).map((path) => ({ path, rel: posix(relative(nextDir, path)) }))

  for (const { path, rel } of outputs) {
    if (!rel.endsWith('/server-reference-manifest.json') || isAdminOutput(rel)) continue
    const text = readFileSync(path, 'utf8')
    for (const id of adminIds) if (text.includes(id)) problems.push(`${rel} chứa id action admin ${id.slice(0, 12)}…`)
  }

  const editManifest = join(nextDir, EDIT_PAGE_MANIFEST)
  if (!existsSync(editManifest) || !readFileSync(editManifest, 'utf8').includes(editId)) {
    problems.push(`${EDIT_PAGE_MANIFEST} không chứa id của ${EDIT_ACTION.exportedName} (kiểm sẽ xanh vì rỗng)`)
  }

  const chunkDir = join(nextDir, 'static/chunks')
  const formChunks = walk(chunkDir)
    .filter((path) => path.endsWith('.js') && readFileSync(path, 'utf8').includes(editId))
    .map((path) => posix(relative(chunkDir, path)))
  if (formChunks.length === 0) problems.push(`không chunk client nào chứa id của ${EDIT_ACTION.exportedName} (kiểm sẽ xanh vì rỗng)`)

  for (const { path, rel } of outputs) {
    if (isAdminOutput(rel) || !/\.(html|rsc|meta|body)$/.test(rel)) continue
    const text = readFileSync(path, 'utf8')
    if (text.includes(editId)) problems.push(`${rel} chứa id của ${EDIT_ACTION.exportedName}`)
    for (const chunk of formChunks) if (text.includes(chunk)) problems.push(`${rel} tải chunk form admin ${chunk}`)
  }
  return problems
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const nextDir = process.argv[2] ?? '.next'
  if (!existsSync(join(nextDir, 'server/server-reference-manifest.json'))) {
    console.error(`check-admin-bundle: không thấy bản build trong ${nextDir} (chạy next build trước)`)
    process.exit(2)
  }
  const problems = [...bundleProblems(nextDir), ...adminShellProblems(nextDir)]
  for (const problem of problems) console.error(`check-admin-bundle: ${problem}`)
  if (problems.length > 0) process.exit(1)
  console.log('check-admin-bundle: phần admin không có trong manifest hay HTML / RSC của route ngoài admin')
  console.log('check-admin-bundle: mọi route /admin render theo request (không vỏ prerender), trừ redirect /admin')
}
