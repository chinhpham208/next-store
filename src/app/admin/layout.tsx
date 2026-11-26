import type { Metadata } from "next";

// The admin area (ADR-0018) lives outside (shop): no cart header, no CartProvider, no shop footer. Never indexed
// (requirements.md §5 SEO). Each page brings its own admin header: the login page and the signed-in shell differ.
export const metadata: Metadata = {
  title: { template: "%s · Quản trị", default: "Quản trị" },
  robots: { index: false, follow: false },
};

export default function AdminLayout({ children }: LayoutProps<"/admin">) {
  return children;
}
