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
| [0003](./adr/0003-cache-strategy.md) | Cache Components với tag và làm mới theo sự kiện | Đã chấp nhận |
| [0004](./adr/0004-payment-vietnam.md) | Thanh toán hướng tới cổng Việt Nam, bỏ Stripe | Đã chấp nhận |
| [0005](./adr/0005-hosting.md) | Vercel + Neon, CI trên GitHub Actions | Đề xuất |

## Quản lý công việc

Các mốc, user story và task được theo dõi trên YouTrack (project `NS`). Tài liệu trong thư mục này là nguồn chính; issue trên YouTrack liên kết ngược về đây.
