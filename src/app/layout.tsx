import type { Metadata } from "next";
import localFont from "next/font/local";
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
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="vi" className={`${lexend.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col bg-background font-sans text-foreground">{children}</body>
    </html>
  );
}
