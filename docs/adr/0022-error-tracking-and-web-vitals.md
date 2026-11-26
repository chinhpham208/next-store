# ADR-0022: Theo dõi lỗi production bằng `onRequestError` và Web Vitals tổng hợp (M6)

- Trạng thái: Đề xuất (chờ chủ dự án duyệt PR)
- Ngày: 2026-11-26
- Quyết định của chủ dự án: 2026-11-26 (plan M6, Cổng 1, quyết định 8, 9, phương án A)
- Liên quan: [ADR-0005](./0005-hosting.md) (Vercel Hobby, chỉ lên Pro trước khi mở bán), [ADR-0009](./0009-product-404-in-proxy.md) và [ADR-0017](./0017-product-slug-registry-in-proxy.md) (proxy không chạm DB), [ADR-0010](./0010-app-role-and-preview-data.md) (role app chỉ DML), [ADR-0011](./0011-db-query-wrapper.md) (`dbQuery`, thông điệp lỗi cố định), [ADR-0018](./0018-admin-auth.md) (khu admin), [ADR-0023](./0023-admin-orders-and-password-strength.md) (`/admin/errors`), `docs/plans/M6.md` Task 12, 13

## Bối cảnh

`requirements.md` §5 "Vận hành": lỗi production được ghi nhận và báo về. §5 "Hiệu năng": Web Vitals đo trên production theo ngưỡng NFR (LCP < 2,5 s, CLS < 0,1, INP < 200 ms).

Điều đã đọc (plan M6, D1, D3 → D6, D10, D11):

- `src/instrumentation.ts` export `onRequestError(error, request, context)`. `request` có `path` (gồm query), `method` và **`headers` đầy đủ, gồm `cookie`**. `context.routeType` là `render` | `route` | `action` | `proxy`; `context.routePath` là đường dẫn file route. Tác vụ async phải được `await`.
- Vercel Hobby: dữ liệu Observability giữ 12 giờ, runtime log **1 giờ**; Query và alerts chỉ có ở Observability Plus (Pro). Hobby không có cách "báo về" sẵn.
- Speed Insights miễn phí chỉ có điểm RES, không có từng chỉ số LCP / CLS / INP (cần Plus, chỉ Pro). Hạn mức 10.000 sự kiện / 30 ngày, quá thì dừng thu ít nhất 14 ngày.
- Neon Free: 100 CU-giờ / project / tháng; mỗi lần ghi từ trình duyệt đánh thức compute. Hobby: 1.000.000 invocation / tháng, WAF một quy tắc rate limit (đã dùng cho Server Action, ADR-0015).
- `dbQuery` ném thông điệp cố định `database query failed: <tên> (<SQLSTATE>)` hoặc `database query timed out: <tên>` (ADR-0011).
- `npm view` (2026-11-26): `@vercel/speed-insights` 2.1.0, `@sentry/nextjs` 11.18.0.

**Chưa kiểm** (có bước kiểm tại chỗ): C3 (`onRequestError` chạy trên Vercel cho lỗi render và route handler, không chạy cho lỗi đã bắt), C4 (`instrumentation.ts` có vào bundle của proxy không), C8 (Playwright đặt được throttle CDP và đo được LCP / CLS / INP ổn định).

## Các phương án

**Theo dõi lỗi production (quyết định 8)**

| Phương án | Ưu | Nhược |
|---|---|---|
| **A. `onRequestError` + bảng `error_events` (gộp, có trần) + `/admin/errors`**; Orchestrator đọc sau mỗi release | Không thư viện, không tài khoản; giữ 30 ngày (Vercel Hobby chỉ 1 giờ); không dữ liệu người dùng | Không cảnh báo chủ động; không có lỗi phía trình duyệt; lỗi lúc DB chết chỉ có trong log 1 giờ |
| B. Chỉ log + Runtime Logs | Không code | Mất sau 1 giờ; không "báo về" |
| C. Sentry (gói miễn phí) | Cảnh báo email, lỗi trình duyệt, stack trace | Thư viện mới, tài khoản, DSN, thêm `connect-src`, dữ liệu ra bên thứ ba |
| D. Vercel Pro + Observability Plus | Sẵn có, không code | 20 USD / tháng + phí sự kiện; ADR-0005 chỉ lên Pro trước mở bán |

**Web Vitals đo trên Production (quyết định 9)**

| Phương án | Ưu | Nhược |
|---|---|---|
| **A. Đo tổng hợp bằng Playwright trên Production** | Đủ ba chỉ số của NFR; chặn được release; không thư viện, không tài khoản, không ghi DB | Số đo phòng thí nghiệm, không phải người dùng thật; INP từ một thao tác giả lập |
| B. A + Speed Insights miễn phí qua thẻ script | Thêm dữ liệu người dùng thật | Chỉ có điểm RES; dễ chạm hạn mức rồi dừng ≥ 14 ngày |
| C. Tự thu qua route handler `/api/vitals` | Số thật theo từng chỉ số | Route handler công khai thứ hai không có rate limit; mỗi lượt xem một lần ghi Neon và một invocation |
| D. Speed Insights Plus + `@vercel/speed-insights` | Đầy đủ, ít code | Cần Pro + 10 USD / project / tháng; thư viện mới |

## Quyết định

Câu trả lời của chủ dự án ở Cổng 1 (plan M6, mục "Cần chủ dự án quyết"), chép nguyên văn:

> **Đã quyết (2026-11-26, Cổng 1):** chủ dự án duyệt tất cả đề xuất: 1A → 14A.

Phương án được chọn, chép nguyên văn từ plan:

- **Quyết định 8** (Theo dõi lỗi production): **A. `onRequestError` + bảng `error_events` (gộp, có trần) + `/admin/errors`**; Orchestrator đọc sau mỗi release
- **Quyết định 9** (Web Vitals đo trên Production): **A. Đo tổng hợp bằng Playwright trên Production** (mobile, CPU 4×, mạng chậm; LCP / CLS / INP; p75 của 5 lần) sau mỗi release và hằng tuần

Áp như sau.

**Theo dõi lỗi (8A)**

- `src/instrumentation.ts` export `onRequestError`. Nó chỉ chuyển `error`, `request.method`, `context.routeType`, `context.routePath` cho `@/features/monitoring`; **không bao giờ** chuyển `request` nguyên khối, `request.headers` hay `request.path`. Hàm thuần `toErrorReport` không nhận `headers` hay `path` (chữ ký ép điều đó).
- **Trường được ghi:** `routeType`, `routePath` (cắt 200 ký tự), `method` (thuộc danh sách HTTP, khác thì `OTHER`), `digest` (≤ 64 ký tự `[A-Za-z0-9_-]`), tên lớp lỗi (chỉ khi khớp `^[A-Za-z]{1,40}$`, khác thì `Error`), thông điệp **chỉ khi** khớp mẫu cố định của `dbQuery`. **Cấm:** header, cookie, query, đường dẫn thật, IP, thân request, stack, `cause`, SQL, giá trị của thông điệp lỗi tự do.
- **Log:** một dòng cố định `monitoring: request error {"routeType":…,"routePath":…,"digest":…,"errorName":…}`.
- **Bảng `error_events`** (cột ở plan M6 Task 4): khoá chính `fingerprint` (SHA-256 của `routeType|routePath|digest hoặc errorName|message`), `count`, `first_seen_at`, `last_seen_at`; không sequence. Cùng lỗi trên cùng route chỉ một hàng, `count` tăng.
- **Trần:** tối đa 500 hàng (đầy thì không chèn dấu vân tay mới, vẫn đếm dấu đã có), tối đa 30 lần ghi / phút mỗi instance (quá thì chỉ log, không thử DB), giữ 30 ngày (mỗi lần chèn mới dọn tối đa 50 hàng cũ). `routeType === 'proxy'` chỉ log: proxy không chạm DB (ADR-0009, 0017). Ghi lỗi **nuốt** lỗi của chính nó (trả `failed`), không sinh lỗi mới trong lúc báo lỗi.
- **Nạp động:** `@/features/monitoring` chỉ nạp bằng `import()` khi `NEXT_RUNTIME === 'nodejs'` và `routeType !== 'proxy'`, để bundle proxy không kéo `@/db` (C4; dependency-cruiser `proxy-no-db`).
- **Lỗi đã bắt** mà vẫn cần ghi (webhook trả 503, ADR-0021) gọi `recordHandledError`. Lỗi đã bắt khác (`dbQuery` trong action giỏ trả `unavailable`) không được ghi: `onRequestError` không chạy cho nó.
- **"Báo về":** admin xem ở `/admin/errors` (ADR-0023). Orchestrator mở trang này sau `v0.6.0` và sau mỗi release của M6, ghi "đã đọc lại lúc <giờ>: <N> dòng" vào ticket. Không cảnh báo chủ động.

**Web Vitals (9A)**

- Đo bằng Playwright trên Production, **sau mỗi release và hằng tuần** (workflow `production-e2e.yml`, cron thứ Hai 10:23 giờ Việt Nam). Không thư viện, không tài khoản, không ghi DB, không request ghi.
- **Ngưỡng** (`requirements.md` §5): LCP < 2.500 ms, CLS < 0,1, INP < 200 ms.
- **Thiết bị và mạng:** thiết bị `Pixel 7` (mobile), CPU chậm 4×, mạng giả lập gần "Slow 4G" (trễ 150 ms, tải xuống 1.600 kbps, tải lên 750 kbps) qua CDP (`Emulation.setCPUThrottlingRate`, `Network.emulateNetworkConditions`).
- **Thống kê:** p75 của 5 lần đo mỗi trang (7 lần nếu độ lệch giữa các lần ≥ 20 %, C8). CLS tính theo cửa sổ phiên lớn nhất, bỏ dịch chuyển sau tương tác.
- **Trang đo:** `/`, `/products`, trang chi tiết sản phẩm đầu của seed, `/blog`, bài blog mới nhất. INP đo từ một thao tác chỉ đọc (mở bộ lọc, gõ ô tìm kiếm, cuộn).
- **Đỏ khi nào:** chỉ khi `BASE_URL` là Production. Local và preview chỉ ghi số vào `testInfo.annotations`.

**Vì sao không các phương án khác**

- **Không Speed Insights miễn phí (9B):** chỉ có điểm RES, không có từng chỉ số; chạm hạn mức thì dừng thu ít nhất 14 ngày.
- **Không tự thu từ người dùng thật (9C):** thêm route handler công khai thứ hai (ADR-0021 chỉ cho một) không có rate limit; mỗi lượt xem một lần ghi Neon (CU-giờ) và một invocation.
- **Không Sentry (8C), không Vercel Pro (8D):** cần thư viện hoặc tài khoản hoặc tiền; ngoài ngân sách của giai đoạn chưa bán thật.

**Điều kiện xét lại:** mở bán với cổng thật, hoặc lên Vercel Pro. Khi đó xét Observability Plus (cảnh báo, log 30 ngày), Speed Insights Plus (từng chỉ số của người dùng thật) hoặc Sentry; mỗi việc cần ADR mới hoặc bổ sung ADR này.

## Hệ quả

- **Không cảnh báo chủ động.** Lỗi chỉ lộ khi Orchestrator mở `/admin/errors`.
- **Không có lỗi phía trình duyệt.** Lỗi chỉ ở server.
- **Lỗi lúc DB chết** không vào bảng (ghi sẽ thất bại); chỉ có dòng log, mà Hobby giữ 1 giờ. Chấp nhận.
- **Số đo Web Vitals là số phòng thí nghiệm,** không phải người dùng thật; INP từ một thao tác giả lập. Chấp nhận tới khi mở bán.
- **Mỗi instance có bộ đếm riêng,** nên trần 30 lần / phút là theo instance, không toàn cục. Trần 500 hàng là toàn cục.
- **Dữ liệu người dùng không vào bảng,** nhưng `routePath` là đường dẫn file route (`/app/products/[slug]`), không phải URL thật.
- **Cách kiểm:**
  - Vitest `report.test.ts`: `never reads request headers or path`, `stores a message only when it is a fixed dbQuery message`, `keeps the error name only when it is a plain identifier`, `the same error on the same route gives one fingerprint`, `formatErrorLogLine has no cookie, query or header`.
  - Vitest `store.test.ts`: `stops writing after 30 records a minute in one instance`, `inserts no new fingerprint past 500 rows but still counts known ones`, `purges at most 50 rows older than 30 days`, `returns failed instead of throwing when the database fails`; `index.test.ts`: `logs only for routeType proxy`.
  - E2E `ns-monitoring.spec.ts` (server `BROKEN_DB_URL`, trên build thật): `monitoring: lỗi render ghi một dòng cố định, không có cookie, query hay header`, `monitoring: quá 30 lỗi một phút thì không thử ghi DB thêm`.
  - `npm run check:deps`: `proxy-no-db` vẫn xanh sau khi thêm `instrumentation.ts`; Task 12 Step 1 ghi kích thước bundle proxy trước / sau.
  - E2E `nfr-web-vitals.spec.ts`: `NFR hiệu năng: <trang> trên mobile có LCP < 2,5 s, CLS < 0,1, INP < 200 ms (p75 của 5 lần)` (đỏ chỉ trên Production); `web-vitals-math.spec.ts`: `p75 of five values is the fourth smallest`, `cls takes the largest session window and ignores shifts after input`.
  - Orchestrator chạy `workflow_dispatch` của `production-e2e.yml` một lần sau khi merge Task 13 và dán bảng số vào ticket.
