import Image from 'next/image'
import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { buttonVariants } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { formatPrice } from '@/lib/format-price'
import { renderProductName } from '@/features/products'
import { CartLineControls } from '@/features/cart/components/cart-line-controls'
import { CART_TTL_DAYS } from '@/features/cart/limits'
import { getCart } from '@/features/cart/queries'
import type { CartLine, CartView as CartViewData } from '@/features/cart/types'

export type CartViewProps = { cart: CartViewData }

const IMAGE_SIZE = 96
const STACK_CLASS = 'flex flex-col gap-6 md:gap-8'
const LIST_CLASS = 'flex flex-col border-b border-border'
const LINE_CLASS = 'flex flex-wrap gap-4 border-t border-border py-6 md:flex-nowrap md:gap-x-6'
const BLOCK_ACTION_CLASS = 'w-full md:w-auto'

// Decision 10A: a line keeps a quantity above the stock; the page says so instead of changing it on a read.
const isShort = (line: CartLine): boolean => line.quantity > line.stock

const StockWarning = ({ slug, stock }: { slug: string; stock: number }) =>
  stock === 0 ? (
    <p id={`cart-warning-${slug}`}>
      <Badge variant="sold-out">Hết hàng</Badge>
    </p>
  ) : (
    // A state of the line, not an error just made: foreground, not danger.
    <p
      id={`cart-warning-${slug}`}
      className="flex items-center gap-2 text-sm font-medium before:size-2 before:shrink-0 before:bg-foreground"
    >
      {`Chỉ còn ${stock} sản phẩm`}
    </p>
  )

const CartLineItem = ({ line }: { line: CartLine }) => (
  <li data-cart-line={line.slug} className={LINE_CLASS}>
    {/* alt="": the name right beside it is the link; the image is not. */}
    <div className="size-20 shrink-0 overflow-hidden rounded-md bg-surface-muted outline outline-1 -outline-offset-1 outline-border md:size-24">
      <Image
        src={line.image}
        alt=""
        width={IMAGE_SIZE}
        height={IMAGE_SIZE}
        // SVG gains nothing from the optimizer, and serving it through it would need dangerouslyAllowSVG.
        unoptimized={line.image.endsWith('.svg')}
        className="size-full object-cover"
      />
    </div>
    <div className="flex min-w-0 flex-1 flex-col gap-2">
      <h2 className="text-base font-semibold text-pretty break-words md:text-lg">
        <Link
          href={`/products/${line.slug}`}
          className="inline-flex min-h-11 items-center underline-offset-4 hover:underline"
        >
          {renderProductName(line.name)}
        </Link>
      </h2>
      <p className="text-sm text-muted-foreground">
        Đơn giá <span className="font-mono">{formatPrice(line.price)}</span>
      </p>
      {isShort(line) && <StockWarning slug={line.slug} stock={line.stock} />}
    </div>
    <CartLineControls
      slug={line.slug}
      name={line.name}
      quantity={line.quantity}
      stock={line.stock}
      lineTotal={line.lineTotal}
    />
  </li>
)

// Both branches start with the hidden status paragraph at the same place in the tree, so React keeps the element
// (and screen readers keep listening) when the last line goes and the cart turns empty.
export const CartView = ({ cart }: CartViewProps) => {
  if (cart.lines.length === 0) {
    return (
      <div className={STACK_CLASS}>
        {/* Not "Giỏ hàng trống.": getByText must find one element only. */}
        <p role="status" className="sr-only">
          Không còn sản phẩm nào trong giỏ
        </p>
        <div className="flex flex-col items-start gap-4 rounded-md bg-surface-muted px-6 py-10 md:p-16">
          <span aria-hidden="true" className="cursor-block size-8" />
          <p className="text-xl font-semibold md:text-2xl">Giỏ hàng trống.</p>
          <p className="text-muted-foreground">{`Sản phẩm bạn thêm được giữ trong giỏ ${CART_TTL_DAYS} ngày.`}</p>
          <Link href="/products" className={buttonVariants({ variant: 'primary', className: BLOCK_ACTION_CLASS })}>
            Xem sản phẩm
          </Link>
        </div>
      </div>
    )
  }

  const total = formatPrice(cart.total)
  return (
    <div className={STACK_CLASS}>
      {/* US-07: the new total is announced after every edit, when the action's render of the route arrives (D2). */}
      <p role="status" className="sr-only">{`Giỏ hàng có ${cart.count} sản phẩm, tổng cộng ${total}`}</p>
      <p className="text-muted-foreground">{`${cart.count} sản phẩm`}</p>
      <ul aria-label="Sản phẩm trong giỏ" className={LIST_CLASS}>
        {cart.lines.map((line) => (
          <CartLineItem key={line.slug} line={line} />
        ))}
      </ul>
      <div className="flex flex-col gap-4 md:items-end">
        <dl className="flex w-full items-baseline justify-between gap-4 md:w-auto md:gap-8">
          <dt className="text-lg font-semibold">Tổng cộng</dt>
          <dd data-testid="cart-total" className="font-mono text-2xl font-medium">
            {total}
          </dd>
        </dl>
        {cart.lines.some(isShort) && (
          <p className="max-w-xl text-sm font-medium">
            Có sản phẩm không đủ hàng. Giảm số lượng hoặc xoá dòng có cảnh báo.
          </p>
        )}
        {/* M6 puts the primary "Thanh toán" button here (w-full md:w-auto). M4 has none, not even a disabled one. */}
        <p className="text-sm text-muted-foreground">Thanh toán sẽ mở trong bản cập nhật tới.</p>
        <Link href="/products" className={buttonVariants({ variant: 'secondary', className: BLOCK_ACTION_CLASS })}>
          Tiếp tục mua sắm
        </Link>
      </div>
    </div>
  )
}

// Reads the cookie and the database, so page.tsx renders it only inside <Suspense> (D1). A failed read is not caught:
// the cart page has nothing else to keep, so (shop)/error.tsx takes over with the header still there.
export const CartSection = async () => <CartView cart={await getCart()} />

const SkeletonLine = () => (
  <li className={LINE_CLASS}>
    <Skeleton className="size-20 shrink-0 rounded-md md:size-24" />
    <div className="flex min-w-0 flex-1 flex-col gap-2">
      <div className="flex min-h-11 items-center">
        <Skeleton className="h-6 w-2/3" />
      </div>
      <Skeleton className="h-5 w-32" />
    </div>
    <div className="flex w-full items-center justify-between gap-4 md:w-auto md:gap-6">
      <Skeleton className="h-11 w-48 rounded-md" />
      <Skeleton className="h-6 w-24" />
    </div>
  </li>
)

export const CartSkeleton = () => (
  <div aria-busy="true" className={STACK_CLASS}>
    <p className="sr-only">Đang tải…</p>
    <Skeleton className="h-6 w-24" />
    <ul aria-hidden="true" className={LIST_CLASS}>
      <SkeletonLine />
      <SkeletonLine />
    </ul>
    <Skeleton className="h-8 w-60 md:self-end" />
  </div>
)
