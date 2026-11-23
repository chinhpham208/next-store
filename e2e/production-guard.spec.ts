import { readdirSync, readFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { BrowserContext, Page } from '@playwright/test'
import { VIEWPORT_INDEPENDENT } from './catalog'
import { grepInvertFor, isProductionUrl, PRODUCTION_ORIGINS } from './production'
import { expect, guardContext, READ_ONLY_MESSAGE, readOnlyRequest, test, withWriteGuard } from './test'

// M3 Task 17, Review Focus 9: E2E on Production must never write. Runs in every environment (local, preview,
// Production) and never sends a request off this machine: the guard is switched to production mode by hand, or by a
// production baseURL that is never visited, and every request goes to the Node server below, which records what it
// received.
test.skip(({ isMobile }) => isMobile, VIEWPORT_INDEPENDENT)

const PRODUCTION = PRODUCTION_ORIGINS[0]
let server: Server
let local = ''
const received: string[] = []

test.beforeAll(async () => {
  server = createServer((request, response) => {
    received.push(`${request.method} ${request.url}`)
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end('<!doctype html><title>guard</title>')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  local = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
test.afterAll(async () => {
  await new Promise((resolve) => server.close(resolve))
})
test.beforeEach(() => {
  received.length = 0
})

const writesReceived = () => received.filter((entry) => !/^(GET|HEAD|OPTIONS) /.test(entry))

// fetch from the page: resolves to the status, or 'huỷ' when the request never got an answer.
const send = (page: Page, method: string, path = '/x') =>
  page.evaluate(
    ([path, method]) =>
      fetch(path, { method }).then(
        (response) => response.status,
        () => 'huỷ',
      ),
    [path, method] as const,
  )

const openLocal = async (context: BrowserContext) => {
  const page = await context.newPage()
  await page.goto(local)
  return page
}

test('isProductionUrl nhận đúng origin production', () => {
  expect(isProductionUrl('https://next-store-iota-silk.vercel.app')).toBe(true)
  expect(isProductionUrl('https://NEXT-STORE-IOTA-SILK.vercel.app/')).toBe(true)
  for (const url of [
    undefined,
    '',
    'http://localhost:3100',
    'https://next-store-dev-ginpham.vercel.app',
    'https://next-store-iota-silk.vercel.app.evil.example',
    'http://next-store-iota-silk.vercel.app',
    'không phải url',
  ])
    expect(isProductionUrl(url), String(url)).toBe(false)
})

test('bỏ qua test gắn @ghi trên Production', () => {
  expect(grepInvertFor('https://next-store-iota-silk.vercel.app')?.test('thêm vào giỏ @ghi')).toBe(true)
  expect(grepInvertFor('https://next-store-iota-silk.vercel.app')?.test('US-01: trang chủ hiện 6 sản phẩm')).toBe(false)
  expect(grepInvertFor('http://localhost:3100')).toBeUndefined()
})

test.describe('bộ chặn ghi ở chế độ Production (server local)', () => {
  let context: BrowserContext
  let opened: BrowserContext | undefined
  test.beforeEach(async ({ browser }) => {
    context = opened = await browser.newContext()
  })
  // Also runs for the tests the mobile project skips, when beforeEach did not.
  test.afterEach(async () => {
    await opened?.close()
    opened = undefined
  })

  test('chặn mọi request không phải GET / HEAD khi chạy trên Production', async () => {
    const guard = await guardContext(context)
    const page = await openLocal(context)
    expect(await send(page, 'POST')).toBe('huỷ')
    expect(await send(page, 'DELETE')).toBe('huỷ')
    expect(await send(page, 'GET')).toBe(200)
    expect(writesReceived()).toEqual([])
    expect(guard.writes()).toEqual([`POST ${local}/x`, `DELETE ${local}/x`])
    expect(() => guard.assertNoWrites()).toThrow(READ_ONLY_MESSAGE)
  })

  test('context.request và page.request không gửi được request ghi', async () => {
    await guardContext(context)
    const page = await context.newPage()
    for (const request of [context.request, page.request]) {
      expect(() => request.post(`${local}/x`)).toThrow(READ_ONLY_MESSAGE)
      expect(() => request.put(`${local}/x`)).toThrow(READ_ONLY_MESSAGE)
      expect(() => request.patch(`${local}/x`)).toThrow(READ_ONLY_MESSAGE)
      expect(() => request.delete(`${local}/x`)).toThrow(READ_ONLY_MESSAGE)
      expect(() => request.fetch(`${local}/x`, { method: 'POST' })).toThrow(READ_ONLY_MESSAGE)
      expect((await request.get(`${local}/x`)).status()).toBe(200)
    }
    expect(writesReceived()).toEqual([])
  })

  test('request ghi đi qua route.continue() của spec vẫn bị ghi nhận', async () => {
    const guard = await guardContext(context)
    const page = await openLocal(context)
    // A page route registered after the guard runs first, so continue() sends the request: it is not prevented
    // (the server receives it), only recorded, and the test fails at teardown.
    await page.route('**/x', (route) => route.continue())
    expect(await send(page, 'POST')).toBe(200)
    expect(writesReceived()).toEqual(['POST /x'])
    expect(guard.writes()).toEqual([`POST ${local}/x`])
  })

  test('teardown ném lỗi khi có request ghi, im lặng khi chỉ đọc', async ({ browser }) => {
    const write = async (guarded: BrowserContext) => void (await send(await openLocal(guarded), 'POST'))
    const read = async (guarded: BrowserContext) => void (await send(await openLocal(guarded), 'GET'))
    await expect(withWriteGuard(context, true, write)).rejects.toThrow(
      `${READ_ONLY_MESSAGE}: đã chặn hoặc ghi nhận POST ${local}/x`,
    )
    const reader = await browser.newContext()
    try {
      await expect(withWriteGuard(reader, true, read)).resolves.toBeUndefined()
    } finally {
      await reader.close()
    }
    expect(writesReceived()).toEqual([])
  })

  test('ngoài Production bộ chặn không làm gì', async () => {
    await withWriteGuard(context, false, async (open) => {
      expect(await send(await openLocal(open), 'POST')).toBe(200)
    })
    expect(writesReceived()).toEqual(['POST /x'])
  })
})

test('request fixture trên Production không gửi được post / put / patch / delete', ({ request }) => {
  const guarded = readOnlyRequest(request)
  expect(() => guarded.post('/products')).toThrow(READ_ONLY_MESSAGE)
  expect(() => guarded.put('/products')).toThrow(READ_ONLY_MESSAGE)
  expect(() => guarded.patch('/products')).toThrow(READ_ONLY_MESSAGE)
  expect(() => guarded.delete('/products')).toThrow(READ_ONLY_MESSAGE)
  expect(() => guarded.fetch('/products', { method: 'POST' })).toThrow(READ_ONLY_MESSAGE)
})

// The fixtures themselves, with a production baseURL that is never visited: pages open the local server by its full
// URL. test.fail(): the body passes, so the only failure left is the fixture's teardown.
test.describe('fixture với baseURL production', () => {
  test.use({ baseURL: PRODUCTION })

  test('fixture context, page, request được bọc', async ({ context, page, request }) => {
    for (const client of [context.request, page.request, request])
      expect(() => client.post(`${local}/x`)).toThrow(READ_ONLY_MESSAGE)
    await page.goto(local)
    expect(await send(page, 'POST')).toBe('huỷ')
    expect(writesReceived()).toEqual([])
    test.fail(true, 'teardown của fixture context phải ném READ_ONLY_MESSAGE')
  })

  test('newContext có cùng bộ chặn và teardown ném lỗi', async ({ newContext }) => {
    const context = await newContext()
    expect(() => context.request.post(`${local}/x`)).toThrow(READ_ONLY_MESSAGE)
    const page = await openLocal(context)
    expect(() => page.request.post(`${local}/x`)).toThrow(READ_ONLY_MESSAGE)
    expect(await send(page, 'POST')).toBe('huỷ')
    expect(writesReceived()).toEqual([])
    test.fail(true, 'teardown của fixture newContext phải ném READ_ONLY_MESSAGE')
  })

  test('newContext chỉ đọc thì qua', async ({ newContext }) => {
    const page = await openLocal(await newContext())
    expect(await send(page, 'GET')).toBe(200)
  })
})

test('mọi spec import test từ ./test', () => {
  for (const file of readdirSync('e2e').filter((name) => name.endsWith('.spec.ts'))) {
    const source = readFileSync(`e2e/${file}`, 'utf8')
    expect(source, file).not.toMatch(/import \{[^}]*\btest\b[^}]*\} from '@playwright\/test'/)
    expect(source, file).not.toMatch(/import \* as \w+ from '@playwright\/test'/)
  }
})
