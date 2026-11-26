import { describe, expect, it } from 'vitest'
import {
  PRODUCT_SLUGS_TAG,
  PRODUCTS_TAG,
  productTag,
  tagsForProductWrite,
} from '@/features/products/cache-tags'

// Every product write invalidates exactly these tags (ADR-0019). A field edit must leave product-slugs alone: every
// detail page reads the slug list, so invalidating it re-renders every product page (US-13).
describe('cache-tags', () => {
  it('names the tags', () => {
    expect(PRODUCTS_TAG).toBe('products')
    expect(PRODUCT_SLUGS_TAG).toBe('product-slugs')
    expect(productTag('ao-git-push-force')).toBe('product:ao-git-push-force')
  })

  it('tagsForProductWrite for a field edit is product:<slug> and products only', () => {
    expect(tagsForProductWrite({ slug: 'ao-git-push-force', change: 'fields' })).toEqual([
      'product:ao-git-push-force',
      'products',
    ])
  })

  it('a slug-set change adds product-slugs', () => {
    expect(tagsForProductWrite({ slug: 'ao-git-push-force', change: 'slug-set' })).toEqual([
      'product:ao-git-push-force',
      'products',
      'product-slugs',
    ])
  })
})
