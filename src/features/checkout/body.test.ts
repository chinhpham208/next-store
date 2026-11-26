import { describe, expect, it } from 'vitest'
import { MAX_WEBHOOK_BODY_BYTES, readCappedBody } from '@/features/checkout/body'

const post = (body: BodyInit, headers?: HeadersInit): Request =>
  new Request('http://localhost/api/webhooks/payment', { method: 'POST', body, headers })

describe('readCappedBody', () => {
  it('has a cap of 8 KB', () => {
    expect(MAX_WEBHOOK_BODY_BYTES).toBe(8192)
  })

  it('returns the body under the cap', async () => {
    expect(await readCappedBody(post('{"a":1}'), 100)).toBe('{"a":1}')
    expect(await readCappedBody(post('x'.repeat(100)), 100)).toBe('x'.repeat(100))
    expect(await readCappedBody(post(''), 100)).toBe('')
  })

  it('counts bytes, not characters', async () => {
    expect(await readCappedBody(post('é'.repeat(50)), 99)).toBeNull()
    expect(await readCappedBody(post('é'.repeat(50)), 100)).toBe('é'.repeat(50))
  })

  it('returns null past the cap even with a lying content-length', async () => {
    expect(await readCappedBody(post('x'.repeat(101)), 100)).toBeNull()
    expect(await readCappedBody(post('x'.repeat(5000), { 'content-length': '10' }), 100)).toBeNull()
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
    expect(await readCappedBody(request, 100)).toBeNull()
    expect(cancelled).toBe(true)
    expect(pulls).toBeLessThan(10)
  })

  it('returns an empty body for a request without one', async () => {
    expect(await readCappedBody(new Request('http://localhost/x'), 100)).toBe('')
  })
})
