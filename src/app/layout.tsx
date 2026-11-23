import type { Metadata } from "next";
import localFont from "next/font/local";
import { getSiteUrl } from "@/lib/site-url";
import "./globals.css";

// Self-hosted (no next/font/google, M1 Global Constraints): full Vietnamese coverage, SIL OFL.
const lexend = localFont({
  src: "./fonts/lexend-full-wght.woff2",
  weight: "100 900",
  display: "swap",
  variable: "--font-lexend",
});

export const metadata: Metadata = {
  title: { default: "next-store", template: "%s · next-store" },
  description: "Cửa hàng online đồ dùng cho lập trình viên: áo thun, cốc, sticker, sách.",
  // Without it og:image resolves to http://localhost:3000 on every deployment (M3 K6).
  metadataBase: getSiteUrl(),
  // The only openGraph outside /blog/[slug]: a page that declares its own drops these and the inherited og:image (K5).
  openGraph: { siteName: "next-store", locale: "vi_VN", type: "website" },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="vi" className={`${lexend.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col bg-background font-sans text-foreground">{children}</body>
    </html>
  );
}
