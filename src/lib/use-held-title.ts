import { createElement, useEffect, useState, type ReactNode } from 'react'

// Workaround for NS-107 (WCAG 2.4.2: a page always has a title), shared by every form whose Server Action re-renders
// the route in its response (plan M4 D2): the product page's add to cart, the lines of /cart (NS-113), the admin
// forms. Remove it here, in one place, once Next.js fixes the bug (NS-114).
//
// Next.js 16.4.6 keys the head's metadata by request id (server/app-render/app-render.js getFlightMetadataKey), so
// every action response remounts it, and the metadata streams inside its own <Suspense> (lib/metadata/metadata.js).
// Its row comes late; when the rest of the tree commits first, the remounted boundary shows its empty fallback and
// the page has no <title> until the row lands. The form therefore renders a copy of the current title (React hoists
// it into <head>) from the click until the route's own <title> is back after the action, so the document always has
// one. Both say the same thing.
//
// Only Client Components import this file, so it needs no "use client" of its own (plan M5 Global Constraints).

const HELD_TITLE_ATTRIBUTE = 'data-held-title'

const routeTitlePresent = (): boolean =>
  Array.from(document.head.querySelectorAll('title')).some(
    (title) => !title.hasAttribute(HELD_TITLE_ATTRIBUTE) && title.textContent !== '',
  )

/**
 * `hold()` when the action starts (before the transition); render `title` anywhere in the form. The copy goes once
 * `isPending` is false again (the action's render has committed with it, C1) and the route's own title is back in
 * the head; until then a DOM observer waits for it.
 */
export const useHeldTitle = (isPending: boolean): { hold: () => void; title: ReactNode } => {
  const [heldTitle, setHeldTitle] = useState<string | null>(null)
  useEffect(() => {
    if (heldTitle === null || isPending) return
    const release = () => {
      if (!routeTitlePresent()) return false
      setHeldTitle(null)
      return true
    }
    if (release()) return
    const observer = new MutationObserver(() => {
      if (release()) observer.disconnect()
    })
    observer.observe(document.head, { subtree: true, childList: true, characterData: true })
    return () => observer.disconnect()
  }, [heldTitle, isPending])
  const hold = () => setHeldTitle(document.title)
  // The attribute is HELD_TITLE_ATTRIBUTE, so the copy never counts as the route's own title.
  const title = heldTitle ? createElement('title', { [HELD_TITLE_ATTRIBUTE]: '' }, heldTitle) : null
  return { hold, title }
}
