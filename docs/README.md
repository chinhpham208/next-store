# Tài liệu next-store

## Đọc theo thứ tự

| # | Tài liệu | Trả lời câu hỏi |
|---|---|---|
| 1 | [`requirements.md`](./requirements.md) | Làm **cái gì**, cho **ai**, thế nào là **xong** |
| 2 | [`architecture.md`](./architecture.md) | Hệ thống trông thế nào (sơ đồ) |
| 3 | [`design.md`](./design.md) | Xây **như thế nào**: công nghệ, cấu trúc, luồng, cache, các mốc |
| 4 | [`adr/`](./adr) | **Vì sao** chọn như vậy mà không chọn cách khác |
| 5 | [`conventions.md`](./conventions.md) | Viết code theo quy ước nào |
| 6 | [`process.md`](./process.md) | Đội làm việc thế nào: vai trò, quy trình ticket → PR → deploy |
| 7 | [`plans/`](./plans) | Plan chi tiết của từng mốc |

## Quyết định kiến trúc (ADR)

| ADR | Quyết định | Trạng thái |
|---|---|---|
| [0001](./adr/0001-database-pglite.md) | PGlite khi phát triển, Postgres khi triển khai, qua Drizzle | Đã chấp nhận |
| [0002](./adr/0002-payment-provider.md) | Thanh toán qua `PaymentProvider`, có bản Fake | Thay thế một phần bởi 0004 |
| [0003](./adr/0003-cache-strategy.md) | Cache Components với tag và làm mới theo sự kiện | Đã chấp nhận; bổ sung bởi 0008 |
| [0004](./adr/0004-payment-vietnam.md) | Thanh toán hướng tới cổng Việt Nam, bỏ Stripe | Đã chấp nhận |
| [0005](./adr/0005-hosting.md) | Vercel + Neon, CI trên GitHub Actions | Đã chấp nhận (2026-11-20); thay thế một phần bởi 0006 |
| [0006](./adr/0006-branch-strategy.md) | Nhánh `develop` → `production`, `main` đóng băng | Đã chấp nhận; thay thế một phần bởi 0007 |
| [0007](./adr/0007-dev-neon-branch.md) | Dev dùng Neon branch do tích hợp tự tạo cho nhánh `develop` | Đã chấp nhận; thay thế một phần 0006 |
| [0008](./adr/0008-listing-cache-keys.md) | Danh sách sản phẩm cache theo khoá đã chuẩn hoá; tìm theo `q` không cache | Đã chấp nhận; bổ sung 0003 |
| [0009](./adr/0009-product-404-in-proxy.md) | `proxy.ts` trả 404 thật cho slug sản phẩm không tồn tại; fail-open khi DB lỗi hoặc chậm | Đã chấp nhận |

## Quản lý công việc

Các mốc, user story và task được theo dõi trên YouTrack (project `NS`). Tài liệu trong thư mục này là nguồn chính; issue trên YouTrack liên kết ngược về đây.
