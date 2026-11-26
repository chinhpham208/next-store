import { describe, expect, it } from 'vitest'
import { WebhookRejected } from '@/features/checkout/types'
import { MAX_WEBHOOK_BODY_BYTES, readCappedBody } from '@/features/checkout/body'

const text = (bytes: Uint8Array | null): string | null => (bytes === null ? null : new TextDecoder().decode(bytes))

const post = (body: BodyInit, headers?: HeadersInit): Request =>
  new Request('http://localhost/api/webhooks/payment', { method: 'POST', body, headers })

describe('readCappedBody', () => {
  it('has a cap of 8 KB', () => {
    expect(MAX_WEBHOOK_BODY_BYTES).toBe(8192)
  })

  it('returns the body under the cap', async () => {
    expect(text(await readCappedBody(post('{"a":1}'), 100))).toBe('{"a":1}')
    expect(text(await readCappedBody(post('x'.repeat(100)), 100))).toBe('x'.repeat(100))
    expect(text(await readCappedBody(post(''), 100))).toBe('')
  })

  it('counts bytes, not characters', async () => {
    expect(text(await readCappedBody(post('é'.repeat(50)), 99))).toBeNull()
    expect(text(await readCappedBody(post('é'.repeat(50)), 100))).toBe('é'.repeat(50))
  })

  it('returns null past the cap even with a lying content-length', async () => {
    expect(text(await readCappedBody(post('x'.repeat(101)), 100))).toBeNull()
    expect(text(await readCappedBody(post('x'.repeat(5000), { 'content-length': '10' }), 100))).toBeNull()
  })

  it('cancels the stream once the cap is passed', async () => {
    let pulls = 0
    let cancelled = false
    const chunk = new Uint8Array(60)
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1
        controller.enqueue(chunk)
      },
      cancel() {
        cancelled = true
      },
    })
    const request = new Request('http://localhost/api/webhooks/payment', {
      method: 'POST',
      body: stream,
      duplex: 'half',
    } as RequestInit)
    expect(text(await readCappedBody(request, 100))).toBeNull()
    expect(cancelled).toBe(true)
    expect(pulls).toBeLessThan(10)
  })

  it('returns an empty body for a request without one', async () => {
    expect(text(await readCappedBody(new Request('http://localhost/x'), 100))).toBe('')
  })

  it('keeps the bytes as they came, BOM and invalid UTF-8 included', async () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, 0x7b, 0xff, 0x7d])
    expect(await readCappedBody(post(bytes), 100)).toEqual(bytes)
  })

  it('turns a stream that fails half way into a rejected webhook, not a crash', async () => {
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.error(new Error('boom'))
      },
    })
    const request = new Request('http://localhost/api/webhooks/payment', {
      method: 'POST',
      body: stream,
      duplex: 'half',
    } as RequestInit)
    const error = await readCappedBody(request, 100).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(WebhookRejected)
    expect((error as WebhookRejected).reason).toBe('malformed')
    expect((error as WebhookRejected).message).not.toContain('boom')
  })
})
