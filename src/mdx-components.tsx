import type { MDXComponents } from 'mdx/types'
import { PROSE_COMPONENTS } from '@/components/ui/prose'

// Required by @next/mdx in the App Router. Imports only the UI layer: importing a feature here would close the loop
// content.ts → *.mdx → mdx-components → feature.
export const useMDXComponents = (): MDXComponents => PROSE_COMPONENTS
