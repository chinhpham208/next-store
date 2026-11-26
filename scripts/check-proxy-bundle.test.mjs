// node --test scripts/check-proxy-bundle.test.mjs — bản build giả, không cần next build (ADR-0022, audit PR #120 L5).
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, test } from 'node:test'
import { proxyBundleProblems } from './check-proxy-bundle.mjs'

const dirs = []

const put = (root, rel, text) => {
  mkdirSync(dirname(join(root, rel)), { recursive: true })
  writeFileSync(join(root, rel), text)
}

const PROXY_CODE = 'redirect("/admin/login")'
const CLEAN_EDGE = 'onRequestError monitoring: request error'

// `proxy`: 'node' (Next.js 16 default: server/middleware.js + R.c lines), 'edge' (middleware-manifest.json) or 'none'.
const build = ({ proxy = 'node', proxyCode = PROXY_CODE, edgeCode = CLEAN_EDGE, edgeManifest = true, extraProxyChunk = '' } = {}) => {
  const root = mkdtempSync(join(tmpdir(), 'proxy-bundle-'))
  dirs.push(root)
  if (proxy === 'node') {
    put(
      root,
      'server/middleware.js',
      'var R=require("./chunks/[turbopack]_runtime.js")("server/middleware.js")\nR.c("server/chunks/[externals]__a._.js")\nR.c("server/chunks/[root-of-the-server]__b._.js")\n',
    )
    put(root, 'server/chunks/[turbopack]_runtime.js', 'runtime')
    put(root, 'server/chunks/[externals]__a._.js', 'module.exports=[]')
    put(root, 'server/chunks/[root-of-the-server]__b._.js', `${proxyCode}${extraProxyChunk}`)
    put(root, 'server/middleware-manifest.json', JSON.stringify({ version: 3, middleware: {}, sortedMiddleware: [], functions: {} }))
  } else if (proxy === 'edge') {
    put(root, 'server/edge/chunks/proxy.js', `${proxyCode}${extraProxyChunk}`)
    put(
      root,
      'server/middleware-manifest.json',
      JSON.stringify({ version: 3, middleware: { '/': { files: ['server/edge/chunks/proxy.js'], name: 'middleware' } } }),
    )
  }
  // The Node.js bundle of instrumentation is allowed to hold the database: it loads it with import().
  put(root, 'server/chunks/instrumentation-node.js', 'import("drizzle-orm") postgres pglite')
  put(root, 'server/instrumentation.js', 'R.c("server/chunks/instrumentation-node.js")')
  put(root, 'server/edge/chunks/instrumentation.js', edgeCode)
  if (edgeManifest) {
    put(
      root,
      'server/instrumentation/middleware-manifest.json',
      JSON.stringify({ middleware: {}, instrumentation: { files: ['server/edge/chunks/instrumentation.js'], name: 'instrumentation' } }),
    )
  }
  return root
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

test('passes on a bundle without database code', () => {
  assert.deepEqual(proxyBundleProblems(build()), [])
  assert.deepEqual(proxyBundleProblems(build({ proxy: 'edge' })), [])
})

test('fails when the proxy bundle contains drizzle', () => {
  for (const proxy of ['node', 'edge']) {
    const problems = proxyBundleProblems(build({ proxy, extraProxyChunk: ';Symbol.for("drizzle:entityKind")' }))
    assert.ok(problems.some((p) => p.startsWith('bundle proxy chứa mã DB (drizzle)')), `${proxy}: ${problems.join('\n')}`)
  }
})

test('fails when the proxy bundle contains postgres or pglite, in any case', () => {
  assert.ok(proxyBundleProblems(build({ extraProxyChunk: 'require("postgres")' })).some((p) => p.includes('(postgres)')))
  assert.ok(proxyBundleProblems(build({ extraProxyChunk: 'import("@electric-sql/PGlite")' })).some((p) => p.includes('(PGlite)')))
})

test('fails when the proxy is missing from the manifest', () => {
  const problems = proxyBundleProblems(build({ proxy: 'none' }))
  assert.ok(problems.some((p) => p.startsWith('không thấy proxy') && p.includes('xanh vì rỗng')), problems.join('\n'))
})

test('fails when the proxy file list does not lead to the proxy code', () => {
  const problems = proxyBundleProblems(build({ proxyCode: 'unrelated' }))
  assert.ok(problems.some((p) => p.includes('không chứa mã của proxy')), problems.join('\n'))
})

test('fails when the edge bundle of instrumentation contains database code', () => {
  const problems = proxyBundleProblems(build({ edgeCode: 'x;import("postgres")' }))
  assert.ok(problems.some((p) => p.startsWith('bundle edge của instrumentation chứa mã DB (postgres)')), problems.join('\n'))
})

test('fails when the edge bundle of instrumentation is missing from its manifest', () => {
  const problems = proxyBundleProblems(build({ edgeManifest: false }))
  assert.ok(problems.some((p) => p.startsWith('không thấy bundle edge của instrumentation')), problems.join('\n'))
})

test('fails when a listed chunk is not on disk', () => {
  const root = build()
  rmSync(join(root, 'server/chunks/[root-of-the-server]__b._.js'))
  assert.ok(proxyBundleProblems(root).some((p) => p.includes('không thấy file')))
})

test('follows a chunk that a listed chunk loads at run time (dynamic import)', () => {
  for (const proxy of ['node', 'edge']) {
    const dir = proxy === 'node' ? 'server/chunks' : 'server/edge/chunks'
    const root = build({ proxy, extraProxyChunk: `;e.l("${dir}/lazy._.js")` })
    put(root, `${dir}/lazy._.js`, 'x;Symbol.for("drizzle:entityKind")')
    const problems = proxyBundleProblems(root)
    assert.ok(problems.some((p) => p.startsWith('bundle proxy chứa mã DB (drizzle)') && p.includes('lazy._.js')), `${proxy}: ${problems.join('\n')}`)
  }
})

test('follows chunks of chunks, and a lazy chunk that is not on disk is reported', () => {
  const root = build({ extraProxyChunk: ';e.l("server/chunks/one._.js")' })
  put(root, 'server/chunks/one._.js', 'e.l("server/chunks/two._.js")')
  assert.ok(proxyBundleProblems(root).some((p) => p.includes('không thấy file server/chunks/two._.js')))
  put(root, 'server/chunks/two._.js', 'require("postgres")')
  assert.ok(proxyBundleProblems(root).some((p) => p.includes('(postgres)') && p.includes('two._.js')))
})

test('does not loop on chunks that name each other', () => {
  const root = build({ extraProxyChunk: ';e.l("server/chunks/a._.js")' })
  put(root, 'server/chunks/a._.js', 'e.l("server/chunks/b._.js")')
  put(root, 'server/chunks/b._.js', 'e.l("server/chunks/a._.js")')
  assert.deepEqual(proxyBundleProblems(root), [])
})
