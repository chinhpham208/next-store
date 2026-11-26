import { WebhookRejected } from '@/features/checkout/types'

// Reads a request body without trusting content-length (a client can lie, or stream without one).

export const MAX_WEBHOOK_BODY_BYTES = 8192

/**
 * The body as the bytes received, or null once it passes `maxBytes` (the stream is cancelled, nothing is parsed). A
 * stream that fails half way (client gone, reset) throws WebhookRejected('malformed'): a bad request, not a 500.
 */
export const readCappedBody = async (request: Request, maxBytes: number): Promise<Uint8Array | null> => {
  if (request.body === null) return new Uint8Array(0)
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let received = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      received += value.byteLength
      if (received > maxBytes) {
        await reader.cancel()
        return null
      }
      chunks.push(value)
    }
  } catch {
    await reader.cancel().catch(() => undefined)
    throw new WebhookRejected('malformed')
  }
  const body = new Uint8Array(received)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  return body
}
