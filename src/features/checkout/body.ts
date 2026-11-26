// Reads a request body without trusting content-length (a client can lie, or stream without one).

export const MAX_WEBHOOK_BODY_BYTES = 8192

/** The body as text, or null once it passes `maxBytes` (the stream is cancelled, nothing is parsed). */
export const readCappedBody = async (request: Request, maxBytes: number): Promise<string | null> => {
  if (request.body === null) return ''
  const reader = request.body.getReader()
  const decoder = new TextDecoder()
  let received = 0
  let text = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    received += value.byteLength
    if (received > maxBytes) {
      await reader.cancel()
      return null
    }
    text += decoder.decode(value, { stream: true })
  }
  return text + decoder.decode()
}
