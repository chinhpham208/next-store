'use client'

import { useOptimistic, useRef, useState, useTransition, type FocusEvent, type FormEvent } from 'react'
import { QuantityStepper } from '@/components/ui/quantity-stepper'
import { removeFromCartAction, setCartQuantityAction } from '@/features/cart/actions'
import { MAX_LINE_QUANTITY } from '@/features/cart/limits'
import { CART_NETWORK_ERROR, cartErrorMessage } from '@/features/cart/messages'
import type { CartActionResult } from '@/features/cart/types'
import { formatPrice } from '@/lib/format-price'

export type CartLineControlsProps = {
  slug: string
  name: string
  quantity: number
  stock: number
  lineTotal: number
}

// Rendered by page.tsx outside the Suspense boundary, so it is always there to take focus.
const HEADING_ID = 'cart-heading'
const MIN_QUANTITY = 0

const REMOVE_CLASS =
  'inline-flex min-h-11 min-w-11 items-center justify-center px-2 text-sm font-medium text-foreground underline underline-offset-4 hover:decoration-2'

// The slug of the line that takes the removed line's place: the next one, else the one before (design-system,
// "Focus sau khi xoá"). Read before the action runs, while the removed line is still in the list.
const neighbourOf = (element: HTMLElement | null): string | null => {
  const item = element?.closest('li')
  const sibling = item?.nextElementSibling ?? item?.previousElementSibling
  return sibling instanceof HTMLElement ? (sibling.dataset.cartLine ?? null) : null
}

// The neighbour's link is already on the page, and the heading is outside Suspense, so either can take focus as soon
// as the action answers, before the route's new render removes the line. Focus never falls back to <body>.
const focusAfterRemoval = (neighbour: string | null, count: number) => {
  const link =
    neighbour !== null && count > 0
      ? document.querySelector<HTMLElement>(`[data-cart-line="${CSS.escape(neighbour)}"] h2 a`)
      : null
  const target = link ?? document.getElementById(HEADING_ID)
  target?.focus()
}

// One line of /cart (US-07): − / number / +, "Xoá", and the line total. The field shows the new number at once;
// the line total, the cart total and the header number change when the action's render of the route arrives (D2),
// not before. Nothing is disabled while waiting: a second click queues behind the first (D3).
export const CartLineControls = ({ slug, name, quantity, stock, lineTotal }: CartLineControlsProps) => {
  const rootRef = useRef<HTMLDivElement>(null)
  const [isPending, startTransition] = useTransition()
  // The number sent and not yet confirmed; it falls back to the server's quantity when the transition ends, so a
  // refusal or a failure puts the server's number back in the field by itself.
  const [sent, setSent] = useOptimistic(String(quantity))
  // What the customer is typing, until Enter or blur; null when not typing.
  const [draft, setDraft] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const shown = draft ?? sent
  const inputId = `quantity-${slug}`
  const warningId = `cart-warning-${slug}`
  const errorId = `cart-error-${slug}`
  // Decision 10A: a line above the stock (or sold out) keeps its quantity and its warning; it may go down, not up.
  const describedBy = [quantity > stock ? warningId : null, error !== null ? errorId : null].filter(Boolean).join(' ')

  const run = (write: () => Promise<CartActionResult>, removes: boolean, next?: number) => {
    setError(null)
    const neighbour = removes ? neighbourOf(rootRef.current) : null
    startTransition(async () => {
      if (next !== undefined) setSent(String(next))
      // A refusal comes back as a result; only a network failure, a 500 or a stale action id after a deploy rejects
      // (D5). Caught here, it shows on the line instead of reaching (shop)/error.tsx (D6).
      try {
        const result = await write()
        if (!result.ok) {
          setError(cartErrorMessage(result))
          return
        }
        if (removes) focusAfterRemoval(neighbour, result.count)
      } catch {
        setError(CART_NETWORK_ERROR)
      }
    })
  }

  // 0 removes the line (US-07), with the same focus move as "Xoá".
  const setQuantity = (next: number) =>
    run(() => setCartQuantityAction({ slug, quantity: next }), next === 0, next)

  const remove = () => run(() => removeFromCartAction({ slug }), true)

  // A typed number goes out on Enter or blur, and only when it differs from the server's. Empty, fractional or
  // negative: the field goes back to the server's number, nothing is sent. Above the line limit: the limit's message.
  const commitDraft = () => {
    if (draft === null) return
    const text = draft.trim()
    setDraft(null)
    if (!/^\d+$/.test(text)) return
    const next = Number(text)
    if (next > MAX_LINE_QUANTITY) {
      setError(cartErrorMessage({ error: 'line-limit' }))
      return
    }
    if (next !== quantity) setQuantity(next)
  }

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    commitDraft()
  }

  const blur = (event: FocusEvent<HTMLFormElement>) => {
    if (event.target.id === inputId) commitDraft()
  }

  return (
    <div
      ref={rootRef}
      aria-busy={isPending || undefined}
      className="group/line flex w-full flex-col gap-2 md:w-auto md:items-end"
    >
      {/* flex-wrap + ml-auto (deviation, design-system.md): at 320 px no line total fits beside the 209 px of controls,
          so it drops below them, still on the right, instead of scrolling the page. From 390 px it stays on this row. */}
      <div className="flex flex-wrap items-center justify-between gap-4 md:justify-end md:gap-6">
        <form noValidate onSubmit={submit} onBlur={blur} className="flex items-center gap-2">
          <QuantityStepper
            inputId={inputId}
            value={shown}
            min={MIN_QUANTITY}
            max={MAX_LINE_QUANTITY}
            onValueChange={setDraft}
            onStep={(next) => {
              setDraft(null)
              setQuantity(next)
            }}
            canIncrease={Number(shown) < Math.min(stock, MAX_LINE_QUANTITY)}
            inputLabel={`Số lượng ${name}`}
            decreaseLabel={`Giảm số lượng ${name}`}
            increaseLabel={`Tăng số lượng ${name}`}
            describedBy={describedBy === '' ? undefined : describedBy}
          />
          <button type="button" onClick={remove} className={REMOVE_CLASS}>
            Xoá<span className="sr-only">{` ${name}`}</span>
          </button>
        </form>
        <p className="ml-auto font-mono text-base font-medium text-right whitespace-nowrap group-aria-busy/line:text-muted-foreground md:w-32">
          <span className="sr-only">Thành tiền </span>
          {formatPrice(lineTotal)}
        </p>
      </div>
      <div role="alert" id={errorId}>
        {error !== null && (
          <p className="flex min-h-5 items-center gap-2 text-sm font-medium text-danger before:size-2 before:shrink-0 before:bg-danger">
            {error}
          </p>
        )}
      </div>
      {isPending && <p className="text-sm text-muted-foreground">Đang cập nhật…</p>}
    </div>
  )
}
