import { test, expect } from './test'

// TEMPORARY (NS-136, plan M6 Task 2). Never merged. Prints only masked shapes, status codes and a UTC time.
const shapeOf = (url: string) => {
  const { searchParams } = new URL(url)
  return `count=${searchParams.get('count')} firstLength=${searchParams.get('firstLength')} firstIs1234=${searchParams.get('firstIs1234')}`
}

test('C1: x-forwarded-for shape, normal then with a client-sent header', async ({ page }) => {
  await page.goto('/probe-xff')
  await page.waitForLoadState('networkidle')
  await page.getByRole('button', { name: 'probe' }).click()
  await page.waitForURL(/probe-xff\?count=/)
  console.log(`PROBE C1 normal: ${shapeOf(page.url())}`)

  await page.route('**/probe-xff**', (route) => route.fallback({ headers: { ...route.request().headers(), 'x-forwarded-for': '1.2.3.4' } }))
  await page.goto('/probe-xff')
  await page.waitForLoadState('networkidle')
  await page.getByRole('button', { name: 'probe' }).click()
  await page.waitForURL(/probe-xff\?count=/)
  console.log(`PROBE C1 with-header: ${shapeOf(page.url())}`)
})

test('C2: POST /api/probe from page and from request fixture', async ({ page, request }) => {
  await page.goto('/')
  const fromPage = await page.evaluate(async () => {
    // eslint-disable-next-line no-restricted-syntax -- TEMPORARY NS-136 probe (C2a needs a browser fetch)
    const response = await fetch('/api/probe', { method: 'POST' })
    return { status: response.status, body: await response.text() }
  })
  console.log(`PROBE C2a page fetch: status=${fromPage.status} body=${fromPage.body}`)
  const response = await request.post('/api/probe')
  console.log(`PROBE C2b request fixture: status=${response.status()} body=${await response.text()}`)
  expect(true).toBe(true)
})

test('C3: render error page', async ({ page }) => {
  const started = new Date().toISOString()
  const response = await page.goto('/probe-error')
  console.log(`PROBE C3 hit at ${started} UTC (goto status=${response?.status()})`)
  await page.waitForTimeout(3000)
  console.log(`PROBE C3 done at ${new Date().toISOString()} UTC`)
})
