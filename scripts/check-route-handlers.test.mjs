// node --test scripts/check-route-handlers.test.mjs — bản build giả, không cần next build (ADR-0021).
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, test } from 'node:test'
import { routeHandlerProblems } from './check-route-handlers.mjs'

const dirs = []

// The keys a real `next build` writes into app-paths-manifest.json (next 16.4.6): pages and the metadata routes.
const ALLOWLIST_KEYS = [
  '/(shop)/page',
  '/admin/(protected)/products/page',
  '/api/webhooks/payment/route',
  '/sitemap.xml/route',
  '/robots.txt/route',
  '/favicon.ico/route',
  '/opengraph-image/route',
  '/(shop)/products/[slug]/opengraph-image-16g1u1/route',
  '/(shop)/blog/[slug]/opengraph-image-11vtts/route',
]

const build = (keys) => {
  const root = mkdtempSync(join(tmpdir(), 'route-handlers-'))
  dirs.push(root)
  mkdirSync(join(root, 'server'), { recursive: true })
  writeFileSync(
    join(root, 'server/app-paths-manifest.json'),
    JSON.stringify(Object.fromEntries(keys.map((key) => [key, `app${key}.js`]))),
  )
  return root
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

test('passes on the allowlist', () => {
  assert.deepEqual(routeHandlerProblems(build(ALLOWLIST_KEYS)), [])
})

test('fails on an extra route', () => {
  for (const extra of ['/api/other/route', '/(shop)/cart/route', '/admin/(protected)/orders/route', '/api/webhooks/payment/extra/route']) {
    const problems = routeHandlerProblems(build([...ALLOWLIST_KEYS, extra]))
    assert.deepEqual(problems, [`route handler ngoài allowlist: ${extra}`])
  }
})

test('fails when the webhook is missing', () => {
  const problems = routeHandlerProblems(build(ALLOWLIST_KEYS.filter((key) => key !== '/api/webhooks/payment/route')))
  assert.equal(problems.length, 1)
  assert.match(problems[0], /webhook thanh toán thiếu/)
})

test('fails on an empty manifest and on a missing one, never green for nothing', () => {
  assert.ok(routeHandlerProblems(build([])).some((p) => p.includes('webhook thanh toán thiếu')))
  const empty = mkdtempSync(join(tmpdir(), 'route-handlers-'))
  dirs.push(empty)
  assert.ok(routeHandlerProblems(empty).some((p) => p.includes('xanh vì rỗng')))
})
