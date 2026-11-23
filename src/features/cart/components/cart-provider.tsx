'use client'

import { createContext, useContext, useOptimistic, type ReactNode } from 'react'

export type CartOptimism = { pendingDelta: number; addPending: (quantity: number) => void }

export type CartProviderProps = { children: ReactNode }

const CartOptimismContext = createContext<CartOptimism | null>(null)

const addQuantity = (delta: number, quantity: number): number => delta + quantity

// Holds only the quantity still on its way to the server, not the count: the count is server data and arrives with
// the RSC render of the same action response (D2). useOptimistic drops the delta when the transition that added it
// ends, which is the moment that render commits (C1), so a refusal or an error needs no undo step (ADR-0014, 9A).
export const CartProvider = ({ children }: CartProviderProps) => {
  const [pendingDelta, addPending] = useOptimistic(0, addQuantity)
  return <CartOptimismContext value={{ pendingDelta, addPending }}>{children}</CartOptimismContext>
}

export const useCartOptimism = (): CartOptimism => {
  const value = useContext(CartOptimismContext)
  if (value === null) throw new Error('useCartOptimism must be used inside CartProvider')
  return value
}
