// node --test scripts/check-admin-bundle.test.mjs — bản build giả, không cần next build (audit PR #108 M-1).
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, test } from 'node:test'
import { adminShellProblems, bundleProblems } from './check-admin-bundle.mjs'

const EDIT_ID = '60aa'.padEnd(42, '0')
const LOGIN_ID = '40bb'.padEnd(42, '0')
const CART_ID = '40cc'.padEnd(42, '0')
const EDIT_WORKER = 'app/admin/(protected)/products/[slug]/page'
const dirs = []

const put = (root, rel, text) => {
  mkdirSync(dirname(join(root, rel)), { recursive: true })
  writeFileSync(join(root, rel), text)
}

const build = ({ editWorkers = [EDIT_WORKER], shopManifest = [CART_ID], shopHtml = 'chunks/shop.js', editPage = true } = {}) => {
  const root = mkdtempSync(join(tmpdir(), 'admin-bundle-'))
  dirs.push(root)
  const workers = (list) => Object.fromEntries(list.map((worker) => [worker, { moduleId: 1, async: true }]))
  const node = {
    [EDIT_ID]: { workers: workers(editWorkers), filename: 'src/features/products/actions.ts', exportedName: 'updateProductAction' },
    [LOGIN_ID]: { workers: workers(['app/admin/login/page']), filename: 'src/features/admin/actions.ts', exportedName: 'loginAction' },
    [CART_ID]: { workers: workers(['app/(shop)/page', EDIT_WORKER]), filename: 'src/features/cart/actions.ts', exportedName: 'addToCartAction' },
  }
  put(root, 'server/server-reference-manifest.json', JSON.stringify({ node, edge: {} }))
  put(root, 'server/app/(shop)/page/server-reference-manifest.json', JSON.stringify({ node: Object.fromEntries(shopManifest.map((id) => [id, {}])) }))
  if (editPage) put(root, `server/app/${EDIT_WORKER.slice(4)}/server-reference-manifest.json`, JSON.stringify({ node: { [EDIT_ID]: {} } }))
  put(root, 'static/chunks/form.js', `createServerReference("${EDIT_ID}")`)
  put(root, 'static/chunks/shop.js', 'shop')
  put(root, 'server/app/index.html', `<script src="/_next/static/${shopHtml}"></script>`)
  put(root, 'server/app/admin/products/[slug].html', '<script src="/_next/static/chunks/form.js"></script>')
  return root
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

test('a clean build has no problems', () => {
  assert.deepEqual(bundleProblems(build()), [])
})

test('an admin action with a shop worker is reported', () => {
  const problems = bundleProblems(build({ editWorkers: [EDIT_WORKER, 'app/(shop)/page'] }))
  assert.ok(problems.some((p) => p.includes('updateProductAction') && p.includes('app/(shop)/page')), problems.join('\n'))
})

test('a shop page manifest with the edit id is reported', () => {
  const problems = bundleProblems(build({ shopManifest: [CART_ID, EDIT_ID] }))
  assert.ok(problems.some((p) => p.startsWith('server/app/(shop)/page/server-reference-manifest.json')), problems.join('\n'))
})

test('shop HTML that loads the form chunk is reported', () => {
  const problems = bundleProblems(build({ shopHtml: 'chunks/form.js' }))
  assert.ok(problems.some((p) => p.includes('server/app/index.html') && p.includes('form.js')), problems.join('\n'))
})

test('a build where the check would be vacuous is reported', () => {
  assert.ok(bundleProblems(build({ editPage: false })).some((p) => p.includes('xanh vì rỗng')))
})

// Check 3 (ADR-0020, NS-133): every /admin route renders per request, so every script carries the proxy's nonce.
const EMPTY = { response: 'empty', htmlSize: 0 }
const SHELL = { response: 'initial', htmlSize: 9247 }
const prerender = ({ routes = {}, dynamicRoutes = {}, redirectStatus = 307 } = {}) => {
  const root = mkdtempSync(join(tmpdir(), 'admin-shell-'))
  dirs.push(root)
  const manifest = {
    routes: { '/admin': { response: 'complete', htmlSize: 12344 }, '/admin/login': EMPTY, '/admin/products': EMPTY, '/admin/errors': EMPTY, '/': SHELL, ...routes },
    dynamicRoutes: { '/admin/products/[slug]': EMPTY, '/admin/[...rest]': EMPTY, '/products/[slug]': SHELL, ...dynamicRoutes },
  }
  put(root, 'prerender-manifest.json', JSON.stringify(manifest))
  put(root, 'server/app/admin.meta', JSON.stringify({ status: redirectStatus, headers: { location: '/admin/products' } }))
  return root
}

test('admin routes without a static shell, and the /admin redirect, have no problems', () => {
  assert.deepEqual(adminShellProblems(prerender()), [])
})

test('an admin page with a prerendered shell is reported', () => {
  const problems = adminShellProblems(prerender({ routes: { '/admin/orders': SHELL } }))
  assert.deepEqual(problems.length, 1, problems.join('\n'))
  assert.ok(problems[0].startsWith('/admin/orders có vỏ prerender'), problems.join('\n'))
})

test('a dynamic admin route with a fallback shell, or a static one, is reported', () => {
  const problems = adminShellProblems(
    prerender({ dynamicRoutes: { '/admin/orders/[id]': SHELL }, routes: { '/admin/help': { response: 'complete', htmlSize: 800 } } }),
  )
  assert.ok(problems.some((p) => p.startsWith('/admin/orders/[id] có vỏ prerender')), problems.join('\n'))
  assert.ok(problems.some((p) => p.startsWith('/admin/help có vỏ prerender')), problems.join('\n'))
})

test('/admin is allowed only as a 307 redirect', () => {
  const problems = adminShellProblems(prerender({ redirectStatus: 200 }))
  assert.ok(problems.some((p) => p.startsWith('/admin có vỏ prerender')), problems.join('\n'))
})

test('a manifest without the admin routes, or without the catch-all, is reported', () => {
  const root = prerender()
  put(root, 'prerender-manifest.json', JSON.stringify({ routes: {}, dynamicRoutes: {} }))
  const problems = adminShellProblems(root)
  for (const route of ['/admin/login', '/admin/products', '/admin/errors', '/admin/[...rest]']) {
    assert.ok(problems.some((p) => p.includes(route) && p.includes('xanh vì rỗng')), problems.join('\n'))
  }
})

test('a manifest without /admin/errors is reported (NS-146)', () => {
  const root = prerender()
  const manifest = {
    routes: { '/admin': { response: 'complete', htmlSize: 12344 }, '/admin/login': EMPTY, '/admin/products': EMPTY },
    dynamicRoutes: { '/admin/[...rest]': EMPTY },
  }
  put(root, 'prerender-manifest.json', JSON.stringify(manifest))
  const problems = adminShellProblems(root)
  assert.deepEqual(problems.length, 1, problems.join('\n'))
  assert.ok(problems[0].includes('/admin/errors') && problems[0].includes('xanh vì rỗng'), problems.join('\n'))
})
