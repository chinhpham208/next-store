import { Suspense } from 'react'
import { connection } from 'next/server'

// TEMPORARY (NS-136, plan M6 Task 2, C3). Never merged.
const Boom = async () => {
  await connection()
  throw new Error('probe')
}

export default function ProbeErrorPage() {
  return (
    <Suspense fallback={<p>probe</p>}>
      <Boom />
    </Suspense>
  )
}
