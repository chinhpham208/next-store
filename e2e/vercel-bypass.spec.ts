import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { gzipSync } from 'node:zlib'
import type { APIRequestContext, BrowserContext, Page } from '@playwright/test'
import { BYPASS_HEADER, bypassFor } from './bypass'
import { holdNextAction } from './cart'
import { VIEWPORT_INDEPENDENT } from './catalog'
import { PRODUCTION_ORIGINS } from './production'
import { expect, READ_ONLY_MESSAGE, test } from './test'

// NS-54: the bypass secret goes only to the origin of BASE_URL. Runs in every environment and never sends a request
// off this machine: `vercelBypass` is pointed at a local Node server (the "BASE_URL" origin); a second server, and
// the first one under another host name, are the other origins. Each records whether the header arrived.
test.skip(({ isMobile }) => isMobile, VIEWPORT_INDEPENDENT)

const SECRET = 'bi-mat-thu-ns-54'

type Received = { server: 'base' | 'other'; method: string; url: string; host: string; header: string | undefined }
const received: Received[] = []
let baseServer: Server
let otherServer: Server
// The bypass origin, the same server under another host name (a different origin), and a second server.
let base = ''
let sameServerOtherHost = ''
let other = ''

const html = (body: string) => `<!doctype html><title>bypass</title>${body}`

const handle =
  (server: Received['server']) =>
  (request: IncomingMessage, response: ServerResponse): void => {
    const value = request.headers[BYPASS_HEADER]
    received.push({
      server,
      method: request.method ?? '',
      url: request.url ?? '',
      host: request.headers.host ?? '',
      header: Array.isArray(value) ? value.join(',') : value,
    })
    // The page on `base` loads from `other`, so `other` answers cross-origin fetch too.
    const cors = { 'access-control-allow-origin': '*' }
    const path = request.url ?? '/'
    if (path === '/page')
      return void response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(
        html(
          `<img src="/own.png"><script src="/own.js"></script>` +
            `<img src="${other}/img.png"><script src="${other}/script.js"></script>` +
            `<img src="${sameServerOtherHost}/host.png">`,
        ),
      )
    if (path === '/to-other') return void response.writeHead(302, { location: `${other}/landed`, ...cors }).end()
    if (path === '/see-other') return void response.writeHead(303, { location: `${other}/landed`, ...cors }).end()
    if (path === '/to-base') return void response.writeHead(302, { location: `${base}/back`, ...cors }).end()
    if (path === '/gzip')
      return void response
        .writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-encoding': 'gzip' })
        .end(gzipSync(html('<p>nội dung nén</p>')))
    if (path.endsWith('.js')) return void response.writeHead(200, { 'content-type': 'text/javascript', ...cors }).end('')
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', ...cors }).end(html('ok'))
  }

const listen = async (server: Server) => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  return (server.address() as AddressInfo).port
}

test.beforeAll(async () => {
  baseServer = createServer(handle('base'))
  otherServer = createServer(handle('other'))
  const basePort = await listen(baseServer)
  base = `http://127.0.0.1:${basePort}`
  sameServerOtherHost = `http://localhost:${basePort}`
  other = `http://127.0.0.1:${await listen(otherServer)}`
})
test.afterAll(async () => {
  for (const server of [baseServer, otherServer]) await new Promise((resolve) => server.close(resolve))
})
// A document fulfilled by the bypass route has no IP address, so Chrome counts it as public and its fetch to
// 127.0.0.1 hits Local Network Access. On a preview both sides are public; here the permission is granted.
const LOCAL_NETWORK = ['local-network-access']
test.beforeEach(async ({ context }) => {
  await context.grantPermissions(LOCAL_NETWORK)
  received.length = 0
})

// The fixtures of e2e/test.ts with the bypass pointed at `base` (set up before the test, after beforeAll). With a
// bypass set, the fixtures fail any test that records a trace; this secret is fake and the servers local, but the
// rule has no exception, so tracing is turned off here.
//
// baseURL is `base` too: every URL here is absolute, so it only decides whether the fixtures run in Production mode.
// With BASE_URL set to Production they would, and refuse the POST of the redirect test although it goes to a local
// server (NS-100). The write guard itself is untouched: the group "cùng bộ chặn ghi của Production" sets the
// Production baseURL back and checks it (as e2e/production-guard.spec.ts does).
test.use({
  vercelBypass: async ({}, provide) => provide({ origin: new URL(base).origin, secret: SECRET }),
  baseURL: async ({}, provide) => provide(base),
  trace: 'off',
})

// "<server> <path>" of every request that carried the header, and of every one that did not.
// The browser's own /favicon.ico request comes and goes with timing, so it is left out.
const counted = () => received.filter((entry) => entry.url !== '/favicon.ico')
const withHeader = () => counted().filter((entry) => entry.header !== undefined).map(describe)
const withoutHeader = () => counted().filter((entry) => entry.header === undefined).map(describe)
const describe = ({ server, method, url, host }: Received) =>
  `${server}${host.startsWith('localhost') ? ' (localhost)' : ''} ${method} ${url}`

// fetch from the page: the status, or 'lỗi' when it never got an answer.
const send = (page: Page, url: string, method = 'GET') =>
  page.evaluate(
    ([url, method]) =>
      fetch(url, { method }).then(
        (response) => response.status,
        () => 'lỗi',
      ),
    [url, method] as const,
  )

const expectBrowserRequests = async (context: BrowserContext) => {
  const page = await context.newPage()
  await page.goto(`${base}/page`, { waitUntil: 'load' })
  expect(await send(page, `${base}/data`)).toBe(200)
  expect(await send(page, `${other}/data`)).toBe(200)
  expect(received.every((entry) => entry.header === undefined || entry.header === SECRET)).toBe(true)
  expect(withHeader().sort()).toEqual(['base GET /data', 'base GET /own.js', 'base GET /own.png', 'base GET /page'])
  expect(withoutHeader().sort()).toEqual([
    'base (localhost) GET /host.png',
    'other GET /data',
    'other GET /img.png',
    'other GET /script.js',
  ])
}

const expectApiRequests = async (request: APIRequestContext) => {
  expect((await request.get(`${base}/data`)).status()).toBe(200)
  expect((await request.get(`${other}/data`)).status()).toBe(200)
  expect((await request.get(`${sameServerOtherHost}/data`)).status()).toBe(200)
  expect((await request.head(`${base}/data`)).status()).toBe(200)
  expect((await request.fetch(`${base}/data`, { method: 'OPTIONS' })).status()).toBe(200)
  expect(withHeader()).toEqual(['base GET /data', 'base HEAD /data', 'base OPTIONS /data'])
  expect(withoutHeader()).toEqual(['other GET /data', 'base (localhost) GET /data'])
}

test('bypassFor chỉ bật với BASE_URL https có secret, không phải Production', () => {
  // extraHTTPHeaders would send the header to every origin again.
  expect(test.info().project.use.extraHTTPHeaders).toBeUndefined()
  expect(bypassFor('https://next-store-abc-chinhpham208s-projects.vercel.app/', 's')).toEqual({
    origin: 'https://next-store-abc-chinhpham208s-projects.vercel.app',
    secret: 's',
  })
  expect(bypassFor('https://next-store-dev-ginpham.vercel.app/products?q=1', 's')?.origin).toBe(
    'https://next-store-dev-ginpham.vercel.app',
  )
  for (const [url, secret] of [
    ['https://next-store-dev-ginpham.vercel.app', undefined],
    ['https://next-store-dev-ginpham.vercel.app', ''],
    [undefined, 's'],
    ['', 's'],
    [PRODUCTION_ORIGINS[0], 's'],
    [`${PRODUCTION_ORIGINS[0]}/`, 's'],
    ['http://localhost:3100', 's'],
    ['http://next-store-dev-ginpham.vercel.app', 's'],
    ['không phải url', 's'],
  ] as const)
    expect(bypassFor(url, secret), `${url} ${secret}`).toBeUndefined()
})

test.describe('request của trình duyệt', () => {
  test('chỉ request tới origin của BASE_URL mang header (trang, ảnh, script, fetch)', async ({ context }) => {
    await expectBrowserRequests(context)
  })

  test('redirect từ BASE_URL sang origin khác không mang header sang', async ({ page }) => {
    await page.goto(`${base}/to-other`)
    expect(page.url()).toBe(`${other}/landed`)
    expect(await send(page, `${base}/to-other`)).toBe(200)
    expect(withHeader()).toEqual(['base GET /to-other', 'base GET /to-other'])
    expect(withoutHeader()).toEqual(['other GET /landed', 'other GET /landed'])
  })

  test('bước redirect không mang header, kể cả khi quay về BASE_URL', async ({ page }) => {
    await page.goto(`${base}/page`)
    received.length = 0
    expect(await send(page, `${other}/to-base`)).toBe(200)
    expect(withHeader()).toEqual([])
    expect(withoutHeader()).toEqual(['other GET /to-base', 'base GET /back'])
  })

  test('nội dung nén vẫn tới trang nguyên vẹn', async ({ page }) => {
    await page.goto(`${base}/gzip`)
    await expect(page.getByText('nội dung nén')).toBeVisible()
    expect(withHeader()).toEqual(['base GET /gzip'])
  })

  // NS-97: holdNextAction (e2e/cart.ts) hands a held Server Action POST back with route.fallback(). It must reach the
  // server once, through the bypass route: unrouting too early also sent it natively, without the header (a preview
  // answered that copy with Deployment Protection's 302).
  test('POST action bị holdNextAction giữ rồi thả chỉ tới server một lần, có header', async ({ page, baseURL }) => {
    await page.goto(`${base}/page`)
    received.length = 0
    const held = await holdNextAction(page, baseURL)
    const sent = page.evaluate(
      (url) => fetch(url, { method: 'POST', headers: { 'next-action': 'thu' }, body: 'x' }).then((r) => r.status),
      `${base}/action`,
    )
    await held.request
    expect(counted()).toEqual([])
    await held.release()
    expect(await sent).toBe(200)
    expect(withHeader()).toEqual(['base POST /action'])
    expect(withoutHeader()).toEqual([])
  })

  test('newContext có cùng cách gắn header', async ({ newContext }) => {
    const context = await newContext({ permissions: LOCAL_NETWORK })
    await expectBrowserRequests(context)
    received.length = 0
    await expectApiRequests(context.request)
  })
})

test.describe('request, context.request, page.request', () => {
  test('fixture request chỉ gửi header tới origin của BASE_URL', async ({ request }) => {
    await expectApiRequests(request)
  })

  test('context.request và page.request chỉ gửi header tới origin của BASE_URL', async ({ context, page }) => {
    await expectApiRequests(context.request)
    received.length = 0
    await expectApiRequests(page.request)
  })

  test('redirect sang origin khác không mang header sang', async ({ request }) => {
    const followed = await request.get(`${base}/to-other`)
    expect(followed.status()).toBe(200)
    expect(followed.url()).toBe(`${other}/landed`)
    // 303 after POST: the next hop is a body-less GET, as in a browser.
    const seeOther = await request.post(`${base}/see-other`, { data: { a: 1 } })
    expect(seeOther.status()).toBe(200)
    const back = await request.get(`${other}/to-base`)
    expect(back.url()).toBe(`${base}/back`)
    expect(withHeader()).toEqual(['base GET /to-other', 'base POST /see-other'])
    expect(withoutHeader()).toEqual(['other GET /landed', 'other GET /landed', 'other GET /to-base', 'base GET /back'])
  })

  test('maxRedirects của spec vẫn được tôn trọng', async ({ request }) => {
    const notFollowed = await request.get(`${base}/to-other`, { maxRedirects: 0 })
    expect(notFollowed.status()).toBe(302)
    await expect(request.get(`${base}/to-other`, { maxRedirects: 1 })).resolves.toBeTruthy()
    expect(withoutHeader()).toEqual(['other GET /landed'])
  })
})

// The bypass and the NS-70 write guard on one context (never both in a real run: Production has no bypass). The
// guard still blocks writes before the bypass route sees them, and the reads it lets through keep the header.
// test.fail(): the body passes, so the only failure left is the guard's teardown.
test.describe('cùng bộ chặn ghi của Production', () => {
  test.use({ baseURL: PRODUCTION_ORIGINS[0] })

  test('fixture context: ghi bị huỷ, đọc vẫn mang header', async ({ page, request }) => {
    await page.goto(`${base}/page`)
    expect(await send(page, `${base}/x`, 'POST')).toBe('lỗi')
    expect(await send(page, `${base}/data`)).toBe(200)
    for (const client of [page.request, request]) {
      expect(() => client.post(`${base}/x`)).toThrow(READ_ONLY_MESSAGE)
      expect((await client.get(`${base}/data`)).status()).toBe(200)
    }
    expect(received.filter((entry) => entry.method === 'POST')).toEqual([])
    expect(withHeader().filter((entry) => entry.endsWith('/data'))).toEqual([
      'base GET /data',
      'base GET /data',
      'base GET /data',
    ])
    test.fail(true, 'teardown của fixture context phải ném READ_ONLY_MESSAGE')
  })

  test('newContext: ghi bị huỷ, đọc vẫn mang header', async ({ newContext }) => {
    const page = await (await newContext({ permissions: LOCAL_NETWORK })).newPage()
    await page.goto(`${base}/page`)
    expect(await send(page, `${base}/x`, 'POST')).toBe('lỗi')
    expect(() => page.request.post(`${base}/x`)).toThrow(READ_ONLY_MESSAGE)
    expect((await page.request.get(`${base}/data`)).status()).toBe(200)
    expect(received.filter((entry) => entry.method === 'POST')).toEqual([])
    expect(withHeader()).toContain('base GET /data')
    test.fail(true, 'teardown của fixture newContext phải ném READ_ONLY_MESSAGE')
  })
})
