# ADR-0005: Hosting trên Vercel + Neon, CI trên GitHub Actions

- Trạng thái: Đề xuất — chờ chủ dự án xác nhận tài khoản; thay thế một phần bởi [ADR-0006](./0006-branch-strategy.md) (nhánh kích hoạt deploy production, bảo vệ nhánh `main`)
- Ngày: 2026-11-19

## Bối cảnh

Sản phẩm cần chạy công khai trên internet, có môi trường preview cho mỗi PR, và chi phí thấp trong giai đoạn chưa bán. Khi mở bán, hosting phải cho phép dùng thương mại.

## Các phương án

| Phương án | Ưu | Nhược |
|---|---|---|
| **Vercel + Neon** | Hỗ trợ đầy đủ Next.js 16 (Cache Components, `updateTag`); preview tự động cho mỗi PR; Neon tạo branch DB cho mỗi preview; miễn phí khi chưa bán | Gói Hobby chỉ cho dùng phi thương mại — phải lên Pro (20 USD/tháng) khi bắt đầu thu tiền; phụ thuộc nhà cung cấp |
| VPS + Docker (ví dụ Coolify) | Rẻ (5–10 USD/tháng), dùng thương mại được ngay, không phụ thuộc | Tự vận hành: cập nhật, backup, SSL, giám sát; preview mỗi PR phải tự dựng; cache của Next.js phải tự cấu hình khi chạy nhiều instance |
| Cloudflare / Netlify qua OpenNext | Chi phí thấp | Hỗ trợ tính năng mới của Next.js đến sau Vercel; thêm một lớp chuyển đổi |

## Quyết định

- **App:** Vercel, gói Hobby trong giai đoạn hiện tại (chưa thu tiền); chuyển Pro trước khi mở bán.
- **Database:** Neon Free — 1 GB mỗi project, đủ cho giai đoạn này; nâng cấp là đổi gói, không cần chuyển dữ liệu. Tích hợp Neon ↔ Vercel để mỗi preview có branch DB riêng.
- **CI:** GitHub Actions chạy typecheck, lint, `check:deps`, Vitest, build, Playwright trên mọi PR, dùng PGlite (không cần DB thật). Nhánh `main` được bảo vệ: phải qua CI và có review.
- **Deploy:** Vercel tự deploy preview cho mỗi PR và production khi merge vào `main`. Bước build trên Vercel: `npm run build:vercel` = migrate → seed (preview luôn seed; production chỉ seed khi DB trống) → `next build`.

## Hệ quả

- Chủ dự án cần tạo tài khoản Vercel và Neon, kết nối Vercel với repo GitHub.
- Ảnh sản phẩm nằm trong repo trong giai đoạn này; khi có upload ảnh sẽ cần thêm nơi lưu trữ (Vercel Blob hoặc Cloudflare R2) — ADR riêng.
- Khi mở bán: nâng Vercel lên Pro (bắt buộc theo điều khoản), cân nhắc gói trả phí của Neon để có thời gian khôi phục dữ liệu dài hơn.
- Nếu sau này chuyển sang VPS: chỉ đổi nơi deploy và `DATABASE_URL`; code không phụ thuộc API riêng của Vercel.
