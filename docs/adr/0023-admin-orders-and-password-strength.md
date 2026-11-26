# ADR-0023: Danh sách đơn và danh sách lỗi cho admin, độ mạnh `ADMIN_PASSWORD` (M6)

- Trạng thái: Đề xuất (chờ chủ dự án duyệt PR)
- Ngày: 2026-11-26
- Quyết định của chủ dự án: 2026-11-26 (plan M6, Cổng 1, quyết định 6, 7, 10, phương án A)
- Bổ sung: [ADR-0018](./0018-admin-auth.md) (quyết định 5A: thêm luật độ mạnh mật khẩu; thêm hai trang admin chỉ đọc)
- Liên quan: [ADR-0010](./0010-app-role-and-preview-data.md), [ADR-0021](./0021-payment-orders-and-webhook.md) (bảng `orders`), [ADR-0022](./0022-error-tracking-and-web-vitals.md) (bảng `error_events`), [ADR-0020](./0020-content-security-policy-and-hsts.md) (CSP nonce của `/admin`), `docs/plans/M6.md` Task 11, 12, 14, ticket NS-131, NS-132

## Bối cảnh

US-14: admin mở `/admin/orders` thấy đơn mới nhất trước, lọc theo trạng thái, đơn `needs_refund` nổi bật. Cùng mốc có `/admin/errors` (ADR-0022).

ADR-0018 (Hệ quả, audit PR #112 L1): sau NS-132 mọi an toàn chống đoán mật khẩu dựa vào việc `ADMIN_PASSWORD` thật sự ngẫu nhiên; app chỉ kiểm ≥ 20 ký tự, không kiểm entropy. Khoá toàn cục đã bỏ, và với IPv6 một kẻ tấn công đổi địa chỉ trong cùng /64 để lách quy tắc WAF.

Điều đã đọc (plan M6, D9):

- ADR-0018 cấm `route.*` dưới `/admin`; mỗi lối vào admin tự kiểm phiên (`requireAdminPage()` ở dòng đầu mỗi `page.tsx` dưới `(protected)`, `hasAdminSession()` ở dòng đầu mỗi hàm đọc admin).
- `src/admin-session-checks.test.ts` kiểm các quy tắc trên bằng AST; `scripts/check-admin-bundle.mjs` (kiểm 1 → 3) chạy sau `next build`.
- NS-131 (phân trang danh sách sản phẩm admin) đang hoãn có điều kiện vì chỉ có 24 sản phẩm cố định. Đơn thì tăng mãi.

## Các phương án

**Danh sách đơn admin có phân trang không (quyết định 6)**

| Phương án | Ưu | Nhược |
|---|---|---|
| **A. Phân trang ngay: 50 đơn / trang, lọc `?status=`, đếm `needs_refund` riêng** | Không tải mọi đơn; URL chia sẻ được như US-03; dùng lại `Pagination` | Thêm một tham số và test |
| B. 100 đơn mới nhất, không phân trang | Đơn giản | Đơn cũ biến mất khỏi giao diện |
| C. Keyset "Xem thêm" | Nhanh mãi | Không nhảy trang; phức tạp hơn mức cần |

**Admin xử lý đơn `needs_refund` (quyết định 7)**

| Phương án | Ưu | Nhược |
|---|---|---|
| **A. Chỉ xem** | Đúng tiêu chí US-14; không Server Action admin mới, không đổi enum | `needs_refund` không bao giờ "xong" trong app |
| B. Nút "Đã hoàn tiền" → `refunded` | Danh sách sạch dần | Đổi enum (migration), action admin mới, audit; tiền thử không có gì để hoàn |

**Độ mạnh `ADMIN_PASSWORD` (quyết định 10)**

| Phương án | Ưu | Nhược |
|---|---|---|
| **A. Thêm luật ≥ 16 ký tự khác nhau** (ngoài ≥ 20 ký tự) | Chặn mật khẩu lặp / dãy số; `openssl rand -base64 24` luôn qua | Không đo được entropy thật |
| B. Chỉ README + xác nhận | Không đổi code | Không gì ép |
| C. Bắt đúng dạng `openssl rand -base64 24` | Chặt nhất | Mật khẩu ngẫu nhiên từ trình quản lý mật khẩu bị từ chối |

## Quyết định

Câu trả lời của chủ dự án ở Cổng 1 (plan M6, mục "Cần chủ dự án quyết"), chép nguyên văn:

> **Đã quyết (2026-11-26, Cổng 1):** chủ dự án duyệt tất cả đề xuất: 1A → 14A.

Phương án được chọn, chép nguyên văn từ plan:

- **Quyết định 6** (Danh sách đơn admin có phân trang không): **A. Phân trang ngay: 50 đơn / trang (`?page=`), lọc `?status=`, đếm `needs_refund` riêng**
- **Quyết định 7** (Admin xử lý đơn `needs_refund`): **A. Chỉ xem** (US-14); hoàn tiền / đánh dấu đã hoàn ghi ở "Cố ý không làm" có ngưỡng
- **Quyết định 10** (Độ mạnh `ADMIN_PASSWORD`): **A. Thêm luật ≥ 16 ký tự khác nhau** (ngoài ≥ 20 ký tự, fail-closed), README ghi cách sinh và lệnh tự kiểm, chủ dự án xác nhận trước release

Áp như sau.

**`/admin/orders` (6A, 7A)**

- `src/app/admin/(protected)/orders/page.tsx`, `await requireAdminPage()` ở dòng đầu. `metadata.title` là chuỗi literal.
- **Lọc và phân trang qua URL:** `?status=` thuộc `pending` | `paid` | `needs_refund` | `cancelled`, ngoài danh sách thì "tất cả"; `?page=` số nguyên 1 → 10000, sai thì 1. Mỗi trang 50 đơn, sắp `created_at DESC, id DESC` (index `orders_created_at_idx`). Trang vượt số trang thì danh sách rỗng, không lỗi.
- **Đếm:** đếm theo bộ lọc và đếm `needs_refund` (không phụ thuộc bộ lọc) trong **một** `dbQuery({ transaction })` để đọc nhất quán. Dải "N đơn cần hoàn tiền" luôn hiện khi N > 0.
- **Cột:** mã đơn, thời gian (`formatDateTime`, múi giờ `Asia/Ho_Chi_Minh`), trạng thái, tóm tắt món (`Tên × 2, +1 món`), tổng, nhãn "Thử nghiệm" cho đơn `fake`. Hàng `needs_refund` có huy hiệu và lý do bằng chữ, không chỉ bằng màu.
- **Chỉ xem.** Không Server Action admin mới, không route handler, không xuất file, không trang chi tiết đơn, không trạng thái `refunded`. Hoàn tiền / đánh dấu đã hoàn nằm ở "Cố ý không làm" của plan M6 với ngưỡng.

**`/admin/errors` (ADR-0022)**

- `src/app/admin/(protected)/errors/page.tsx`, `await requireAdminPage()` ở dòng đầu; 100 hàng mới nhất theo `last_seen_at`. Chỉ xem.

**Lối vào `admin.ts`**

- Phần admin của `orders` và `monitoring` lộ qua `@/features/orders/admin` và `@/features/monitoring/admin` (`admin.ts`), cùng kiểu với `products` (ADR-0019). Chỉ `src/app/admin/**` được import chúng: dependency-cruiser `products-admin-entry-only-from-admin` đổi thành `admin-entries-only-from-admin` cho `^src/features/(products|orders|monitoring)/admin\.ts$`. `index.ts` của hai miền không re-export phần admin, để bundle cửa hàng không chở code admin (`check:bundle` kiểm 1, 2).
- **Phụ thuộc:** `orders` và `monitoring` import `admin` (`hasAdminSession` trong `admin-queries.ts`, như `products`), nên `architecture.md` §2 có thêm `orders → admin` và `monitoring → admin`; `admin` vẫn không import miền nào.
- Mỗi hàm đọc admin (`listOrdersForAdmin`, `listErrorEventsForAdmin`) bắt đầu bằng `if (!(await hasAdminSession())) throw new Error('admin: no session')`, trước mọi truy vấn. Dữ liệu đơn và lỗi không bao giờ nằm trong `'use cache'`.
- **Không route handler dưới `/admin`** (ADR-0018 vẫn hiệu lực). Không thêm Server Action admin nào ở M6.

**Độ mạnh `ADMIN_PASSWORD` (10A)**

- `resolveAdminConfig` (`config-rules.ts`) thêm luật: mật khẩu (đã trim) có **dưới 16 ký tự khác nhau** (đếm theo code point) thì `weak`, cộng với luật ≥ 20 ký tự của ADR-0018. Luật dùng chung cho `config.ts` và `proxy-api.ts`, nên proxy cũng đóng khi mật khẩu yếu. Khi `weak`, khu admin **đóng** như mọi cấu hình yếu khác (cookie phiên hợp lệ vẫn bị chuyển tới `/admin/login`); không bao giờ mở khi thiếu cấu hình.
- Bổ sung, không thay: ADR-0018 5A (≥ 20 ký tự, so `timingSafeEqual`, fail-closed) vẫn nguyên.
- **Cách sinh:** `openssl rand -base64 24` (24 byte, khoảng 144 bit); test Vitest sinh 1.000 mẫu như vậy, mọi mẫu đều qua. README thêm mục "Sinh mật khẩu admin".
- **Cách chủ dự án tự kiểm** (trên Mac, đọc từ clipboard, không in mật khẩu): lệnh trong README in hai số, độ dài và số ký tự khác nhau; cả hai phải ≥ 20 và ≥ 16. Chủ dự án xác nhận mật khẩu Production và Preview **trước `v0.6.0`** (plan M6, "Việc của chủ dự án" 2); Orchestrator đọc lại Vercel và ghi "đã đọc lại lúc <giờ>: <trạng thái>". PR Task 14 không vào release Production trước khi có xác nhận đó.

## Hệ quả

- **`needs_refund` không bao giờ "xong" trong app.** Danh sách đó chỉ dài thêm; dải "N đơn cần hoàn tiền" đếm mãi. Điều kiện làm tiếp nằm ở "Cố ý không làm" của plan M6 (cổng thật có API hoàn tiền, hoặc Production có đơn `needs_refund` thật).
- **Offset 50 / trang đủ nhanh** tới vài chục nghìn đơn với index `(created_at desc, id desc)`. Xét keyset khi bảng `orders` quá 10.000 hàng hoặc truy vấn `orders.admin-list` quá 300 ms.
- **Luật 16 ký tự khác nhau từ chối nhiều passphrase kiểu diceware:** 4 đến 5 từ thường chỉ có 13 đến 17 chữ cái khác nhau, nên có cụm dài vẫn bị từ chối. Chủ dự án dùng `openssl rand -base64 24` (hoặc trình quản lý mật khẩu sinh ngẫu nhiên), không dùng passphrase.
- **Luật 16 ký tự khác nhau không đo entropy.** Mật khẩu dễ đoán mà đa dạng ký tự vẫn qua. An toàn chống đoán vẫn dựa vào việc mật khẩu được sinh ngẫu nhiên (ADR-0018 audit PR #112 L1), cho nên xác nhận của chủ dự án vẫn cần.
- **Mật khẩu không đạt thì khu admin Production đóng** tới khi đổi (fail-closed). Vì vậy PR Task 14 đi cùng xác nhận của chủ dự án.
- **Thêm hai route dưới `(protected)`** nên `check-admin-bundle.mjs` kiểm 3 (mọi route `/admin…` có `response: "empty"`, `htmlSize` 0) liệt kê `/admin/orders`, `/admin/errors` là bắt buộc.
- **Cách kiểm:**
  - Vitest `admin-queries.test.ts` (orders): `listOrdersForAdmin throws without a session before any query`, `US-14: returns orders newest first`, `US-14: filters by status`, `returns at most 50 orders, newest first, and the page count`, `counts needs_refund whatever the filter`, `a page past the end is empty`; (monitoring) `listErrorEventsForAdmin throws without a session before any query`.
  - Vitest `list-params.test.ts`: `parseOrderListParams falls back to all statuses and page 1`; `admin-order-table.test.ts`: `US-14: a needs_refund row carries a badge and the reason, not colour alone`.
  - Vitest `config.test.ts` (admin): `is disabled when the password has fewer than 16 distinct characters`, `accepts passwords made like openssl rand -base64 24`; `proxy-api` / `proxy.test.ts`: `the proxy closes /admin for a weak password`.
  - E2E `ns-123-admin-guard.spec.ts`: `NS-123: /admin/orders không phiên thì 307 tới /admin/login`, `NS-123: /admin/errors không phiên thì 307 tới /admin/login`, `NS-123: POST next-action tới /admin/orders không phiên thì 401`.
  - E2E `ns-csp.spec.ts`: `NS-csp: /admin/orders hydrate dưới CSP nonce`, `NS-csp: /admin/errors hydrate dưới CSP nonce`.
  - E2E `ns-closed-config.spec.ts`: `closed: mật khẩu admin yếu thì cookie phiên hợp lệ vẫn bị chuyển tới /admin/login` (trên build thật, server `CLOSED_CONFIG_URL`).
  - `npm run check:bundle` (kiểm 1 → 3) xanh với `/admin/orders`, `/admin/errors`; `src/admin-session-checks.test.ts` xanh trên file mới (không sửa luật).
  - Plan M6 Task 17 (E2E US-14) kiểm sắp xếp, lọc, đơn `needs_refund` nổi bật.
