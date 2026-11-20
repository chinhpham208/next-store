import Link from "next/link";
import { Container } from "@/components/ui/container";
import { CursorBlock } from "@/components/ui/cursor-block";

// Server Component shared by (shop)/layout.tsx and app/not-found.tsx (which sits outside the (shop) group).
// No aria-current on "Sản phẩm" yet: the header cannot know the path without a Client Component.
export const SiteHeader = () => (
  <header className="h-16 border-b border-border">
    <Container className="flex h-full items-center justify-between gap-4">
      <Link href="/" className="inline-flex min-h-11 items-center text-2xl/7 font-bold tracking-tight">
        <span>
          next-store
          <CursorBlock className="ml-2" />
        </span>
      </Link>
      <nav aria-label="Chính">
        {/* -mr-2 cancels px-2 so the text lines up with the container edge while the target stays 44 px. */}
        <Link
          href="/products"
          className="-mr-2 inline-flex min-h-11 items-center px-2 font-medium underline-offset-8 hover:underline"
        >
          Sản phẩm
        </Link>
      </nav>
    </Container>
  </header>
);
