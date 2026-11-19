import Image from "next/image";
import Link from "next/link";
import { Container } from "@/components/ui/container";
import { CursorBlock } from "@/components/ui/cursor-block";

// Everything here is prerendered with the page, so nothing may depend on the current time (no copyright year).
export default function ShopLayout({ children }: LayoutProps<"/">) {
  return (
    <>
      <header className="h-16 border-b border-border">
        <Container className="flex h-full items-center">
          <Link href="/" className="inline-flex min-h-11 items-center text-2xl/7 font-bold tracking-tight">
            <span>
              next-store
              <CursorBlock className="ml-2" />
            </span>
          </Link>
        </Container>
      </header>

      <main className="flex-1">{children}</main>

      {/* The global focus ring (--color-ring) is too dark on Ink; re-pointing the variable here keeps every focusable
          descendant, present or future, on inverse-accent without per-element overrides. */}
      <footer className="bg-inverse text-inverse-foreground [--color-ring:var(--color-inverse-accent)]">
        <Container className="flex flex-col gap-10 py-12 md:gap-12 md:py-16">
          <div className="grid gap-8 md:grid-cols-2">
            <div className="flex flex-col gap-4">
              <p className="text-3xl font-bold tracking-tight md:text-4xl">
                next-store
                <CursorBlock className="ml-2 bg-inverse-accent" />
              </p>
              <p className="text-inverse-muted">Cửa hàng online đồ dùng cho lập trình viên: áo thun, cốc, sticker, sách.</p>
            </div>
            <div className="flex flex-col gap-4 md:pt-2">
              <p>Thanh toán đang chạy ở chế độ thử nghiệm, chưa thu tiền thật.</p>
              <p className="font-mono text-sm text-inverse-muted">git commit -m &quot;bán hàng bằng cà phê&quot;</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-4 border-t border-inverse-border pt-6 md:pt-8">
            <span className="text-sm text-inverse-muted">một dự án của</span>
            <Image
              src="/brand/gin-pham-horizontal-dark.svg"
              alt="Gin Pham"
              width={1095}
              height={256}
              unoptimized
              className="h-auto w-40 md:w-44"
            />
          </div>
        </Container>
      </footer>
    </>
  );
}
