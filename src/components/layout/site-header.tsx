import Link from "next/link";
import type { ReactNode } from "react";
import { Container } from "@/components/ui/container";
import { CursorBlock } from "@/components/ui/cursor-block";

const NAV_LINKS = [
  { href: "/products", label: "Sản phẩm" },
  { href: "/blog", label: "Blog" },
] as const;

export type SiteHeaderProps = { cart?: ReactNode };

// Server Component shared by (shop)/layout.tsx and app/not-found.tsx (which sits outside the (shop) group). The cart
// link comes in through the `cart` slot after "Blog" (M4): the header imports no feature (plan M4 Global Constraints).
// No aria-current on the nav links: the header cannot know the path without a Client Component, and M2 allows
// "use client" only in error.tsx. Dropped by the Orchestrator on NS-50 (design-system §2, Header).
export const SiteHeader = ({ cart }: SiteHeaderProps) => (
  <header className="h-16 border-b border-border">
    <Container className="flex h-full items-center justify-between gap-2 sm:gap-4">
      <Link href="/" className="inline-flex min-h-11 items-center text-lg/7 font-bold tracking-tight sm:text-2xl/7">
        <span>
          next-store
          <CursorBlock className="ml-2" />
        </span>
      </Link>
      {/* -mr-2 cancels the last item's px-2 so the cart icon (or "Blog" without a slot) lines up with the container
          edge while every target stays 44 px; the px-2 paddings give 16 px between the items. */}
      <nav aria-label="Chính" className="-mr-1 flex sm:-mr-2">
        {NAV_LINKS.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="inline-flex min-h-11 min-w-11 items-center justify-center px-1 font-medium underline-offset-8 hover:underline sm:px-2"
          >
            {link.label}
          </Link>
        ))}
        {cart}
      </nav>
    </Container>
  </header>
);
