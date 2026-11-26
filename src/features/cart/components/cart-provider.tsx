'use client'

import { createContext, useContext, useOptimistic, type ReactNode } from 'react'
import { useHeldTitle } from '@/lib/use-held-title'

export type CartOptimism = {
  pendingDelta: number
  addPending: (quantity: number) => void
  // NS-113, for the lines of /cart: holdLineTitle() before the line's transition, lineActionPending() inside it.
  holdLineTitle: () => void
  lineActionPending: () => void
}

export type CartProviderProps = { children: ReactNode }

const CartOptimismContext = createContext<CartOptimism | null>(null)

const addQuantity = (delta: number, quantity: number): number => delta + quantity

// Holds only the quantity still on its way to the server, not the count: the count is server data and arrives with
// the RSC render of the same action response (D2). useOptimistic drops the delta when the transition that added it
// ends, which is the moment that render commits (C1), so a refusal or an error needs no undo step (ADR-0014, 9A).
//
// NS-113: the copy of the title that a line of /cart holds while its action re-renders the route (NS-107,
// src/lib/use-held-title.ts) lives here, not in the line: a removed line unmounts in the very commit that remounts
// the head's metadata, and its copy would go with it. The count of line actions in progress is optimistic for the
// same reason as pendingDelta: it drops back to 0 when the action's render commits, and the copy goes after that.
export const CartProvider = ({ children }: CartProviderProps) => {
  const [pendingDelta, addPending] = useOptimistic(0, addQuantity)
  const [pendingLineActions, addLineActions] = useOptimistic(0, addQuantity)
  const lineTitle = useHeldTitle(pendingLineActions > 0)
  const lineActionPending = () => addLineActions(1)
  return (
    <CartOptimismContext value={{ pendingDelta, addPending, holdLineTitle: lineTitle.hold, lineActionPending }}>
      {lineTitle.title}
      {children}
    </CartOptimismContext>
  )
}

export const useCartOptimism = (): CartOptimism => {
  const value = useContext(CartOptimismContext)
  if (value === null) throw new Error('useCartOptimism must be used inside CartProvider')
  return value
}
