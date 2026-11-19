# ADR-0001: Dùng PGlite khi phát triển, Postgres khi triển khai, qua Drizzle

- Trạng thái: Đã chấp nhận
- Ngày: 2026-11-19

## Bối cảnh

Cửa hàng cần một database quan hệ (sản phẩm, giỏ hàng, đơn hàng, transaction khi trừ kho). Yêu cầu "dễ chạy" đòi hỏi người dùng chạy được dự án mà không phải cài database. Môi trường build tự động không có Docker.

## Các phương án

| Phương án | Ưu | Nhược |
|---|---|---|
| Postgres chạy bằng Docker | Giống production nhất | Phải cài Docker; môi trường build không có Docker |
| **PGlite (Postgres biên dịch sang WASM, chạy trong Node)** | Không cài gì; đúng phương ngữ Postgres; có transaction | Chỉ một tiến trình truy cập một lúc; không dùng cho production |
| SQLite | Đơn giản, phổ biến | Khác Postgres (kiểu dữ liệu, câu lệnh); muốn lên Postgres phải viết lại schema |

## Quyết định

Dùng **Drizzle ORM** với hai driver:
- Không có `DATABASE_URL` → PGlite, dữ liệu lưu trong thư mục `.data/` (đã `.gitignore`).
- Có `DATABASE_URL` → driver Postgres thật.

Schema viết một lần bằng `drizzle-orm/pg-core`, dùng chung cho cả hai.

## Hệ quả

- `npm install && npm run db:seed && npm run dev` là chạy được.
- Lên production chỉ cần đặt `DATABASE_URL`.
- PGlite chỉ cho một tiến trình mở thư mục dữ liệu: không chạy `next dev` và `db:seed` cùng lúc. Ghi trong README.
- `next build` cần đọc DB cho các trang tĩnh → seed phải chạy trước build.
