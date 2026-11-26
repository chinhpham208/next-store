import { readFileSync } from 'node:fs'
import { VIEWPORT_INDEPENDENT } from './catalog'
import { expect, test } from './test'

// NS-105: Next registers every 'use cache' function as a Server Function, so anyone can POST its action id with
// arguments of their choice. Action ids come from the local build's manifest, so this runs only against the local
// server (a deployed build has its own ids). The requests only read public data.
test.skip(Boolean(process.env.BASE_URL), 'Cần manifest của bản build local')
test.skip(({ isMobile }) => isMobile, VIEWPORT_INDEPENDENT)

type ManifestEntry = { exportedName: string; filename: string }

const manifest = (): Record<string, ManifestEntry> => {
  const raw: { node: Record<string, ManifestEntry> } = JSON.parse(
    readFileSync('.next/server/server-reference-manifest.json', 'utf8'),
  )
  return raw.node
}

// The first byte of an id: bit 7 marks a 'use cache' function, bits 1..6 the parameters it uses
// (next/dist/shared/lib/server-reference-info.js).
const isCacheFunction = (id: string) => (parseInt(id.slice(0, 2), 16) & 0x80) !== 0
const takesArguments = (id: string) => (parseInt(id.slice(0, 2), 16) & 0x7f) !== 0

// Every value here is the wrong shape for every cached function: a limit, a slug, a category id.
const MALFORMED = ['[-1]', '["A B"]', '[{"junk":1}]', '[1.5]']

test('NS-105: only the reviewed Server Functions are exposed', () => {
  const exposed = Object.values(manifest())
    .map((entry) => `${entry.filename} ${entry.exportedName.startsWith('$$RSC_SERVER_CACHE_') ? "'use cache'" : entry.exportedName}`)
    .sort()
  expect(exposed).toEqual([
    // M5 Task 7 (ADR-0018): loginAction checks the config, the input and the lock before the password; logoutAction
    // only clears the cookie.
    'src/features/admin/actions.ts loginAction',
    'src/features/admin/actions.ts logoutAction',
    'src/features/cart/actions.ts addToCartAction',
    'src/features/cart/actions.ts removeFromCartAction',
    'src/features/cart/actions.ts setCartQuantityAction',
    // M5 Task 9 (ADR-0019, ADR-0018): checks the admin session first, then parses with Zod, then one conditional
    // UPDATE; src/admin-session-checks.test.ts holds the order.
    'src/features/products/actions.ts updateProductAction',
    ...Array<string>(7).fill("src/features/products/queries.ts 'use cache'"),
  ])
})

test('NS-105: a cached function with parameters refuses arguments of the wrong shape', async ({ request, baseURL }) => {
  const ids = Object.keys(manifest()).filter((id) => isCacheFunction(id) && takesArguments(id))
  expect(ids).toHaveLength(4)
  for (const id of ids) {
    for (const body of MALFORMED) {
      const response = await request.post('/products', {
        headers: { 'next-action': id, origin: baseURL ?? '', accept: 'text/x-component', 'content-type': 'text/plain;charset=UTF-8' },
        data: body,
      })
      expect(response.status(), `${id} ${body}`).toBe(500)
    }
  }
})

test('NS-105: a made-up action id is refused', async ({ request, baseURL }) => {
  const response = await request.post('/products', {
    headers: {
      'next-action': `c0${'0'.repeat(40)}`,
      origin: baseURL ?? '',
      accept: 'text/x-component',
      'content-type': 'text/plain;charset=UTF-8',
    },
    data: '["ao-hello-world"]',
  })
  expect(response.status()).toBeGreaterThanOrEqual(400)
  expect(await response.text()).not.toContain('ao-hello-world')
})
