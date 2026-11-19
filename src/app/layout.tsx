import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "next-store", template: "%s · next-store" },
  description: "Cửa hàng online đồ dùng cho lập trình viên: áo thun, cốc, sticker, sách.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="vi" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
