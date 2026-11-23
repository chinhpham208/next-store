import Link from "next/link";
import { Container } from "@/components/ui/container";
import { CursorBlock } from "@/components/ui/cursor-block";

const NAV_LINKS = [
  { href: "/products", label: "Sản phẩm" },
  { href: "/blog", label: "Blog" },
] as const;

// Server Component shared by (shop)/layout.tsx and app/not-found.tsx (which sits outside the (shop) group).
// No aria-current on the nav links: the header cannot know the path without a Client Component, and M2 allows
// "use client" only in error.tsx. Dropped by the Orchestrator on NS-50 (design-system §2, Header).
export const SiteHeader = () => (
  <header className="h-16 border-b border-border">
    <Container className="flex h-full items-center justify-between gap-4">
      <Link href="/" className="inline-flex min-h-11 items-center text-2xl/7 font-bold tracking-tight">
        <span>
          next-store
          <CursorBlock className="ml-2" />
        </span>
      </Link>
      {/* -mr-2 cancels the last link's px-2 so "Blog" lines up with the container edge while every target stays 44 px;
          the two px-2 paddings give 16 px between the words. */}
      <nav aria-label="Chính" className="-mr-2 flex">
        {NAV_LINKS.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="inline-flex min-h-11 items-center px-2 font-medium underline-offset-8 hover:underline"
          >
            {link.label}
          </Link>
        ))}
      </nav>
    </Container>
  </header>
);
