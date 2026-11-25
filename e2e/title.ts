import type { Page } from '@playwright/test'

// NS-107: watching the document title while a Server Action re-renders the route (WCAG 2.4.2: the page keeps a title).

/**
 * Records every moment, from now on, at which the page has no <title> or an empty document.title. A MutationObserver
 * runs its callback after each batch of DOM changes and before the next paint, so a title that is gone for a single
 * commit is still seen. Read the record with titleGaps().
 */
export const watchTitle = async (page: Page): Promise<void> => {
  await page.evaluate(() => {
    const gaps: string[] = []
    Object.assign(window, { __titleGaps: gaps })
    const check = () => {
      const count = document.querySelectorAll('title').length
      if (count === 0 || document.title === '') gaps.push(`${Math.round(performance.now())} ms: ${count} <title>`)
    }
    check()
    new MutationObserver(check).observe(document, { subtree: true, childList: true, characterData: true })
  })
}

export const titleCount = (page: Page): Promise<number> => page.evaluate(() => document.querySelectorAll('title').length)

// How many title rows delayActionTitleRow is still holding back: 0 once every response has been passed on whole.
export const heldTitleRows = (page: Page): Promise<number> =>
  page.evaluate(() => {
    const held: unknown = Reflect.get(window, '__heldTitleRows')
    return typeof held === 'number' ? held : 0
  })

export const titleGaps = (page: Page): Promise<string[]> =>
  page.evaluate(() => {
    const gaps: unknown = Reflect.get(window, '__titleGaps')
    return Array.isArray(gaps) ? gaps.map(String) : ['watchTitle() chưa chạy']
  })

/**
 * Holds back the row of every Server Action response that carries the route's <title> for `delayMs`, and passes
 * everything else on as it arrives. The server streams that row last (the head's metadata, Next.js 16.4.6); on a
 * loaded server it comes in a later network chunk than the rest of the tree, which is when the title went missing
 * (NS-107, 2 of 8 runs). This makes that order happen on every run. Install before the page loads; it wraps
 * window.fetch, which the App Router uses for Server Actions.
 */
export const delayActionTitleRow = async (page: Page, delayMs: number): Promise<void> => {
  await page.addInitScript((delay) => {
    // A row starts a line; `buffered` itself starts a line, since only whole lines are passed on.
    const TITLE_ROW = /(?:^|\n)([0-9a-f]+:\[\["\$","title")/
    const realFetch = window.fetch.bind(window)
    window.fetch = async (input, init) => {
      const response = await realFetch(input, init)
      if (!new Headers(init?.headers).has('next-action') || response.body === null) return response
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      const encoder = new TextEncoder()
      let held = false
      let buffered = ''
      const body = new ReadableStream<Uint8Array>({
        async pull(controller) {
          const { done, value } = await reader.read()
          if (done) {
            if (held) await new Promise((resolve) => setTimeout(resolve, delay))
            controller.enqueue(encoder.encode(buffered + decoder.decode()))
            controller.close()
            if (held) Reflect.set(window, '__heldTitleRows', Number(Reflect.get(window, '__heldTitleRows')) - 1)
            return
          }
          buffered += decoder.decode(value, { stream: true })
          if (held) return
          const match = TITLE_ROW.exec(buffered)
          if (match === null) {
            // A row may be cut between two chunks: keep the last line back until the next one arrives.
            const lastLine = buffered.lastIndexOf('\n')
            controller.enqueue(encoder.encode(buffered.slice(0, lastLine + 1)))
            buffered = buffered.slice(lastLine + 1)
            return
          }
          const rowStart = match.index + match[0].length - (match[1]?.length ?? 0)
          controller.enqueue(encoder.encode(buffered.slice(0, rowStart)))
          buffered = buffered.slice(rowStart)
          held = true
          Reflect.set(window, '__heldTitleRows', Number(Reflect.get(window, '__heldTitleRows') ?? 0) + 1)
        },
      })
      return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers })
    }
  }, delayMs)
}
