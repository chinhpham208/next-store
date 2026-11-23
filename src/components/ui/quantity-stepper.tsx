import { cn } from '@/lib/cn'

export type QuantityStepperProps = {
  inputId: string
  name?: string
  /** A string so the field can be empty while the customer types. */
  value: string
  min: number
  max: number
  onValueChange: (value: string) => void
  onStep: (next: number) => void
  decreaseLabel: string
  increaseLabel: string
  /** False when something other than `max` (the stock on /cart) stops "+". */
  canIncrease?: boolean
  /** Becomes the input's aria-label; without it the caller renders a <label htmlFor={inputId}>. */
  inputLabel?: string
  describedBy?: string
}

// Presentational, no hook and no "use client" (design-system, Component M4): only the cart's client components render
// it, so its handlers always live in the browser. 44 + 48 + 44 px wide, 46 px tall with the border.
const BUTTON_CLASS =
  'inline-flex size-11 items-center justify-center text-xl font-medium text-foreground hover:bg-surface-muted focus-visible:-outline-offset-2 disabled:cursor-not-allowed disabled:bg-transparent disabled:text-muted-foreground'

// A value that is not a whole number (empty, "1.5") steps from the nearest end of the range instead of NaN.
const stepFrom = (value: string, min: number): number => {
  const current = Number(value)
  return value.trim() !== '' && Number.isInteger(current) ? current : min - 1
}

export const QuantityStepper = ({
  inputId,
  name,
  value,
  min,
  max,
  onValueChange,
  onStep,
  decreaseLabel,
  increaseLabel,
  canIncrease,
  inputLabel,
  describedBy,
}: QuantityStepperProps) => {
  const current = Number(value)
  const from = stepFrom(value, min)
  return (
    <div className="inline-flex w-fit items-stretch rounded-md border border-border-strong bg-surface">
      <button
        type="button"
        aria-label={decreaseLabel}
        disabled={current <= min}
        onClick={() => onStep(Math.min(max, Math.max(min, from - 1)))}
        className={cn(BUTTON_CLASS, 'rounded-l-md')}
      >
        {'−'}
      </button>
      <input
        type="number"
        inputMode="numeric"
        step={1}
        min={min}
        max={max}
        id={inputId}
        name={name}
        value={value}
        aria-label={inputLabel}
        aria-describedby={describedBy}
        onChange={(event) => onValueChange(event.target.value)}
        className="quantity-field w-12 border-x border-border bg-transparent text-center font-mono text-base text-foreground focus-visible:-outline-offset-2"
      />
      <button
        type="button"
        aria-label={increaseLabel}
        disabled={current >= max || canIncrease === false}
        onClick={() => onStep(Math.min(max, Math.max(min, from + 1)))}
        className={cn(BUTTON_CLASS, 'rounded-r-md')}
      >
        +
      </button>
    </div>
  )
}
