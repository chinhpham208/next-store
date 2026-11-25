# ADR-0017: Proxy trả 404 cho slug sản phẩm bằng registry tĩnh trong repo

- Trạng thái: Đã chấp nhận (chủ dự án duyệt 2026-11-25, PR #99)
- Ngày: 2026-11-25
- Quyết định của chủ dự án: 2026-11-25 (plan M5, Cổng 1, quyết định 1, 2, phương án A)
- Thay thế một phần: [ADR-0009](./0009-product-404-in-proxy.md) (gạch đầu dòng "Slug đúng dạng → `isKnownProductSlug`", "Slug đã thấy tồn tại được nhớ trong một `Set`", "Fail-open", và các mục Hệ quả "Fail-open để lọt slug lạ vào route cache", "Kết nối lạnh làm mất 404", "Tạm thời ở v0.3.1", "Sửa thật: M5", "Tập slug đã biết bị cũ sau khi xoá", "Kết nối DB riêng của proxy trên Vercel")
- Liên quan: [ADR-0003](./0003-cache-strategy.md) (bổ sung NS-109, `getCatalogSlugs`), [ADR-0012](./0012-blog-static-registry.md) (blog đã dùng registry tĩnh), [ADR-0015](./0015-edge-rate-limit.md) (slug lạ chưa có giới hạn tốc độ), [ADR-0019](./0019-product-edits-and-cache-tags.md) (tag `product-slugs`), `docs/plans/M5.md` Task 3, ticket NS-79, NS-56, NS-109, NS-110

## Bối cảnh

ADR-0009 cho `src/proxy.ts` tra slug sản phẩm trong DB trước khi render, để `/products/<slug lạ>` trả 404 thật ngay lần đầu (US-05). Lookup quá 400 ms hoặc lỗi thì fail-open (cho đi tiếp).

Đo trên Vercel (ADR-0009, mục Hệ quả, sửa 2026-11-23, NS-79): proxy là Routing Middleware, chạy ở edge gần người truy cập chứ không ở `sin1`. Request từ runner GitHub ở Mỹ đi qua proxy tại `iad1`, `sfo1`, `pdx1`, `cle1`. Mỗi lookup từ đó là một vòng Mỹ – Singapore tới Neon (`aws-ap-southeast-1`), cộng kết nối lạnh, nên vượt 400 ms và fail-open: slug lạ trả 200. Smoke Production phải chạy với `SMOKE_PRODUCT_FAIL_OPEN=warn` từ v0.3.1.

Fail-open kéo theo hai lỗi chỉ lộ trên Production:

- NS-109: ảnh Open Graph của slug lạ trả 500 khi fail-open (v0.4.0).
- NS-110: `POST` không `next-action` và `PUT` tới slug lạ nhận 405 từ Vercel.

Tài liệu Vercel ghi Routing Middleware "runs globally before the cache" và khuyên dùng kho dữ liệu phân tán toàn cầu khi cần dữ liệu. Next.js 16.4.6 bỏ `config.regions` của proxy lúc build (ADR-0009), nên không ép được proxy chạy ở `sin1`.

Điều kiện của M5:

- Admin chỉ **sửa** tên, giá, mô tả, tồn kho; không tạo, xoá, ẩn hay đổi slug (quyết định 3A). Tập slug không đổi lúc chạy.
- Ảnh sản phẩm nằm trong repo (`requirements.md` §6). Thêm một sản phẩm đằng nào cũng cần một PR và một lần deploy.

Số liệu Vercel Hobby (đọc 2026-11-25, plan M5 D12, D13):

- [Global Config limits](https://vercel.com/docs/global-config/global-config-limits) (Edge Config đổi tên thành Global Config, [changelog 29/07/2026](https://vercel.com/changelog/edge-config-is-now-global-config)): 1 store, 1 MB; 100.000 lượt đọc / tháng; ghi: trang Limits ghi "First 100", changelog ghi "Hobby writes stayed at 250/month" (hai nguồn lệch, lấy số nhỏ là 100); ghi lan toàn cầu tới 10 s; mỗi lần đọc qua SDK hay REST API đều tính.
- [Vercel Hobby Plan](https://vercel.com/docs/plans/hobby): mỗi tháng 1.000.000 CDN request, 1.000.000 Function invocation, 10 GB Fast Origin Transfer, 4 CPU-giờ; vượt hạn mức thì thường phải chờ 30 ngày mới dùng lại tính năng đó.

## Các phương án

| Phương án | Ưu | Nhược | Chi phí Hobby |
|---|---|---|---|
| **A. Registry slug tĩnh trong repo** (`catalog-slugs.ts`, như blog ở ADR-0012); proxy không chạm DB | 404 thật ở mọi region, cả khi DB chết; proxy hết truy vấn, hết `Set` slug cũ, hết kết nối DB riêng; bỏ được cờ `warn` của smoke Production; NS-56 thừa | Thêm / bỏ sản phẩm phải sửa file và deploy (đằng nào cũng cần vì ảnh nằm trong repo); DB production phải khớp registry (kiểm bằng E2E chỉ đọc) | 0 |
| B. Danh sách slug trong Global Config (Edge Config), proxy đọc bằng SDK | Đọc khoảng 1 ms ở mọi region; đổi danh sách không cần deploy | Thêm thư viện `@vercel/global-config` (cần duyệt); 100.000 lượt đọc / tháng, mỗi request sản phẩm qua proxy là một lượt nếu không nhớ trong instance, vượt thì dừng tới 30 ngày và lại fail-open; 100 lượt ghi / tháng; ghi cần token API Vercel trong env runtime (quyền rộng); 1 store dùng chung cho Production và Preview; ghi lan tới 10 s | Miễn phí trong hạn mức, có rủi ro vượt |
| C. Route handler ở `sin1` trả danh sách slug, CDN cache theo tag, proxy `fetch` từ chính site (hướng ghi ở ADR-0009 "Sửa thật: M5") | Không thư viện; đổi danh sách bằng `updateTag` | Lần đầu mỗi region sau mỗi lần xoá cache vẫn đi Mỹ → Singapore, có thể quá 400 ms nên vẫn fail-open; Preview / Dev được bảo vệ bằng Vercel Authentication nên proxy cần bypass secret trong runtime; thêm một route công khai | CDN request + function invocation, nhỏ |
| D. Bỏ kiểm slug khỏi proxy, để trang gọi `notFound()` | Đơn giản nhất | 404 "mềm": lần đầu trả 200 (ADR-0009 K3), trái US-05 | 0 |

NS-56 (ngắt mạch khi lookup của proxy timeout liên tục):

| Phương án | Ưu | Nhược |
|---|---|---|
| **A. Đóng "Won't fix" khi Task 3 merge** (với 1A proxy không còn gọi gì có thể timeout) | Bớt một ticket, bớt code | Nếu sau này chọn lại 1B / 1C thì mở lại |
| B. Gộp vào Task 3 (chỉ có nghĩa với 1B / 1C) | Proxy không chờ khi nguồn chậm | Thêm trạng thái theo instance, khó test |
| C. Giữ Open "khi rảnh" | — | Ticket treo không còn đối tượng |

## Quyết định

Câu trả lời của chủ dự án ở Cổng 1 (plan M5, mục "Cần chủ dự án quyết"), chép nguyên văn:

> **Đã quyết (2026-11-25):** chủ dự án duyệt tất cả đề xuất: 1A, 2A, 3A, 4A, 5A, 6A, 7A, 8A, 9A, 10A, 11A, 12A, 13A, 14A, 15A, 16A, 17A.

Quyết định 1A và 2A áp như sau.

- **Registry** `src/features/products/catalog-slugs.ts`, **không import gì** (để proxy và Vitest dùng được, như `posts.ts` của blog): `PRODUCT_SLUGS` là mảng `as const` gồm 24 slug của seed, theo thứ tự `PRODUCT_SEEDS`; `isCatalogSlug(slug)` tra một `Set` dựng một lần lúc nạp module.
- **Proxy** (`answerProduct`, đồng bộ): slug không qua `isProductSlug` → 404; `isCatalogSlug(slug)` → `NextResponse.next()`; còn lại → rewrite sang `/_khong-tim-thay` (404). Cách lấy slug từ đường dẫn (mẫu neo hai đầu, hậu tố `.rsc` và segment) và lối tắt Server Action của ADR-0009 không đổi.
- **Proxy không import `@/db`**, cũng không `postgres`, `@electric-sql/pglite`, `drizzle-orm`, kể cả bắc cầu. dependency-cruiser thêm luật `proxy-no-db`. `proxy-api.ts` của products export `isProductSlug`, `isCatalogSlug`, bỏ `isKnownProductSlug`.
- **Bỏ:** `slug-guard.ts` và test của nó, `lookupWithin`, `LOOKUP_TIMEOUT_MS` (400 ms), hai dòng log `proxy: product slug lookup …`, `Set` slug dương và `Map` promise đang chờ.
- **Đường render không đổi ở Task 3:** `getProductBySlug` vẫn đối chiếu `getCatalogSlugs()` đọc từ DB (bổ sung NS-109 của ADR-0003). Tag của nó đổi ở [ADR-0019](./0019-product-edits-and-cache-tags.md).
- **NS-56 đóng "Won't fix — proxy không còn gọi DB, ADR-0017"** khi Task 3 merge, kèm link PR.
- **Loại B:** thêm thư viện và secret có quyền rộng trong runtime; hạn mức đọc 100.000 / tháng là trần cứng mà vượt thì quay lại fail-open tới 30 ngày; 1 store chung Production và Preview.
- **Loại C:** không sửa hết lỗi (lần đầu mỗi region vẫn đi Mỹ → Singapore), cần bypass secret trong runtime trên Preview / Dev, thêm route công khai.
- **Loại D:** trái tiêu chí US-05 (404 thật ngay lần đầu).

## Hệ quả

- **(a) Thêm hoặc bỏ sản phẩm phải sửa `catalog-slugs.ts` và deploy.** Việc này vốn đã cần deploy vì ảnh sản phẩm nằm trong repo (`requirements.md` §6). Seed (`PRODUCT_SEEDS`) và registry đổi trong cùng một PR; Vitest `PRODUCT_SLUGS equals the seed slugs` chặn lệch giữa hai file. README (mục Seed production) ghi quy trình: thêm sản phẩm = sửa seed + registry, deploy, rồi chạy SQL seed trên Production.
- **(b) DB production phải khớp registry.** Sản phẩm có trong DB mà không có trong registry → 404 cho sản phẩm thật; có trong registry mà không có trong DB → proxy cho đi tiếp, trang gọi `notFound()` (404 "mềm"). Kiểm bằng E2E chỉ đọc `catalog: sitemap và registry slug khớp nhau` (tập slug sản phẩm trong `/sitemap.xml` của môi trường bằng `PRODUCT_SLUGS`), chạy cả trong `Production E2E` sau mỗi release. Ai thêm sản phẩm bằng SQL Editor mà không qua PR thì E2E này đỏ.
- **(c) NS-56 thừa:** proxy không còn gọi gì có thể timeout. Nếu sau này quay lại hướng B hoặc C thì mở lại.
- **(d) Hết hiệu lực trong ADR-0009:** `slug-guard.ts`, `Set` slug dương và `Map` promise, ngưỡng 400 ms và nhánh fail-open của proxy cho sản phẩm, các mục Hệ quả "Fail-open để lọt slug lạ vào route cache", "Kết nối lạnh làm mất 404 ở những request đầu", "Tạm thời ở v0.3.1", "Sửa thật: M5", "Tập slug đã biết bị cũ sau khi xoá" (không còn `forgetProductSlug`), "Kết nối DB riêng của proxy trên Vercel". Phần còn hiệu lực của ADR-0009: lý do dùng proxy (K3–K6), cách lấy slug từ đường dẫn, rewrite sang `/_khong-tim-thay`, lối tắt Server Action (NS-103), lối vào hẹp `proxy-api`.
- **(e) Cờ `SMOKE_PRODUCT_FAIL_OPEN` bỏ.** Smoke ở mọi môi trường, kể cả Production, đòi 404 ngay lần đầu cho slug sản phẩm lạ (warm-up, slug mới, RSC, `.rsc`, segment, ảnh OG). `e2e/product-fail-open.ts` bỏ nếu không còn ai dùng. `scripts/smoke-fail-open.sh` đổi mục đích: DB chậm (`e2e/far-db.mjs`) mà slug lạ vẫn 404 ngay, dưới 200 ms. `release-gate.yml` và `production-e2e.yml` không đặt cờ nữa.
- **(f) Khi có tạo sản phẩm lúc chạy** (sau M5: admin tạo, xoá, đổi slug mà không deploy), registry tĩnh không còn đủ: viết ADR mới, theo hướng C (route ở `sin1`, CDN cache theo tag `product-slugs`) và xét lại B. Ẩn sản phẩm theo [ADR-0019](./0019-product-edits-and-cache-tags.md) không đổi registry (slug ẩn vẫn mở trang chi tiết), nên không cần ADR mới cho việc đó.
- **Slug lạ không còn tốn truy vấn.** Rủi ro "slug lạ đúng dạng tốn một truy vấn mỗi request" của ADR-0009 và ADR-0015 hết; tìm kiếm `q` vẫn là rủi ro chấp nhận của ADR-0015.
- **Proxy đồng bộ và nhẹ hơn:** không DB, không timer, không `unref`; bundle proxy không kéo driver.
- **Cách kiểm:**
  - Vitest `catalog-slugs.test.ts`: `PRODUCT_SLUGS equals the seed slugs`, `every registry slug passes isProductSlug`, `has no duplicates`, `isCatalogSlug is false for a well-formed unknown slug`.
  - Vitest `proxy.test.ts`: `proxy answers an unknown product slug without the database` (mock `@/db` ném nếu bị gọi), `answers the same with the database down`.
  - `npm run check:deps`: `proxy-no-db` báo vi phạm trước khi sửa proxy, không vi phạm sau (C2, Task 3 Step 1).
  - E2E `catalog.spec.ts` (chỉ đọc) trên CI, preview, Dev, Production.
  - Sau `v0.5.0` (Task 3 Step 5): `Production E2E` xanh không có annotation fail-open; smoke Production in `x-vercel-id` ở region Mỹ và mọi slug sản phẩm lạ 404 ngay lần đầu. Số đo được ghi vào mục này sau release.
