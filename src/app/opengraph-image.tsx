import { OG_CONTENT_TYPE, OG_SIZE, renderOgImage } from "@/lib/og-image";

export const alt = "next-store: đồ dùng cho dân code";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  return renderOgImage({
    eyebrow: "Áo thun · Cốc · Sticker · Sách",
    title: "Đồ dùng cho dân code.",
    footer: "Cửa hàng online cho lập trình viên",
  });
}
