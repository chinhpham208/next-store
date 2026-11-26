import { probeForwardedForAction } from '@/features/cart'

// TEMPORARY (NS-136, plan M6 Task 2, C1). Never merged. The form calls the probe action; the action redirects back
// here with the masked shape in the query string.
export default function ProbeForwardedForPage() {
  return (
    <form action={probeForwardedForAction}>
      <button type="submit">probe</button>
    </form>
  )
}
