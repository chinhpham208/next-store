import type { Metadata } from "next";
import { Suspense } from "react";
import { Container } from "@/components/ui/container";
import { CartSection, CartSkeleton } from "@/features/cart";

// One browser's cart: never indexed, and not in the sitemap.
export const metadata: Metadata = {
  title: "Giỏ hàng",
  robots: { index: false },
};

// Not async, and no cookie read here: the h1 is the prerendered shell, and the cart (cookie + database) streams in
// from behind <Suspense> with the skeleton as fallback (D1). The h1 takes focus when the last line is removed.
export default function CartPage() {
  return (
    <Container className="flex flex-col gap-6 pt-10 pb-16 md:gap-8 md:pt-16 md:pb-24">
      <h1 id="cart-heading" tabIndex={-1} className="text-4xl font-bold tracking-tight md:text-5xl">Giỏ hàng</h1>
      <Suspense fallback={<CartSkeleton />}>
        <CartSection />
      </Suspense>
    </Container>
  );
}
