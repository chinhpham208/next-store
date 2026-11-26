# ADR-0020: CSP nền toàn site, CSP nonce cho `/admin`, HSTS mặc định của Vercel

- Trạng thái: Đã chấp nhận (chủ dự án duyệt 2026-11-25, PR #99)
- Ngày: 2026-11-25
- Quyết định của chủ dự án: 2026-11-25 (plan M5, Cổng 1, quyết định 9, 10, phương án A)
- Thay thế một phần: [ADR-0016](./0016-security-headers-and-action-body-limit.md) (gạch đầu dòng "CSP chỉ có `frame-ancestors`"; `Content-Security-Policy: frame-ancestors 'none'` đơn lẻ được thay bằng CSP nền đầy đủ, vẫn có `frame-ancestors 'none'`)
- Liên quan: [ADR-0003](./0003-cache-strategy.md) (Cache Components, prerender), [ADR-0005](./0005-hosting.md) (Vercel), [ADR-0018](./0018-admin-auth.md) (khu admin), `docs/plans/M5.md` Task 12, 13, ticket NS-108

## Bối cảnh

`requirements.md` §5 yêu cầu "header bảo mật cơ bản (CSP, HSTS)". ADR-0016 (M4) chỉ đặt `frame-ancestors 'none'` trong CSP, vì Cache Components và RSC chèn script inline (payload RSC): một CSP script đầy đủ cần nonce hoặc hash, và việc đó là quyết định riêng. Từ M5 site có khu admin sửa được dữ liệu sản phẩm.

Điều đã đọc (Next.js 16.4.6, `02-guides/content-security-policy.md`, plan M5 D3):

- CSP có nonce bắt buộc render động; "Partial Prerendering (PPR) is incompatible with nonce-based CSP".
- Không cần nonce thì đặt CSP trong `headers()` với `script-src 'self' 'unsafe-inline'` (mục "Without Nonces").
- SRI (`experimental.sri`) là lựa chọn thử nghiệm giữ được trang tĩnh.
- Next.js tự gắn nonce vào script của trang khi **request** mang header `Content-Security-Policy` có `'nonce-…'` (proxy đặt).

Điều đã đọc về HSTS ([Vercel — Encryption and TLS](https://vercel.com/docs/cdn-security/encryption), mục "Support for HSTS", đọc 2026-11-25, plan M5 D11): `*.vercel.app` tự có `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload;` (đã preload); domain riêng có `max-age=63072000;`. Đổi được bằng header tuỳ biến.

Trang cửa hàng (`/`, `/products`, `/products/[slug]`, blog) prerender và có lỗ động biểu tượng giỏ (ADR-0003, ADR-0014); NFR hiệu năng dựa vào việc đó. Trang admin vốn đã động (đọc cookie, đọc DB không cache).

## Các phương án

**CSP (quyết định 9)**

| Phương án | Ưu | Nhược |
|---|---|---|
| **A. CSP nền toàn site** theo mục "Without Nonces" của Next.js (`default-src 'self'`, `script-src 'self' 'unsafe-inline'`, `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`, `frame-ancestors 'none'`, …) **+ CSP nonce `'strict-dynamic'` cho `/admin`** (trang động) | Trang cửa hàng giữ prerender; chặn script ngoài, `<object>`, đổi `<base>`, form gửi ra ngoài; khu nhạy cảm có CSP chặt | `'unsafe-inline'` trên trang cửa hàng không chặn được XSS inline (React đã escape; không có HTML do người dùng nhập ngoài admin) |
| B. SRI thử nghiệm (`experimental.sri`) + CSP không `'unsafe-inline'` toàn site | Chặt nhất mà vẫn tĩnh | Thử nghiệm; payload RSC inline có thể bị chặn; chưa kiểm với Cache Components |
| C. Nonce toàn site | Chặt | Mọi trang thành động, mất PPR (D3), trái NFR hiệu năng |

**HSTS (quyết định 10)**

| Phương án | Ưu | Nhược |
|---|---|---|
| **A. Dùng header mặc định của Vercel** (`*.vercel.app`: `max-age=63072000; includeSubDomains; preload`); smoke kiểm có header trên Dev và Production | Không cấu hình; domain đã preload | Khi gắn domain riêng, mặc định chỉ `max-age=63072000` (không `includeSubDomains`): xét lại lúc đó |
| B. Tự đặt trong `headers()` | Ghi rõ trong repo | Trùng header của Vercel; đặt `includeSubDomains` trên domain riêng là quyết định riêng |

## Quyết định

Câu trả lời của chủ dự án ở Cổng 1 (plan M5, mục "Cần chủ dự án quyết"), chép nguyên văn:

> **Đã quyết (2026-11-25):** chủ dự án duyệt tất cả đề xuất: 1A, 2A, 3A, 4A, 5A, 6A, 7A, 8A, 9A, 10A, 11A, 12A, 13A, 14A, 15A, 16A, 17A.

Quyết định 9A và 10A áp như sau. Chuỗi chính xác nằm ở plan M5 Task 12 và trong code (`next.config.ts`, `src/features/admin/csp.ts`); Task 12 Step 1 có thể thêm nguồn nếu kiểm tại chỗ đòi hỏi, theo các điều kiện dưới đây.

- **CSP nền cho mọi đường dẫn** (`headers()` trong `next.config.ts`, `source: '/:path*'`), thay `frame-ancestors 'none'` đơn lẻ của ADR-0016:
  `default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; upgrade-insecure-requests`.
  `'unsafe-eval'` chỉ thêm khi `NODE_ENV=development` (dev server của Next cần nó). Nguồn thanh công cụ Vercel (`vercel.live`) chỉ thêm nếu kiểm tại chỗ C4 cho thấy cần, và chỉ khi `VERCEL_ENV=preview`.
- **Giữ** ba header còn lại của ADR-0016: `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`.
- **CSP nonce cho `/admin/*`:** proxy (nhánh `/admin`, ADR-0018), khi cho request đi tiếp, sinh nonce mới mỗi request (`newNonce`: base64 của 16 byte `crypto.getRandomValues`) và đặt
  `default-src 'self'; script-src 'self' 'nonce-<nonce>' 'strict-dynamic'; style-src 'self' 'nonce-<nonce>'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'`
  vào **cả request header** (để Next.js gắn nonce vào script của trang) **và response header**. Trình duyệt áp đồng thời CSP nền của `headers()` và CSP nonce (giao của hai chính sách); trang admin phải chạy được dưới giao đó (kiểm tại chỗ C5).
- **Trang `(shop)` không bao giờ có nonce**, để giữ prerender / PPR.
- **HSTS:** không đặt trong repo; dựa vào header mặc định của Vercel. Smoke kiểm `Strict-Transport-Security` có mặt với `max-age` ≥ 31536000 **chỉ** khi URL là Vercel (Dev, Production); local và CI bỏ qua.
- **Loại B (SRI)** bây giờ: thử nghiệm, payload RSC inline có thể bị chặn, chưa kiểm với Cache Components. Ghi là **hướng thử sau** để bỏ `'unsafe-inline'` khỏi trang cửa hàng mà vẫn tĩnh.
- **Loại C:** mọi trang thành động, mất PPR, trái NFR hiệu năng.
- **Loại 10B:** trùng header của Vercel; `includeSubDomains` cho domain riêng là quyết định riêng.

## Hệ quả

- **Trang cửa hàng vẫn cho script inline** (`'unsafe-inline'`). CSP nền không chặn XSS inline ở đó; nó chặn script từ nguồn ngoài, `<object>`, đổi `<base>`, form gửi ra site khác, nhúng frame. Rủi ro chấp nhận: React escape mọi chuỗi, trang cửa hàng không render HTML do người dùng nhập; nội dung admin nhập (tên, mô tả) hiển thị dạng văn bản.
- **Khu admin có CSP chặt** (nonce + `'strict-dynamic'`): script inline không mang nonce bị chặn. Trang admin vốn động nên nonce không làm mất gì.
- **Mỗi nguồn ngoài mới** (analytics, font CDN, ảnh ngoài, cổng thanh toán M6 nếu nhúng script hay gửi form ra ngoài) phải được thêm vào CSP trong cùng PR. Đặc biệt M6: `form-action 'self'` chặn form POST thẳng tới cổng thanh toán, và chuyển hướng 303 sau Server Action sang domain cổng có thể bị `form-action` chặn ở một số trình duyệt; M6 phải kiểm lại và ghi vào ADR của M6.
- **Vi phạm không gỡ được bằng một nguồn `'self'`** ở Task 12 Step 1 (C4, C5) → dừng, báo Orchestrator, xét lại quyết định 9.
- **HSTS phụ thuộc Vercel.** Khi gắn domain riêng, mặc định chỉ có `max-age=63072000` (không `includeSubDomains`, không `preload`): xét lại lúc đó (ADR mới hoặc bổ sung). Chạy ngoài Vercel (VPS) thì không có HSTS cho tới khi tự đặt.
- **ADR-0016 còn hiệu lực** ở mọi phần khác: ba header, `bodySizeLimit = '16kb'`, ghi chú về `frame-ancestors 'self'` nếu sau này cần xem trước trong iframe.
- **Cách kiểm:**
  - Vitest `src/next-config.test.ts`: `sets the baseline CSP on every path` (từng chỉ thị), `keeps X-Frame-Options, nosniff and Referrer-Policy`.
  - Vitest `csp.test.ts`: `builds the admin CSP with the nonce in script-src and style-src`, `newNonce returns 24 base64 characters and differs each call`; `proxy.test.ts`: `sets a fresh nonce CSP on admin requests and responses`, `never sets a nonce CSP for shop pages`.
  - E2E `ns-csp.spec.ts`: không có `securitypolicyviolation` trên trang chủ, danh sách, chi tiết + thêm vào giỏ, `/cart`, blog, đăng nhập admin, sửa sản phẩm; HSTS trên Dev / Production.
  - `scripts/smoke.sh`: CSP đủ chỉ thị; HSTS khi URL là Vercel.
  - Bảng route của `next build` vẫn có vỏ prerender cho `/products/[slug]`.
  - Audit Task 13 Step 6 đọc response thật trên Dev.

## Bổ sung khi làm plan M5 Task 12 (NS-127)

Điều đo được khi làm (Next.js 16.4.6, `next build` + `next start`, Chrome), không đổi quyết định 9A / 10A:

- **"Trang admin vốn động" không đúng dưới Cache Components** (audit PR #105 L3): trước Task 12 `/admin/login`, `/admin/products`, `/admin/products/[slug]` là ◐ (vỏ prerender). Vỏ prerender được phục vụ với `<script>` không có nonce, nên dưới CSP nonce `'strict-dynamic'` trình duyệt chặn chúng và form không hydrate (đã tái hiện: E2E `ns-csp.spec.ts` đỏ). Sửa: `src/app/admin/login/page.tsx` và `src/app/admin/(protected)/layout.tsx` gọi `await connection()` trước mọi `<Suspense>` và đặt `export const instant = false` (Next.js đòi chính khoá này cho route không có vỏ tĩnh: lỗi build "blocking-prerender-dynamic", gợi ý "[block] Set `export const instant = false`"). Không đặt ở layout gốc `src/app/admin/layout.tsx`: `/admin` (chỉ `redirect`) sẽ thành động và trả 200 kèm thẻ meta thay cho 307 (D5); nó vẫn ○ và không có script nào. HTML của trang admin có mọi `<script>` mang nonce của response (15 / 15 trên `/admin/login`). Bảng route: chỉ `/admin/login`, `/admin/products` đổi (◐ → ƒ); `/admin/products/[slug]` vẫn ghi ◐ nhưng vỏ rỗng (`.meta`: `hasHtml: false`), toàn bộ HTML do lần resume theo request sinh ra, có nonce. Trang cửa hàng không đổi.
- **Hai header CSP:** dưới `next start` header CSP của proxy thay header của `headers()` cùng tên trên `/admin/*` (`server/lib/router-utils/resolve-routes.js`: cùng một object `resHeaders`, `res.setHeader` không phân biệt hoa thường, proxy ghi sau). Trên Vercel có thể có cả hai; trình duyệt áp cả hai, trang admin chạy được dưới giao đó (CSP nền cho `'self'` và `'unsafe-inline'`). Smoke chỉ đòi CSP nonce trên `/admin/login`.
- **Dev server:** CSP nền bỏ `upgrade-insecure-requests` khi `NODE_ENV=development` (dev chạy `http://localhost`, Safari nâng mọi request tài nguyên lên https và trang hỏng); CSP admin thêm `'unsafe-eval'` khi dev như CSP nền. Build (Preview, Production, `next start`) giữ đúng chuỗi ở trên.
- Proxy **đặt** (không nối) header CSP của request, nên header CSP do client gửi không chọn được nonce Next.js dùng.
