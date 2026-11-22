import type { Metadata } from "next";
import Link from "next/link";
import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { StatusMessage } from "@/components/layout/status-message";
import { buttonVariants } from "@/components/ui/button";

// The root layout's template turns this into "Không tìm thấy trang · next-store" in the server HTML, so the tab
// title no longer changes after hydration (NS-38).
export const metadata: Metadata = { title: "Không tìm thấy trang" };

const ACTION_CLASS = "w-full md:w-auto";

// Rendered for every unmatched URL and every notFound(), inside the root layout only, outside (shop): it carries
// its own header and footer. Next.js ships this file with every route, so it stays a static Server Component
// with plain <Link>s and no Client Components.
export default function NotFound() {
  return (
    <>
      <SiteHeader />
      <main className="flex-1">
        <StatusMessage title="Không tìm thấy trang" description="Trang này không tồn tại hoặc đã bị gỡ.">
          <Link href="/products" className={buttonVariants({ variant: "primary", className: ACTION_CLASS })}>
            Xem tất cả sản phẩm
          </Link>
          <Link href="/" className={buttonVariants({ variant: "secondary", className: ACTION_CLASS })}>
            Về trang chủ
          </Link>
        </StatusMessage>
      </main>
      <SiteFooter />
    </>
  );
}
