# ADR-0021: Thanh toán thử, đơn hàng và webhook ký chữ ký (M6)

- Trạng thái: Đã chấp nhận (PR #120, chủ dự án duyệt 2026-11-26)
- Ngày: 2026-11-26
- Quyết định của chủ dự án: 2026-11-26 (plan M6, Cổng 1, quyết định 1, 2, 3, 4, 5, 11, 13, 14, phương án A)
- Bổ sung: [ADR-0004](./0004-payment-vietnam.md) (interface `PaymentProvider`, bảng `orders`, webhook; M6 dựng `FakeProvider`), [ADR-0015](./0015-edge-rate-limit.md) (Hệ quả "Webhook thanh toán (M6)": trả lời bằng quyết định 11), [ADR-0020](./0020-content-security-policy-and-hsts.md) (Hệ quả M6: trả lời bằng quyết định 5)
- Liên quan: [ADR-0002](./0002-payment-provider.md), [ADR-0003](./0003-cache-strategy.md) (`revalidateTag`), [ADR-0010](./0010-app-role-and-preview-data.md) (role app), [ADR-0011](./0011-db-query-wrapper.md) (`dbQuery`), [ADR-0014](./0014-cart-storage-and-cookie.md) (giỏ, giá chụp), [ADR-0018](./0018-admin-auth.md) (phiên admin), [ADR-0019](./0019-product-edits-and-cache-tags.md) (`updated_at`, tag), `docs/plans/M6.md` Task 4 → 10, 16, ticket NS-6

## Bối cảnh

US-09: khách có giỏ hợp lệ bấm "Thanh toán", qua cổng thử nghiệm, đơn thành `paid`, tồn kho giảm đúng số lượng, giỏ trống, khách thấy mã đơn. Webhook gửi lặp chỉ trừ kho một lần. Hai người cùng mua món cuối thì đơn sau là `needs_refund`. `requirements.md` §5: webhook xác minh chữ ký, mỗi thanh toán chỉ xử lý một lần. §6, §7: chưa thu tiền thật, chưa có thông tin giao hàng, chưa có email.

Production là cửa hàng công khai thật. FakeProvider không thu tiền, nên nếu ai cũng thanh toán thử được thì mọi đơn là "mua miễn phí": bot làm cạn tồn kho thật và làm ngập bảng `orders`.

Điều đã đọc (plan M6, D1, D2, D7 → D10; Next.js 16.4.6):

- `revalidateTag(tag, profile)` gọi được trong Route Handler; `updateTag` chỉ trong Server Action. `'max'` là stale-while-revalidate.
- Quy tắc WAF `ns-95-cart-action-rate-limit` chỉ đếm `POST` **có** header `next-action` (ADR-0015, đọc lại 2026-11-25), nên webhook không bị đếm.
- CSP nền có `form-action 'self'`, `connect-src 'self'`, không có `frame-src` ngoài nguồn thanh công cụ của Preview (ADR-0020).
- Role app có `USAGE` / `SELECT` trên sequence (ADR-0010), nên `orders.id serial` chạy được với role app.
- `conventions.md` §2: Route Handler chỉ cho request từ bên ngoài (webhook). `src/admin-session-checks.test.ts` cấm `route.*` dưới `/admin`.
- Code hiện tại: `.env.example` đã có `PAYMENT_PROVIDER=fake`, `FAKE_PAYMENT_SECRET`; giỏ khoá hàng `carts` bằng `SELECT … FOR UPDATE` trước mọi ghi; `products.updated_at` phải được đặt rõ khi trừ kho (ADR-0019, ticket NS-6).

**Chưa kiểm** (có bước kiểm tại chỗ trong plan): C2 (`fetch` cùng origin tới webhook qua Vercel Authentication), C5 (`revalidateTag(…, 'max')` từ route handler), C6 (303 sau Server Action sang `/checkout/test`), C7 (PGlite và Postgres khoá hàng giống nhau), C9 (cookie admin đi theo `/cart`, `/checkout/test`). Kết quả khác dự kiến thì dừng và báo Orchestrator.

## Các phương án

**Cổng thanh toán ở M6 (quyết định 1)**

| Phương án | Ưu | Nhược |
|---|---|---|
| **A. Chỉ `FakeProvider`** | Đủ mọi tiêu chí US-09; chạy local, CI, preview không cần tài khoản; không thêm nguồn CSP | Chưa kiểm với cổng thật tới khi mở bán (ADR-0004 đã chấp nhận) |
| B. Fake + PayOS sandbox | Kiểm interface với cổng VN thật | Cần tài khoản, secret mới, bypass cho webhook vào Preview, thêm nguồn CSP |
| C. Fake + VNPay sandbox | Sandbox công khai | Như B |
| D. Stripe test mode | Tài liệu tốt | ADR-0004 đã bỏ |

**FakeProvider giao webhook thế nào (quyết định 2)**

| Phương án | Ưu | Nhược |
|---|---|---|
| **A. Server ký sự kiện (Server Action), trình duyệt chuyển tiếp bằng `fetch`** | Webhook đi qua đúng HTTP, đúng route handler, đúng xác minh chữ ký; không cần server gọi chính nó qua lớp bảo vệ Preview; E2E "gửi lặp" gửi lại đúng request đã bắt | Cổng thử nghiệm cần JavaScript; ai có `ref` thì lấy được sự kiện ký cho đơn đó |
| B. Server Action gọi thẳng hàm xử lý | Ít bước nhất | Route handler và chữ ký không chạy trong luồng thật |
| C. Server Action tự `fetch` tới URL của chính nó | Gần cổng thật nhất | Cần bypass secret trong env runtime; khó test local |

**Webhook `paid` mà một dòng không đủ kho (quyết định 3)**

| Phương án | Ưu | Nhược |
|---|---|---|
| **A. Cả đơn `needs_refund`, không trừ dòng nào, giỏ giữ nguyên** | Một trạng thái, dễ hiểu; không có kho bị trừ dở | Khách mất cả đơn dù chỉ thiếu một món |
| B. Trừ phần đủ, `needs_refund` một phần | Giao được phần còn | Cần hoàn từng phần, trạng thái mới |
| C. Như A nhưng xoá giỏ | Đúng câu "xoá giỏ" cũ của `design.md` | Khách mất giỏ mà không nhận hàng |

**Đơn 0 ₫ (quyết định 4)**

| Phương án | Ưu | Nhược |
|---|---|---|
| **A. Chặn ở checkout, `CHECK total > 0`** | Không gửi số tiền vô nghĩa tới cổng | Món 0 ₫ một mình không mua được |
| B. Tổng 0 → `paid` ngay | Mua được hàng tặng | Hai chỗ trừ kho |
| C. Form admin cấm giá dưới 1.000 ₫ | Chặn từ gốc | Đổi quy tắc US-13 đã nghiệm thu |

**CSP cho cổng thanh toán (quyết định 5)**

| Phương án | Ưu | Nhược |
|---|---|---|
| **A. Không đổi CSP ở M6**; ghi quy tắc cho adapter thật | FakeProvider chỉ dùng cùng origin; CSP giữ chặt | Adapter thật phải sửa CSP (đã ghi dưới đây) |
| B. Thêm trước origin PayOS / VNPay / MoMo | Adapter sau đỡ một bước | Nới CSP cho nguồn chưa dùng |
| C. `form-action 'self' https:` | Không phải sửa khi có cổng | Form gửi được tới mọi site https |

**Webhook và giới hạn tốc độ ở biên (quyết định 11)**

| Phương án | Ưu | Nhược |
|---|---|---|
| **A. Không thêm quy tắc WAF** | Không đụng quy tắc duy nhất của Hobby; cổng thật không bị chặn nhầm | Một đợt POST rác vẫn tốn invocation |
| B. Sửa quy tắc WAF để đếm cả webhook | Chặn đợt rác ở biên | Cổng thật gửi lại dồn dập có thể bị 429; thao tác console |

**Nghiệm thu US-09 trên Production (quyết định 13)**

| Phương án | Ưu | Nhược |
|---|---|---|
| **A. Production E2E chỉ đọc; chủ dự án đặt một đơn thử bằng tay** | Không ghi tự động lên DB Production | Một thao tác tay |
| B. Production E2E đặt đơn thử tự động | Kiểm mỗi release | Ghi đơn, trừ kho Production mỗi lần; cần mật khẩu admin Production trên GitHub |

**Ai được thanh toán thử trên Production (quyết định 14)**

| Phương án | Ưu | Nhược |
|---|---|---|
| **A. Chỉ phiên admin** khi `TEST_PAYMENTS_ACCESS` không phải `public` | Khách và bot không tạo được đơn hay trừ kho; Production vẫn chạy đủ luồng thật để nghiệm thu; fail-closed; không bảng mới | Bốn lối vào phải cùng kiểm; thêm chiều `checkout → admin` |
| B. Cờ `CHECKOUT_ENABLED` tắt trên Production | Đơn giản nhất | Production không bao giờ chạy luồng thanh toán trước khi mở bán |
| C. Giới hạn số đơn theo IP / ngày | Khách vẫn thử được | Kho vẫn bị trừ tới trần; IPv6 lách được (bài học NS-132); thêm migration |
| D. Chấp nhận rủi ro, admin trả kho bằng tay | Không code | Một bot đủ làm cả cửa hàng "Hết hàng" |

## Quyết định

Câu trả lời của chủ dự án ở Cổng 1 (plan M6, mục "Cần chủ dự án quyết"), chép nguyên văn:

> **Đã quyết (2026-11-26, Cổng 1):** chủ dự án duyệt tất cả đề xuất: 1A → 14A.

Phương án được chọn, chép nguyên văn từ plan:

- **Quyết định 1** (Cổng thanh toán ở M6: `FakeProvider` có đủ không): **A. Chỉ `FakeProvider`** (ADR-0004, `design.md` §2): cổng thử nghiệm trong site, webhook ký HMAC như cổng thật
- **Quyết định 2** (FakeProvider giao webhook thế nào): **A. Server ký sự kiện (Server Action), trình duyệt chuyển tiếp bằng `fetch` tới `/api/webhooks/payment`**
- **Quyết định 3** (Webhook `paid` mà một dòng không đủ kho): **A. Cả đơn `needs_refund`, không trừ dòng nào, giỏ giữ nguyên** (khách thấy cảnh báo hết hàng trong giỏ)
- **Quyết định 4** (Đơn 0 ₫): **A. Chặn ở checkout: tổng 0 → "Đơn 0 ₫ chưa thanh toán được."**; DB `CHECK total > 0`
- **Quyết định 5** (CSP cho cổng thanh toán): **A. Không đổi CSP ở M6**; ADR-0021 ghi quy tắc cho adapter thật (thêm origin vào `form-action` / `frame-src` / `connect-src` cùng PR, kiểm `redirect()` ra origin ngoài); E2E CSP trên trang mới
- **Quyết định 11** (Webhook và giới hạn tốc độ ở biên): **A. Không thêm quy tắc WAF**: chữ ký được kiểm trước mọi đọc DB, thân ≤ 8 KB; POST rác chỉ tốn một HMAC
- **Quyết định 13** (Nghiệm thu US-09 trên Production): **A. Production E2E chỉ đọc; chủ dự án (đã đăng nhập admin, quyết định 14A) đặt một đơn thử bằng tay sau `v0.6.1`** ("Việc" 7) rồi trả tồn kho
- **Quyết định 14** (Ai được thanh toán thử trên Production): **A. Chỉ phiên admin** khi `TEST_PAYMENTS_ACCESS` không phải `public` (mặc định, Production không đặt biến): ô thanh toán của `/cart`, `startCheckoutAction`, `/checkout/test`, `fakeGatewayAction` đều kiểm `hasAdminSession()` trước khi chạm DB hay ký; khách thấy "Thanh toán chưa mở."; Preview / Dev đặt `public`

Áp như sau.

- **Chỉ `FakeProvider`** (`src/features/checkout/providers/fake.ts`) cài `PaymentProvider` của ADR-0004. `PAYMENT_PROVIDER` trống thì là `fake`; giá trị khác `fake` thì thanh toán đóng (`unsupported`). Không thêm thư viện.
- **Cách FakeProvider giao webhook (2A).** `/checkout/test?ref=<paymentRef>` có nhãn "Môi trường thử nghiệm — không thu tiền". Nút bấm gọi `fakeGatewayAction` (Server Action) để ký sự kiện bằng `FAKE_PAYMENT_SECRET`; trình duyệt `fetch` POST thân và chữ ký tới `/api/webhooks/payment`, rồi chuyển sang `/checkout/success?ref=…` (hoặc `/cart` khi huỷ). Webhook không tin gì ngoài chữ ký.
- **Route handler duy nhất:** `POST /api/webhooks/payment` (`src/app/api/webhooks/payment/route.ts`, mỏng, gọi `handlePaymentWebhook` của `checkout`, không export `GET`). Ngoài nó chỉ còn route metadata có sẵn (`sitemap.xml`, `robots.txt`, `opengraph-image` của `/`, `/products/[slug]`, `/blog/[slug]`). Không route handler nào dưới `/admin`. Kiểm bằng allowlist: Vitest `src/route-handlers.test.ts` và `scripts/check-route-handlers.mjs` đọc `.next/server/app-paths-manifest.json` sau `next build`. Thêm route handler thứ hai cần ADR mới.
- **Chữ ký:** HMAC-SHA256 (Web Crypto, `crypto.subtle.verify`), header `x-fake-signature: t=<giây Unix>,v1=<base64url>` ký trên `"<t>.<thân>"`, hạn 300 giây. `crypto.subtle.verify` chạy trên **đúng byte thân nhận được** (không parse lại rồi ký lại), và chỉ khi header khớp `^t=\d{10},v1=[A-Za-z0-9_-]{43}$` (không khớp thì `bad-signature`, không gọi verify). Thứ tự: thân tối đa 8 KB (quá thì 413, không parse) → chữ ký (thiếu hay sai thì 400) → Zod → DB. Không đọc DB trước khi chữ ký đúng.
- **Cấu hình fail-closed:** `FAKE_PAYMENT_SECRET` thiếu, dưới 32 ký tự hoặc bằng `SESSION_SECRET` thì nút thanh toán trả "Thanh toán chưa được cấu hình.", webhook 503, cổng thử nghiệm không ký. `FAKE_PAYMENT_SECRET` phải **khác nhau giữa Production và Preview** (và khác `SESSION_SECRET`): nếu dùng chung, sự kiện ký trên Preview (chế độ `public`) hợp lệ cả trên Production trong 300 giây. Chủ dự án tạo hai giá trị riêng, Orchestrator đọc lại (plan M6, "Việc của chủ dự án" 1).
- **Bảng `orders`** (cột ở plan M6 Task 4): `id serial` (mã đơn gửi cổng), `items jsonb` (giá chụp lúc tạo đơn, ADR-0014), `total`, `status` (`pending` | `paid` | `needs_refund` | `cancelled`), `refund_reason` (`out-of-stock` | `amount-mismatch`, có khi và chỉ khi `needs_refund`), `provider`, `payment_ref` unique (nullable: đơn tạo trước, ref gắn sau), `cart_id` (FK `carts`, `ON DELETE SET NULL`), `created_at`, `updated_at`. `CHECK total > 0`. Không `$onUpdate`: mọi ghi đặt `updated_at` rõ.
- **Thuật toán áp sự kiện (`applyPaymentEvent`)**, một transaction:
  1. Khoá hàng `orders` theo `payment_ref` (`FOR UPDATE`). Không có, hoặc `id` khác `orderCode`, hoặc `provider` khác thì `ignored`.
  2. Đơn không còn `pending` thì `duplicate`, không ghi gì. Idempotent đến từ khoá hàng `orders` và kiểm `status` trong cùng transaction; `payment_ref` unique chỉ giữ một hàng cho một ref.
  3. Sự kiện `cancelled`: đơn `cancelled`, giỏ giữ nguyên.
  4. `paid` mà `amount` khác `total`: `needs_refund` / `amount-mismatch`, kho không đổi.
  5. `paid`: khoá các hàng `products` theo `id`, trừ **cả đơn** bằng câu có điều kiện `stock >= quantity` và đặt `updated_at = now()`. Đủ kho: đơn `paid`, xoá `cart_items` của `cart_id` trong đơn (không lấy từ sự kiện). Thiếu một dòng: **không dòng nào bị trừ**, đơn `needs_refund` / `out-of-stock`, giỏ giữ nguyên (3A).
- **Mã trả lời của webhook:** 200 `{ received: true, outcome }` (kể cả `duplicate`, `ignored`, `cancelled`); 400 chữ ký thiếu, sai, hết hạn hoặc thân sai dạng; 413 thân quá 8 KB; 405 không phải POST; 503 chưa cấu hình hoặc lỗi DB (cổng gửi lại, an toàn vì idempotent). Ghi bị `DB_QUERY_TIMEOUT` nghĩa là không biết đã ghi hay chưa (ADR-0011): không tự thử lại.
- **Sau commit:** `revalidateTag(tag, 'max')` cho `tagsForProductWrite({ slug, change: 'fields' })` của từng sản phẩm thật sự bị trừ (`product:<slug>`, `products`). Một lần gửi lại (`duplicate`) của đơn đang `paid` cũng trả `slugs` của đơn và làm mới lại các tag đó: việc này idempotent và rẻ, và bù cho ca function chết hoặc `DB_QUERY_TIMEOUT` giữa commit và `revalidateTag` (webhook trả 503, lần gửi lại mới là `duplicate`), để tồn kho cũ không ở lại tới hết `cacheLife`. Duplicate của đơn không `paid` thì không làm mới. Không bao giờ `product-slugs`, không `revalidatePath`, không `updateTag`.
- **Đơn 0 ₫ (4A):** `createPendingOrder` trả `zero-total`, giỏ hiện "Đơn 0 ₫ chưa thanh toán được."; một dòng 0 ₫ trong đơn có món khác thì vẫn mua được.
- **Cửa thanh toán thử (14A).** Biến `TEST_PAYMENTS_ACCESS` (`public` | `admin`), trim; đúng `public` mới mở cho mọi người, trống, thiếu hay giá trị lạ thì `admin` (fail-closed). Production không đặt biến (= `admin`); Preview, Dev và local đặt `public`. Ở chế độ `admin`, `checkoutAccess()` đòi `hasAdminSession()` ở **bốn lối vào**, trước khi đọc giỏ, đọc đơn, chạm DB hay ký: ô thanh toán của `/cart` ("Thanh toán chưa mở.", không nút), `startCheckoutAction` (`not-open`, không ghi đơn), `/checkout/test` ("Thanh toán chưa mở.", không đọc đơn), `fakeGatewayAction` (`not-open`, không ký). Webhook không đổi: nó chỉ nhận sự kiện có chữ ký, mà chỉ server ký.
  - **Số tiền ký lấy từ DB:** `fakeGatewayAction` dựng sự kiện với `amount = orders.total` đọc từ DB, không nhận số tiền hay sự kiện từ input; khách không ký được số tiền tuỳ ý.
  - **Ở chế độ `public`, gắn đơn với giỏ (siết thêm, Orchestrator quyết 2026-11-26 theo quy tắc 6 của retro M5, audit PR #120 L3):** `fakeGatewayAction` và `/checkout/test` chỉ phục vụ khi cookie giỏ của request khớp `orders.cart_id` (`canActOnOrder`); không khớp thì `not-found`, cùng đáp án với `ref` lạ. Nhờ vậy một `ref` bị lộ (lịch sử trình duyệt, ảnh chụp màn hình) không đủ để người khác lấy chữ ký hay huỷ đơn. Chế độ `admin`: phiên admin là đủ. E2E phát lại không bị ảnh hưởng (gửi lại request đã bắt, không qua action).
  - **`/checkout/success` cố ý không kiểm phiên và không thuộc bốn lối vào:** nó chỉ đọc đơn theo `ref` ngẫu nhiên, không ghi, không hiện dữ liệu cá nhân (không có thông tin khách). Webhook không kiểm phiên vì chỉ server ký được sự kiện. Audit toàn mốc không coi hai chỗ này là lối vào bị sót.
  - **Vì sao theo biến môi trường, không theo `VERCEL_ENV`:** code không kiểm tên môi trường (`design.md` §7); biến chạy giống nhau ở local, CI và Vercel nên E2E kiểm được cả hai chế độ trên build thật (server `ADMIN_GATED_URL`); quên đặt biến thì đóng, không mở.
  - **Khi mở bán với cổng thật:** bỏ `TEST_PAYMENTS_ACCESS` khỏi Production cùng FakeProvider (thanh toán có tiền thật thì không còn "mua miễn phí").
- **CSP không đổi ở M6 (5A):** `form-action 'self'`, `connect-src 'self'` giữ nguyên, không thêm `frame-src`. Điều kiện cho adapter thật, làm **cùng PR với adapter**: thêm origin cổng vào `form-action` nếu cổng nhận form POST, vào `frame-src` nếu nhúng, vào `connect-src` nếu client gọi API cổng; kiểm lại `redirect()` sang origin ngoài từ Server Action (C6 của M6 chỉ kiểm cùng origin, ADR-0020 đã cảnh báo `form-action` có thể chặn 303 sang domain ngoài); kiểm số tiền tối thiểu của cổng (chưa kiểm); mã trả lời webhook theo yêu cầu của cổng.
- **Webhook không vào quy tắc WAF (11A):** quy tắc chỉ đếm `POST` có `next-action` (D9), webhook không có header đó nên không bị đếm. Chữ ký kiểm trước mọi đọc DB và thân tối đa 8 KB, nên POST rác chỉ tốn một HMAC. Không đụng quy tắc duy nhất của Hobby; cổng thật gửi lại dồn dập không bị 429. Rủi ro còn lại (chấp nhận): một đợt POST rác vẫn tốn invocation (hạn mức Hobby 1.000.000 / tháng).
- **Nghiệm thu Production bằng tay (13A):** Production E2E chỉ đọc. Sau `v0.6.1` chủ dự án đăng nhập admin, đặt một đơn thử, thấy trang xác nhận và `/admin/orders`, rồi trả tồn kho bằng form sửa (plan M6, "Việc của chủ dự án" 7).
- **Hết hàng khi thanh toán, giỏ giữ nguyên:** khách thấy cảnh báo hết hàng trong giỏ như thường lệ (ADR-0014).

## Hệ quả

- **`needs_refund` không bao giờ "xong" trong app** (xem ADR-0023: admin chỉ xem). Đơn thử không có tiền để hoàn.
- **Mỗi lần bấm "Thanh toán" tạo một đơn `pending` mới;** đơn bỏ dở ở lại bảng (plan M6, "Cố ý không làm" 4). Không giữ chỗ tồn kho (ADR-0014).
- **Ai có `ref` thì lấy được sự kiện ký cho đơn đó** ở chế độ `public` (đổi lại: webhook đi đúng đường thật). `ref` là `fake_<UUID>` ngẫu nhiên, chỉ khách đó biết. Chấp nhận ở chế độ thử; ở Production chế độ `admin` thì không ai ngoài admin ký được.
- **Cổng thử nghiệm cần JavaScript.** Nút "Thanh toán" của giỏ chạy không cần JavaScript (C6).
- **`checkout → admin` và `checkout → products` là chiều phụ thuộc mới** (không vòng: `admin` không import miền nào; `products → admin` đã có; `checkout → products` vì `webhook.ts` gọi `tagsForProductWrite`). `orders → admin` (kiểm phiên ở `admin-queries.ts`) cũng thêm vào `architecture.md` §2. `checkout/actions.ts` là action **shop** dù gọi `hasAdminSession` qua `checkoutAccess`; ngoại lệ trong `admin-session-checks.test.ts` (nếu cần) gắn đúng tên `checkoutAccess`, Auditor duyệt.
- **Role DB:** runtime chỉ DML. Ngoại lệ có chủ ý: `orders.id serial` (role app có quyền sequence, ADR-0010). `error_events` không có sequence (ADR-0022).
- **Migration** chỉ `CREATE TABLE` / `CREATE INDEX` trên bảng mới (expand); FK tới `carts` lấy khoá ngắn, chịu `lock_timeout = '5s'`. Auditor bắt buộc.
- **PGlite tuần tự hoá transaction** (C7): test đồng thời trên PGlite chỉ chứng minh logic, không chứng minh khoá. Khoá hàng được kiểm bằng đọc code và Auditor.
- **Adapter cổng thật** (ngoài M6) phải theo các điều kiện CSP ở trên và thêm test âm tính trên build thật.
- **Cách kiểm:**
  - Vitest `store.test.ts` (orders): `US-09: the same paid event twice decrements stock once`, `US-09: two concurrent deliveries of one event decrement stock once`, `needs_refund decrements nothing for any line when one line is short`, `an amount that differs from the total marks needs_refund (amount-mismatch) without touching stock`, `an event whose ref and order code do not match is ignored`, `refuses a zero total`.
  - Vitest `webhook.test.ts`: `does not touch the database before the signature is verified`, `never revalidates product-slugs`, `revalidates again for a duplicate of a paid order`, `answers 200 without revalidating for an ignored event, a cancelled event or a duplicate of an order that is not paid`; `route-handlers.test.ts`: `the payment webhook is the only route handler`; `access.test.ts`, `config.test.ts`, `signature.test.ts`, `actions.test.ts` (`startCheckoutAction returns not-open without an admin session before reading the cart`, `fakeGatewayAction returns not-open without an admin session before reading the order or signing`).
  - E2E `ns-webhook.spec.ts`: `webhook: không có chữ ký thì 400, đơn không đổi`, `webhook: chữ ký sai thì 400, đơn không đổi`, `webhook: thân trên 8 KB thì 413`, `webhook: sự kiện ký quá 5 phút thì 400`, `webhook: GET thì 405`.
  - E2E `ns-closed-config.spec.ts`: `closed: thiếu FAKE_PAYMENT_SECRET thì webhook trả 503`, `closed: thiếu FAKE_PAYMENT_SECRET thì giỏ báo "Thanh toán chưa được cấu hình."`.
  - E2E `ns-checkout-gate.spec.ts` (server `ADMIN_GATED_URL`): `gated: khách không có phiên admin thấy "Thanh toán chưa mở." ở giỏ và cổng thử nghiệm, không tạo đơn`, `gated: gọi thẳng startCheckoutAction và fakeGatewayAction không phiên admin thì trả not-open, không ghi, không ký`, `gated: có phiên admin thì thanh toán thử được tới trang xác nhận`. Chế độ `public` (server chính): `public: ref của giỏ khác không lấy được chữ ký và cổng thử nghiệm báo "Không tìm thấy đơn hàng."`; Vitest `fakeGatewayAction returns not-found in public mode when the cart cookie does not match the order's cart, and signs nothing`, `fakeGatewayAction signs the total read from the database, whatever the input`, `order-access.test.ts`.
  - E2E Task 16 (`US-09`): `webhook gửi lặp lại cùng một thanh toán thì tồn kho chỉ giảm một lần`, `hai người cùng mua món cuối thì đơn sau chuyển needs_refund`, `sau khi thanh toán, trang sản phẩm khác vẫn được phục vụ từ cache`, `form admin mở trước khi có đơn thì lưu bị báo xung đột`, `trên Production khách thấy "Thanh toán chưa mở."`.
  - E2E `ns-csp.spec.ts`: `NS-csp: cổng thử nghiệm và trang xác nhận không vi phạm CSP`.
  - `npm run check:bundle` (`scripts/check-route-handlers.mjs`) sau `next build`: danh sách route handler đúng allowlist, có webhook.
  - `scripts/smoke.sh`: `webhook-unsigned` (POST không chữ ký → 400, mọi môi trường kể cả Production), `checkout-gated` (khi `robots.txt` là `Allow: /`).
  - Audit toàn mốc (plan M6 Task 15) đọc lại thuật toán áp sự kiện và bốn lối vào của cửa thanh toán thử.

## Bổ sung (NS-141, audit PR #125 L1 / PR #126 N4): `updated_at` của câu trừ kho

Bước 5 ở trên đặt `updated_at = NEXT_UPDATED_AT` (`greatest(clock_timestamp(), updated_at + interval '1 microsecond')`), không phải `now()`; xem bổ sung cùng ngày của [ADR-0019](./0019-product-edits-and-cache-tags.md). Thêm: `createPendingOrder` trả `too-large` khi tổng vượt int4 (2147483647) và ném khi `items` không qua `orderItemsSchema`, cả hai trước `INSERT` (audit PR #126 L2, L3).
