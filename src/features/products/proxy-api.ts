// The only entry src/proxy.ts uses (dependency-cruiser `proxy-entry-only`, `proxy-narrow-entry`). index.ts would
// bundle every product component, zod and tailwind-merge into the proxy, which runs before each product request.
export { isProductSlug } from '@/features/products/slug'
export { isKnownProductSlug } from '@/features/products/slug-guard'
