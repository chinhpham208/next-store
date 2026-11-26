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
 * Holds back the row of every Server Action response that carries the route's <title> for `delayMs` after the rest
 * of the body has arrived, and passes every other row on as it arrives. The server streams that row late (the
 * head's metadata, Next.js 16.4.6); on a loaded server it comes in a later network chunk than the rest of the tree,
 * which is when the title went missing (NS-107, 2 of 8 runs). This makes that order happen on every run, also on
 * /cart, where the cart's own rows stream after the title row (NS-113): only the title row waits, so the tree can
 * commit without it. Install before the page loads; it wraps window.fetch, which the App Router uses for Server
 * Actions.
 */
export const delayActionTitleRow = async (page: Page, delayMs: number): Promise<void> => {
  await page.addInitScript((delay) => {
    const TITLE_ROW = /^[0-9a-f]+:\[\["\$","title"/
    const realFetch = window.fetch.bind(window)
    const countHeld = (change: number) =>
      Reflect.set(window, '__heldTitleRows', Number(Reflect.get(window, '__heldTitleRows') ?? 0) + change)
    window.fetch = async (input, init) => {
      const response = await realFetch(input, init)
      if (!new Headers(init?.headers).has('next-action') || response.body === null) return response
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      const encoder = new TextEncoder()
      let heldRow: string | null = null
      // The last line, until its end arrives: a row may be cut between two chunks.
      let partial = ''
      // Each pull reads until it has something to pass on or the body ends: a pull that enqueues nothing is not
      // called again (Streams spec: only a read that arrives during the pull asks for another), and the page waits.
      const body = new ReadableStream<Uint8Array>({
        async pull(controller) {
          for (;;) {
            const { done, value } = await reader.read()
            if (done) {
              const rest = partial + decoder.decode()
              if (heldRow !== null) {
                if (rest !== '') controller.enqueue(encoder.encode(rest))
                await new Promise((resolve) => setTimeout(resolve, delay))
                controller.enqueue(encoder.encode(heldRow))
                countHeld(-1)
              } else if (rest !== '') controller.enqueue(encoder.encode(rest))
              controller.close()
              return
            }
            const lines = (partial + decoder.decode(value, { stream: true })).split('\n')
            partial = lines.pop() ?? ''
            const passed = lines
              .filter((line) => {
                if (heldRow !== null || !TITLE_ROW.test(line)) return true
                heldRow = `${line}\n`
                countHeld(1)
                return false
              })
              .map((line) => `${line}\n`)
              .join('')
            if (passed === '') continue
            controller.enqueue(encoder.encode(passed))
            return
          }
        },
      })
      return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers })
    }
  }, delayMs)
}
