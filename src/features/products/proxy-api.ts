// The only entry src/proxy.ts uses (dependency-cruiser `proxy-entry-only`, `proxy-narrow-entry`, `proxy-no-db`).
// index.ts would bundle every product component, zod, tailwind-merge and the database client into the proxy, which
// runs before each product request. Both files below import nothing (ADR-0017).
export { isCatalogSlug } from '@/features/products/catalog-slugs'
export { isProductSlug } from '@/features/products/slug'
