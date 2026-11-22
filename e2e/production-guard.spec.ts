import { readdirSync, readFileSync } from 'node:fs'
import { VIEWPORT_INDEPENDENT } from './catalog'
import { grepInvertFor, isProductionUrl } from './production'
import { blockWrites, expect, READ_ONLY_MESSAGE, readOnlyRequest, test } from './test'

// M3 Task 17, Review Focus 9: E2E on Production must never write. Runs in every environment: the guard is built in
// production mode by hand and pointed at this run's own BASE_URL (the local server, or Production itself).
test.skip(({ isMobile }) => isMobile, VIEWPORT_INDEPENDENT)

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

test('chặn mọi request không phải GET / HEAD khi chạy trên Production', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL })
  try {
    const blocked = await blockWrites(context)
    const page = await context.newPage()
    await page.goto('/')
    const send = (method: string) =>
      page.evaluate(
        (init) =>
          fetch('/products', init).then(
            (response) => response.status,
            () => 'huỷ',
          ),
        { method },
      )
    expect(await send('POST')).toBe('huỷ')
    expect(await send('DELETE')).toBe('huỷ')
    expect(await send('GET')).toBe(200)
    expect(blocked).toEqual(['POST /products', 'DELETE /products'])
  } finally {
    await context.close()
  }
})

test('request fixture trên Production không gửi được post / put / patch / delete', ({ request }) => {
  const guarded = readOnlyRequest(request)
  expect(() => guarded.post('/products')).toThrow(READ_ONLY_MESSAGE)
  expect(() => guarded.put('/products')).toThrow(READ_ONLY_MESSAGE)
  expect(() => guarded.patch('/products')).toThrow(READ_ONLY_MESSAGE)
  expect(() => guarded.delete('/products')).toThrow(READ_ONLY_MESSAGE)
  expect(() => guarded.fetch('/products', { method: 'POST' })).toThrow(READ_ONLY_MESSAGE)
})

test('mọi spec import test từ ./test', () => {
  for (const file of readdirSync('e2e').filter((name) => name.endsWith('.spec.ts')))
    expect(readFileSync(`e2e/${file}`, 'utf8'), file).not.toMatch(/import \{[^}]*\btest\b[^}]*\} from '@playwright\/test'/)
})
