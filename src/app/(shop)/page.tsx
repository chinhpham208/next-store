import { Container } from "@/components/ui/container";
import { CursorBlock } from "@/components/ui/cursor-block";
import { getFeaturedProducts, ProductGrid } from "@/features/products";

const FEATURED_LABEL = "Sản phẩm nổi bật";

// Static: getFeaturedProducts is 'use cache' (tag products, cacheLife hours), so / prerenders at build time
// without a Suspense boundary.
export default async function HomePage() {
  const products = await getFeaturedProducts();

  return (
    <>
      <section>
        <Container className="flex flex-col gap-6 pt-14 pb-12 md:gap-8 md:pt-28 md:pb-24">
          <p className="text-xs uppercase tracking-label text-muted-foreground">Áo thun · Cốc · Sticker · Sách</p>
          <h1 className="hero-title text-5xl font-bold tracking-tight text-balance md:text-8xl">
            Đồ dùng cho dân{" "}
            {/* Keeps the cursor from wrapping onto a line of its own. */}
            <span className="whitespace-nowrap">
              code.
              <CursorBlock blink className="ml-2" />
            </span>
          </h1>
          <p className="text-lg text-muted-foreground md:text-xl">
            Áo thun, cốc, sticker và sách in những dòng lệnh quen thuộc, cho người viết code mỗi ngày.
          </p>
        </Container>
      </section>

      <section aria-labelledby="featured-heading">
        <Container className="pb-16 md:pb-24">
          <div className="flex flex-col gap-8 border-t border-border pt-10 md:gap-12 md:pt-16">
            <h2 id="featured-heading" className="text-2xl font-bold tracking-tight md:text-3xl">
              {FEATURED_LABEL}
            </h2>
            <ProductGrid products={products} label={FEATURED_LABEL} />
          </div>
        </Container>
      </section>
    </>
  );
}
