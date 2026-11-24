import type { Request } from '@playwright/test'
import { addedStatus, addToCartButton, openProduct, productWithStock, waitForActionResponse } from './cart'
import { VIEWPORT_INDEPENDENT } from './catalog'
import { WRITE_TAG } from './production'
import { expect, test } from './test'

// NS-108 (audit M4 NS-96): next.config.ts caps a Server Action body at 16 KB (`experimental.serverActions.bodySizeLimit`,
// default 1 MB). The cart's real payloads must still go through, and a larger body must be refused before the action
// runs. Next.js 16.4.6 throws a 413 while reading the body; measured, `next start` answers the fetch action with 500
// (server/app-render/action-handler.js turns the error into 500, with a TODO for 413) and a Vercel preview with 413
// (PR #91). Either is a refusal: the point is that the action never decodes the body. The action id is the one the
// page itself sends, so this runs on a deployment too; the adds write a cart (WRITE_TAG).
test.skip(({ isMobile }) => isMobile, VIEWPORT_INDEPENDENT)

const PRODUCT = productWithStock('ao-git-push-force', 1)
const LIMIT_BYTES = 16 * 1024
// The real add's body is a few dozen bytes; this bound only catches a payload that grew by an order of magnitude.
const REAL_PAYLOAD_MAX_BYTES = 1024
// 500 under `next start`, 413 on Vercel (measured, see above).
const REFUSED_STATUSES = [413, 500]

// Same shape as the real add ({ slug, quantity } encoded by React), with the slug padded to `bytes` in total. The slug
// is far past the schema's limit, so a body under the cap reaches the action and gets `invalid` back: no write.
const paddedBody = (bytes: number) => {
  const frame = JSON.stringify([{ slug: '', quantity: 1 }])
  return JSON.stringify([{ slug: 'a'.repeat(bytes - frame.length), quantity: 1 }])
}

test.describe('NS-108: giới hạn body của Server Action', { tag: WRITE_TAG }, () => {
  test('payload thật của "Thêm vào giỏ" qua, body lớn hơn 16 KB bị từ chối trước khi action chạy', async ({
    page,
  }) => {
    await openProduct(page, PRODUCT.slug)
    const sent: Promise<Request> = page.waitForRequest((request) => request.method() === 'POST' && request.headers()['next-action'] !== undefined)
    const answered = waitForActionResponse(page)
    await addToCartButton(page).click()
    const request = await sent
    expect((await answered).status(), 'POST thật của action').toBe(200)
    await expect(addedStatus(page)).toBeVisible({ timeout: 15_000 })
    expect(Buffer.byteLength(request.postData() ?? ''), 'kích thước payload thật').toBeLessThan(REAL_PAYLOAD_MAX_BYTES)

    const headers = await request.allHeaders()
    const replay = (bytes: number) =>
      page.request.post(request.url(), {
        headers: {
          'next-action': headers['next-action'] ?? '',
          'content-type': headers['content-type'] ?? 'text/plain;charset=UTF-8',
          origin: headers.origin ?? new URL(request.url()).origin,
          accept: 'text/x-component',
        },
        data: paddedBody(bytes),
      })

    const under = await replay(LIMIT_BYTES - 1024)
    expect(under.status(), 'body 15 KB: tới được action').toBe(200)
    expect(await under.text(), 'body 15 KB: action trả invalid').toContain('"invalid"')

    const over = await replay(LIMIT_BYTES + 1024)
    expect(REFUSED_STATUSES, 'body 17 KB: Next.js từ chối trước khi decode').toContain(over.status())
    expect(await over.text()).not.toContain('"invalid"')
  })
})
