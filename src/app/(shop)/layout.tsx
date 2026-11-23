import { Suspense } from "react";
import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { CartBadge, CartLink, CartProvider } from "@/features/cart";

// The cart number is the only per-request part of every (shop) page (ADR-0014 9A): CartBadge reads the cookie, so it
// renders inside <Suspense> and the shell around it is still prerendered (D1, C2). The fallback is the same link
// without a number. CartProvider holds the optimistic quantity the "Thêm vào giỏ" button adds before the server answers.
export default function ShopLayout({ children }: LayoutProps<"/">) {
  return (
    <CartProvider>
      <SiteHeader
        cart={
          <Suspense fallback={<CartLink count={null} />}>
            <CartBadge />
          </Suspense>
        }
      />
      <main className="flex-1">{children}</main>
      <SiteFooter />
    </CartProvider>
  );
}
