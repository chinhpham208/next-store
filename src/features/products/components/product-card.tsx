import Image from 'next/image'
import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { Price } from '@/components/ui/price'
import { cn } from '@/lib/cn'
import { renderProductName } from '@/features/products/components/product-name'
import type { ProductSummary } from '@/features/products/types'

export type ProductCardProps = { product: ProductSummary }

const IMAGE_SIZE = 800

// The ::after overlay stretches the link over the whole card (the Card is `relative`), so the card is one target
// while the image stays out of the link: the accessible name is just the product name, and the image's alt is not
// read twice. The ring is drawn on the overlay so it surrounds the card rather than the heading text.
const LINK_CLASS =
  'after:absolute after:inset-0 after:rounded-md underline-offset-4 hover:underline focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:outline-offset-4 focus-visible:after:outline-ring'

export const ProductCard = ({ product }: ProductCardProps) => (
  <Card className="relative h-full">
    <div className="aspect-square overflow-hidden rounded-md bg-surface-muted outline outline-1 -outline-offset-1 outline-border">
      <Image
        src={product.image}
        alt={product.name}
        width={IMAGE_SIZE}
        height={IMAGE_SIZE}
        // SVG gains nothing from the optimizer, and serving it through it would need dangerouslyAllowSVG.
        unoptimized={product.image.endsWith('.svg')}
        className="size-full object-cover"
      />
    </div>
    <div className="flex min-h-6 flex-wrap items-center justify-between gap-2">
      <span className="text-xs uppercase tracking-label text-muted-foreground">{product.categoryName}</span>
      {product.inStock ? null : <Badge variant="sold-out">Hết hàng</Badge>}
    </div>
    {/* break-words: a single long word ("NullPointerException") would otherwise overflow into the next card at 390 px. */}
    <h3 className="text-base font-semibold text-pretty break-words md:text-xl">
      <Link href={`/products/${product.slug}`} className={LINK_CLASS}>
        {renderProductName(product.name)}
      </Link>
    </h3>
    <div className="mt-auto pt-1 md:pt-2">
      <Price amount={product.price} className={cn(!product.inStock && 'text-muted-foreground')} />
    </div>
  </Card>
)
