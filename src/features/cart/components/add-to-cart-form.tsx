'use client'

import Link from 'next/link'
import { useState, useTransition, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { QuantityStepper } from '@/components/ui/quantity-stepper'
import { addToCartAction } from '@/features/cart/actions'
import { useCartOptimism } from '@/features/cart/components/cart-provider'
import { MAX_LINE_QUANTITY } from '@/features/cart/limits'
import { CART_NETWORK_ERROR, cartErrorMessage, QUANTITY_RANGE_MESSAGE } from '@/features/cart/messages'
import { useHeldTitle } from '@/lib/use-held-title'

export type AddToCartFormProps = { slug: string; stock: number }

type Outcome = { kind: 'idle' } | { kind: 'added' } | { kind: 'error'; message: string }

const IDLE: Outcome = { kind: 'idle' }
const MIN_QUANTITY = 1
const INPUT_ID = 'quantity'

// Gate 2 decision 6: a quantity the action would refuse as `invalid` never leaves the browser, so the customer reads
// what is wrong with the number rather than "Không tìm thấy sản phẩm". Above 10 reads as the line limit.
const checkQuantity = (value: string): { quantity: number } | { message: string } => {
  const quantity = Number(value)
  if (!/^\d+$/.test(value.trim()) || quantity < MIN_QUANTITY) return { message: QUANTITY_RANGE_MESSAGE }
  if (quantity > MAX_LINE_QUANTITY) return { message: cartErrorMessage({ error: 'line-limit' }) }
  return { quantity }
}

const SoldOut = () => (
  <section aria-label="Mua hàng" className="flex flex-col gap-4">
    {/* The M2 "Hết hàng" badge by the price already says why; a real disabled attribute, not only aria-disabled. */}
    <Button type="button" disabled className="w-full md:w-auto md:self-start">
      Thêm vào giỏ
    </Button>
  </section>
)

// US-06 / US-08 on the product page. The number on the cart icon goes up on this frame (useOptimistic in
// CartProvider) and settles on the server's count when the action's render commits. The button is never disabled
// while waiting: a second click queues behind the first (D3).
export const AddToCartForm = ({ slug, stock }: AddToCartFormProps) => {
  const { addPending } = useCartOptimism()
  const [isPending, startTransition] = useTransition()
  const [value, setValue] = useState(String(MIN_QUANTITY))
  const [outcome, setOutcome] = useState<Outcome>(IDLE)
  // NS-107: the page keeps its <title> while the add re-renders the route (src/lib/use-held-title.ts).
  const heldTitle = useHeldTitle(isPending)

  if (stock === 0) return <SoldOut />

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const checked = checkQuantity(value)
    if ('message' in checked) {
      setOutcome({ kind: 'error', message: checked.message })
      return
    }
    const { quantity } = checked
    setOutcome(IDLE)
    heldTitle.hold()
    startTransition(async () => {
      addPending(quantity)
      // A business refusal comes back as a result; only a network failure, a 500 or a stale action id after a deploy
      // rejects (D5). Caught here, it shows next to the button instead of reaching (shop)/error.tsx (D6).
      try {
        const result = await addToCartAction({ slug, quantity })
        setOutcome(result.ok ? { kind: 'added' } : { kind: 'error', message: cartErrorMessage(result) })
      } catch {
        setOutcome({ kind: 'error', message: CART_NETWORK_ERROR })
      }
    })
  }

  return (
    <section aria-label="Mua hàng" className="flex flex-col gap-4">
      {heldTitle.title}
      <form noValidate onSubmit={submit} className="flex flex-wrap items-end gap-4">
        <div className="flex flex-col gap-2">
          <label htmlFor={INPUT_ID} className="text-sm font-medium">
            Số lượng
          </label>
          {/* max is the line limit, not the stock: a number above the stock must reach the server to be refused with
              "Chỉ còn N sản phẩm" (US-08). */}
          <QuantityStepper
            inputId={INPUT_ID}
            name="quantity"
            value={value}
            min={MIN_QUANTITY}
            max={MAX_LINE_QUANTITY}
            onValueChange={setValue}
            onStep={(next) => setValue(String(next))}
            decreaseLabel="Giảm số lượng"
            increaseLabel="Tăng số lượng"
          />
        </div>
        {/* The label never changes while waiting, so the button keeps its accessible name. */}
        <Button type="submit" aria-busy={isPending || undefined} className="flex-1 md:flex-none">
          Thêm vào giỏ
        </Button>
      </form>
      {/* Both regions are in the DOM from the first render, empty, so a screen reader announces what appears. */}
      <div className="flex flex-col">
        <div role="status">
          {isPending ? (
            <p className="flex min-h-11 items-center text-muted-foreground">Đang thêm vào giỏ…</p>
          ) : (
            outcome.kind === 'added' && (
              <div className="flex flex-wrap items-center gap-x-4">
                <p className="flex min-h-11 items-center gap-2 font-medium before:size-2 before:shrink-0 before:bg-foreground">
                  Đã thêm vào giỏ hàng
                </p>
                <Link
                  href="/cart"
                  className="inline-flex min-h-11 items-center text-link underline underline-offset-4 hover:decoration-2"
                >
                  Xem giỏ hàng
                </Link>
              </div>
            )
          )}
        </div>
        <div role="alert">
          {outcome.kind === 'error' && (
            <p className="flex min-h-11 items-center gap-2 font-medium text-danger before:size-2 before:shrink-0 before:bg-danger">
              {outcome.message}
            </p>
          )}
        </div>
      </div>
    </section>
  )
}
