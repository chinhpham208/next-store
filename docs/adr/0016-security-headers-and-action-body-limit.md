# ADR-0016: Header bảo mật toàn site và giới hạn body của Server Action

- Trạng thái: Đã chấp nhận (Orchestrator quyết, chủ dự án giao Orchestrator các việc kỹ thuật)
- Ngày: 2026-11-24
- Ticket: NS-108, phát hiện Low của audit M4 (NS-96)
- Bổ sung: [ADR-0014](./0014-cart-storage-and-cookie.md) (mục Hệ quả, gạch đầu dòng CSRF: body Server Action không còn tối đa 1 MB mặc định)
- Liên quan: [ADR-0009](./0009-product-404-in-proxy.md) (proxy rewrite slug lạ sang trang not-found), [ADR-0015](./0015-edge-rate-limit.md) (giới hạn tốc độ cho Server Action), `docs/plans/M4.md` D4, Task 11 Step 2 mục (6)

## Bối cảnh

Audit M4 (NS-96) ghi hai việc Low:

1. Site không gửi header nào chống nhúng trong iframe (clickjacking), chống đoán kiểu nội dung (MIME sniffing), hay giới hạn `Referer` gửi sang site khác. Từ M4 trang sản phẩm có nút "Thêm vào giỏ", nên một trang lạ nhúng trang sản phẩm trong iframe trong suốt có thể dụ khách bấm.
2. Server Action nhận body tối đa 1 MB (mặc định của Next.js, plan M4 D4). Payload thật của ba action giỏ (`{ slug, quantity }`, `{ slug }`) chỉ vài chục byte. Mỗi action là một POST công khai, nên ai cũng bắt được server đọc và parse tới 1 MB mỗi request. Plan M4 Task 11 Step 2 (6) đã đề xuất `16kb`.

Điều đã đọc (Next.js 16.4.6, `node_modules/next`):

- `headers()` trong `next.config` áp theo đường dẫn của request, cho mọi loại response: trang, route handler, ảnh OG, `sitemap.xml`, `robots.txt`, file tĩnh. `src/proxy.ts` chỉ chạy cho `/products/*` và `/blog/*` (matcher), nên không phải chỗ đặt header toàn site.
- Khoá cấu hình là `experimental.serverActions.bodySizeLimit` (`server/config-shared.d.ts`, `server/config-schema.js`; docs `01-app/03-api-reference/05-config/01-next-config-js/serverActions.md`). Giới hạn áp cho body HTTP thô.
- Fetch action có body vượt giới hạn: `server/app-render/action-handler.js` ném `ApiError(413)` khi đọc body, nhưng nhánh bắt lỗi của fetch action đặt `statusCode = 500` (có TODO "respond with a 413"). Body không được decode, action không chạy.

## Quyết định

- **Bốn header cho mọi đường dẫn** (`source: '/:path*'` trong `next.config.ts`):
  - `X-Frame-Options: DENY` và `Content-Security-Policy: frame-ancestors 'none'`: không trang nào của site được nhúng trong frame. Giữ cả hai: `frame-ancestors` là chuẩn hiện hành, `X-Frame-Options` cho trình duyệt cũ.
  - `X-Content-Type-Options: nosniff`.
  - `Referrer-Policy: strict-origin-when-cross-origin` (cũng là mặc định của trình duyệt hiện đại; ghi rõ để không phụ thuộc trình duyệt).
- **CSP chỉ có `frame-ancestors`.** Không đặt `script-src` / `default-src` ở ADR này: Cache Components và RSC chèn script inline (payload RSC), nên một CSP script đầy đủ cần nonce hoặc hash và làm trang thành động hoặc phải đo lại. Đó là quyết định riêng nếu cần.
- **`experimental.serverActions.bodySizeLimit = '16kb'`.** Gấp hàng trăm lần payload thật của giỏ, nhỏ hơn mặc định 64 lần. Action mới cần body lớn hơn (ví dụ upload ở M5) phải viết ADR mới hoặc đổi giá trị này cùng lý do.

## Hệ quả

- Body vượt 16 KB nhận **500** (không phải 413) từ Next.js 16.4.6, không có dòng log nào của app. Client không bao giờ gửi body như vậy (form chỉ có slug và số lượng), nên khách không thấy lỗi này. Không chặn ở `src/proxy.ts` theo `Content-Length` để trả 413: proxy không chạy cho `/cart` và trang chủ, và header đó có thể vắng (chunked). Khi Next.js đổi sang 413, E2E `ns-108-action-body-limit.spec.ts` đỏ và cần sửa theo.
- Header có trên 404 do proxy rewrite (`/_khong-tim-thay`), ảnh OG, sitemap, robots: Vitest `src/next-config.test.ts` (`unstable_getResponseFromNextConfig`) kiểm cấu hình, `scripts/smoke.sh` kiểm response thật trên `next start`, preview, Dev và Production (Vercel giữ nguyên header của `headers()`).
- Không trang nào của site nhúng được trong iframe, kể cả từ chính site. Hiện không có chỗ nào cần; nếu sau này cần (ví dụ xem trước trong admin M5) thì đổi sang `frame-ancestors 'self'` và `X-Frame-Options: SAMEORIGIN`.
- Kiểm chứng: Vitest `src/next-config.test.ts`; `scripts/smoke.sh` + ca `security-headers` của `scripts/smoke.test.sh`; E2E `e2e/ns-108-action-body-limit.spec.ts` (payload thật qua, 15 KB tới action, 17 KB bị từ chối với 500).
