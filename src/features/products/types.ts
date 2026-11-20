export type ProductSummary = {
  slug: string
  name: string
  price: number
  image: string
  categoryName: string
  inStock: boolean
}

export type ProductDetail = {
  slug: string
  name: string
  description: string
  price: number
  image: string
  categorySlug: string
  categoryName: string
  stock: number
}
