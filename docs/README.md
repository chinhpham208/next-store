# Tài liệu next-store

## Đọc theo thứ tự

| # | Tài liệu | Trả lời câu hỏi |
|---|---|---|
| 0 | [`overview.md`](./overview.md) | **Toàn cảnh** hạ tầng (nhánh → Vercel → Neon, CI) và quy trình một mốc, bằng sơ đồ |
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
| [0003](./adr/0003-cache-strategy.md) | Cache Components với tag và làm mới theo sự kiện | Đã chấp nhận; bổ sung bởi 0008, 0014, 0019 |
| [0004](./adr/0004-payment-vietnam.md) | Thanh toán hướng tới cổng Việt Nam, bỏ Stripe | Đã chấp nhận |
| [0005](./adr/0005-hosting.md) | Vercel + Neon, CI trên GitHub Actions | Đã chấp nhận (2026-11-20); thay thế một phần bởi 0006 |
| [0006](./adr/0006-branch-strategy.md) | Nhánh `develop` → `production`, `main` đóng băng | Đã chấp nhận; thay thế một phần bởi 0007 |
| [0007](./adr/0007-dev-neon-branch.md) | Dev dùng Neon branch do tích hợp tự tạo cho nhánh `develop` | Đã chấp nhận; thay thế một phần 0006 |
| [0008](./adr/0008-listing-cache-keys.md) | Danh sách sản phẩm cache theo khoá đã chuẩn hoá; tìm theo `q` không cache | Đã chấp nhận; bổ sung 0003; bổ sung bởi 0011 |
| [0009](./adr/0009-product-404-in-proxy.md) | `proxy.ts` trả 404 thật cho slug sản phẩm không tồn tại; fail-open khi DB lỗi hoặc chậm | Đã chấp nhận; bổ sung bởi 0012, 0014; thay thế một phần bởi 0017 |
| [0010](./adr/0010-app-role-and-preview-data.md) | Runtime dùng role `next_store_app`; preview có database Neon riêng (B1, chờ xác nhận tại chỗ) | Đã chấp nhận (2026-11-22); bổ sung 0007 |
| [0011](./adr/0011-db-query-wrapper.md) | Truy vấn runtime chỉ qua `dbQuery` của `@/db`: lỗi cố định, có giới hạn thời gian; `db` thô không export | Đã chấp nhận (2026-11-22); bổ sung 0008; thay thế một phần bởi 0013 |
| [0012](./adr/0012-blog-static-registry.md) | Blog: MDX tĩnh, registry TypeScript, 404 bằng danh sách slug trong proxy | Đã chấp nhận (chủ dự án duyệt hướng ở Cổng 1, 2026-11-22); bổ sung bởi 0014 |
| [0013](./adr/0013-db-client-recycle.md) | `dbQuery` hết giờ thì dựng lại client Postgres (mạng nuốt gói); chỉ `src/db` chạm driver | Đã chấp nhận (2026-11-23); thay thế một phần 0011 |
| [0014](./adr/0014-cart-storage-and-cookie.md) | Giỏ hàng lưu trong DB (`carts`, `cart_items`), cookie `httpOnly` chỉ giữ UUID v4 do server sinh, hết hạn 30 ngày trượt; giá hiện tại; biểu tượng giỏ là lỗ động ở mọi trang `(shop)`; proxy bỏ qua request không phải `GET` / `HEAD` | Đã chấp nhận; bổ sung 0003, 0009, 0012; bổ sung bởi 0016, 0019 |
| [0015](./adr/0015-edge-rate-limit.md) | Một quy tắc rate limit Vercel WAF (gói Hobby) cho Server Action: `POST`, theo IP, 60 request / 60 s, Log rồi 429; tìm kiếm `q` và slug lạ chưa có giới hạn | Đã chấp nhận; bổ sung 0008, 0009; bổ sung bởi 0018 |
| [0016](./adr/0016-security-headers-and-action-body-limit.md) | Header bảo mật toàn site qua `headers()` (X-Frame-Options, CSP chỉ `frame-ancestors`, nosniff, Referrer-Policy); body Server Action tối đa 16 KB | Đã chấp nhận; bổ sung 0014; thay thế một phần bởi 0020 |
| [0017](./adr/0017-product-slug-registry-in-proxy.md) | ADR-0017: proxy trả 404 cho slug sản phẩm bằng registry tĩnh trong repo (`catalog-slugs.ts`), không tra DB; bỏ fail-open và cờ `SMOKE_PRODUCT_FAIL_OPEN` (NS-79) | Đã chấp nhận; thay thế một phần 0009 |
| [0018](./adr/0018-admin-auth.md) | ADR-0018: xác thực admin bằng `ADMIN_PASSWORD` trong env (`timingSafeEqual`), phiên cookie ký HMAC `SameSite=Strict` 8 giờ, CSRF bằng `SameSite` + `Origin`, giới hạn đăng nhập sai trong app 5 / 15 phút mỗi IPv4 hay IPv6 /64 (khoá toàn cục bỏ ở NS-132); fail-closed | Đề xuất; bổ sung 0015 |
| [0019](./adr/0019-product-edits-and-cache-tags.md) | ADR-0019: sửa sản phẩm bằng một Server Action kiểm `updated_at`; tag riêng `product-slugs` cho danh sách slug; "Mới nhất" theo `created_at`; xoá = ẩn bằng `archived_at`; giỏ vẫn dùng giá hiện tại | Đề xuất; bổ sung 0003, 0014 |
| [0020](./adr/0020-content-security-policy-and-hsts.md) | ADR-0020: CSP nền toàn site ("Without Nonces", `'unsafe-inline'`), CSP nonce `'strict-dynamic'` chỉ cho `/admin`; HSTS mặc định của Vercel | Đề xuất; thay thế một phần 0016 |

## Quản lý công việc

Các mốc, user story và task được theo dõi trên YouTrack (project `NS`). Tài liệu trong thư mục này là nguồn chính; issue trên YouTrack liên kết ngược về đây.
