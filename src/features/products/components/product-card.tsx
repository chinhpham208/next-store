import Image from 'next/image'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { Price } from '@/components/ui/price'
import { cn } from '@/lib/cn'
import type { ProductSummary } from '@/features/products/types'

export type ProductCardProps = { product: ProductSummary }

const IMAGE_SIZE = 800
// A word that contains "--" (a CLI flag such as "--force"); the capture group keeps it in split()'s output.
const FLAG_WORD = /(\S*--\S*)/

// Browsers may wrap after a hyphen, splitting "--force" on narrow cards. Swapping in U+2011 would fix that, but
// Lexend has no U+2011 glyph (fallback font mid-word) and the heading text would no longer equal the image alt
// that the E2E contract matches on, so the flag word is kept whole with nowrap and the characters stay as typed.
const renderName = (name: string) =>
  name
    .split(FLAG_WORD)
    .map((part, index) =>
      index % 2 === 1 ? (
        <span key={index} className="whitespace-nowrap">
          {part}
        </span>
      ) : (
        part
      ),
    )

export const ProductCard = ({ product }: ProductCardProps) => (
  <Card className="h-full">
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
    <h3 className="text-base font-semibold text-pretty md:text-xl">{renderName(product.name)}</h3>
    <div className="mt-auto pt-1 md:pt-2">
      <Price amount={product.price} className={cn(!product.inStock && 'text-muted-foreground')} />
    </div>
  </Card>
)
