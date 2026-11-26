# ADR-0019: Sửa sản phẩm, tag cache `product-slugs`, chính sách xoá = ẩn

- Trạng thái: Đã chấp nhận (chủ dự án duyệt 2026-11-25, PR #99)
- Ngày: 2026-11-25
- Quyết định của chủ dự án: 2026-11-25 (plan M5, Cổng 1, quyết định 3, 4, 11, 12, 13, phương án A)
- Bổ sung: [ADR-0003](./0003-cache-strategy.md) (danh sách slug `getCatalogSlugs` mang tag riêng `product-slugs` thay cho `products`; danh sách tag của mỗi lần ghi sản phẩm), [ADR-0014](./0014-cart-storage-and-cookie.md) (mục Hệ quả "Xoá cứng sản phẩm xoá nó khỏi mọi giỏ", NS-101: chọn **ẩn**; giá trong giỏ vẫn là giá hiện tại)
- Liên quan: [ADR-0008](./0008-listing-cache-keys.md) (khoá cache danh sách), [ADR-0011](./0011-db-query-wrapper.md) (ghi bị hết giờ là "không biết đã ghi hay chưa"), [ADR-0017](./0017-product-slug-registry-in-proxy.md) (registry slug trong proxy), [ADR-0018](./0018-admin-auth.md) (action admin kiểm phiên), `docs/plans/M5.md` Task 4, 5, 9, 15, ticket NS-101, NS-105, NS-109

## Bối cảnh

US-13: admin sửa tên, giá, mô tả, tồn kho của một sản phẩm; sau khi lưu, trang của **chính sản phẩm đó** hiện dữ liệu mới ở lần tải kế tiếp, **các trang sản phẩm khác không bị render lại**; giá âm hoặc tên trống bị từ chối với lỗi cạnh ô nhập.

ADR-0003 định: admin sửa sản phẩm → `updateTag('product:<slug>')` + `updateTag('products')`. Code hiện tại (plan M5, D4, D7, D8; `develop` tại `6c35eaa`):

- `getCatalogSlugs()` (`src/features/products/queries.ts`, NS-109) gắn `cacheTag('products')`. `getProductBySlug` gọi nó cho mọi trang chi tiết, metadata và ảnh OG (ADR-0003, bổ sung NS-109).
- Tag của hàm `'use cache'` lồng nhau đi lên entry bao ngoài (`01-directives/use-cache.md`); entry `APP_PAGE` mang tag trong header `x-next-cache-tags` (`02-guides/incremental-static-regeneration.md`, `self-hosting.md`, Next.js 16.4.6). Vậy entry của **mọi** `/products/<slug>` mang tag `products`, và `updateTag('products')` làm mọi trang sản phẩm render lại, trái US-13.
- `updateTag` chỉ gọi được trong Server Action (`04-functions/updateTag.md`).
- "Mới nhất" và sản phẩm nổi bật sắp theo `products.updated_at desc`; `updated_at` có `$onUpdate`. Admin sửa giá một sản phẩm sẽ đẩy nó lên đầu "Mới nhất" và đổi thứ tự trang chủ. `products` không có `created_at`.
- `cart_items.product_id` tham chiếu `products.id` với `ON DELETE CASCADE`. ADR-0014 (bổ sung NS-101) yêu cầu plan M5 chọn xoá cứng hay ẩn trước khi có action xoá.
- Giá trong giỏ là `products.price` hiện tại (ADR-0014, 4A). Từ M5 giá bắt đầu đổi được; ADR-0014 ghi 4C ("Giá đã đổi") là việc có thể làm ở M5.

## Các phương án

**Phạm vi admin ở M5 (quyết định 3)**

| Phương án | Ưu | Nhược |
|---|---|---|
| **A. Chỉ sửa tên, giá, mô tả, tồn kho** (US-13) và danh sách để chọn; không tạo / xoá / ẩn / đổi slug | Đúng tiêu chí đã duyệt; tập slug không đổi lúc chạy nên registry tĩnh của ADR-0017 đủ; mốc nhỏ | Muốn thêm sản phẩm phải qua PR (cần ảnh trong repo đằng nào cũng vậy) |
| B. A + "Ngừng bán" (ẩn, cột `archived_at`) | Gỡ sản phẩm khỏi cửa hàng không cần deploy | Thêm migration, trạng thái trên trang chi tiết / giỏ / danh sách / sitemap, tag `product-slugs`; ngoài tiêu chí |
| C. A + tạo + xoá | Admin đầy đủ | Cần upload ảnh (ngoài phạm vi §6) hoặc chọn ảnh có sẵn; registry tĩnh không còn đủ |

**Khi có tính năng xoá: xoá cứng hay ẩn? (quyết định 4, NS-101)**

| Phương án | Ưu | Nhược |
|---|---|---|
| **A. Ẩn** (`archived_at` nullable, expand): biến khỏi danh sách và sitemap; trang chi tiết vẫn mở (200, `noindex`, "Ngừng bán", nút thêm vào giỏ vô hiệu); dòng trong giỏ hiện "Ngừng bán" như dòng hết hàng; M6 chặn thanh toán dòng đó; FK `cart_items` sang `RESTRICT` ở một contract sau | Không mất dòng giỏ không báo; link cũ không thành 404 mềm; hợp với registry tĩnh (slug vẫn trong registry) | Sản phẩm không bao giờ thật sự biến mất khỏi DB |
| B. Xoá cứng, giữ cascade | Đơn giản | Dòng giỏ biến mất không báo (ADR-0014); slug còn trong registry → 404 mềm trên trang |
| C. Xoá cứng + bảng dấu vết để báo khách | Báo được | Thêm bảng, thêm giao diện, vẫn có 404 mềm |

**"Mới nhất" sau khi admin sửa được sản phẩm (quyết định 11)**

| Phương án | Ưu | Nhược |
|---|---|---|
| **A. Thêm `products.created_at` (expand + backfill), sắp "Mới nhất" và nổi bật theo nó** | Sửa giá không đẩy sản phẩm lên đầu danh sách / trang chủ | Một migration, một backfill |
| B. Giữ `updated_at`: "Mới nhất" nghĩa là "mới cập nhật" | Không đổi gì | Mỗi lần sửa tồn kho làm đảo thứ tự trang chủ; khó hiểu với khách |

**Báo "Giá đã đổi" trong giỏ (quyết định 12, ADR-0014 4C)**

| Phương án | Ưu | Nhược |
|---|---|---|
| **A. Không** (giữ ADR-0014 4A: giỏ luôn dùng giá hiện tại) | Không cột mới; tổng tiền khớp giá sẽ thanh toán | Khách không được báo khi giá đổi |
| B. Có: cột giá chụp nullable trong `cart_items`, dòng hiện "Giá đã đổi từ X thành Y" | Minh bạch | Thêm migration trên `cart_items`, giao diện, test; ngoài tiêu chí |

**Hai tab admin cùng sửa một sản phẩm (quyết định 13)**

| Phương án | Ưu | Nhược |
|---|---|---|
| **A. Kiểm `updated_at`:** form mang giá trị lúc mở; lưu khi DB đã đổi thì báo "Sản phẩm vừa được sửa ở nơi khác. Tải lại trang để xem bản mới nhất." | Không ghi đè im lặng; chỉ thêm một điều kiện `WHERE` | Một trạng thái lỗi nữa trên form |
| B. Ghi sau thắng | Đơn giản | Tab cũ ghi đè thay đổi mới mà không ai biết |

Về tag, không xét giữ `products` cho `getCatalogSlugs` rồi bỏ `updateTag('products')` khi sửa: danh sách, nổi bật, sitemap, đếm cũng hiện tên và giá, nên chúng phải được làm mới khi sửa trường.

## Quyết định

Câu trả lời của chủ dự án ở Cổng 1 (plan M5, mục "Cần chủ dự án quyết"), chép nguyên văn:

> **Đã quyết (2026-11-25):** chủ dự án duyệt tất cả đề xuất: 1A, 2A, 3A, 4A, 5A, 6A, 7A, 8A, 9A, 10A, 11A, 12A, 13A, 14A, 15A, 16A, 17A.

Quyết định 3A, 4A, 11A, 12A, 13A áp như sau.

**Tag cache (thực hiện quyết định 3A đúng tiêu chí US-13)**

- `src/features/products/cache-tags.ts` (không import gì) giữ mọi tag sản phẩm:
  - `PRODUCTS_TAG = 'products'`: danh sách, nổi bật, sitemap, danh mục, đếm.
  - `PRODUCT_SLUGS_TAG = 'product-slugs'`: **chỉ** `getCatalogSlugs`.
  - `productTag(slug)` → `product:<slug>`: chi tiết một sản phẩm.
- `getCatalogSlugs` gắn `cacheTag(PRODUCT_SLUGS_TAG)` thay cho `'products'`; mọi `cacheTag` khác dùng hằng, không đổi tag. Không thêm hàm `'use cache'` mới.
- `tagsForProductWrite(write)` là danh sách tag **duy nhất** cho mọi ghi sản phẩm:
  - `{ slug, change: 'fields' }` (sửa tên, giá, mô tả, tồn kho) → `product:<slug>`, `products`;
  - `{ slug, change: 'slug-set' }` (tạo, xoá, ẩn, đổi slug; chưa có ở M5) → thêm `product-slugs`.
- Sửa trường **không bao giờ** xoá `product-slugs`, nên trang chi tiết của sản phẩm khác giữ entry cache. Webhook trừ kho (M6) vẫn `revalidateTag('product:<slug>', 'max')` như ADR-0003.

**Sửa sản phẩm (3A, 13A)**

- Một Server Action `updateProductAction` trong `src/features/products/actions.ts` (ADR-0003: mọi ghi sản phẩm gom ở `features/products`). Thứ tự: kiểm phiên admin (ADR-0018) → parse Zod (`parseProductEdit`) → **một** câu `UPDATE products SET name, description, price, stock, updated_at = now() WHERE slug = $1 AND updated_at = $expected RETURNING updated_at` → `updateTag` cho từng tag của `tagsForProductWrite({ slug, change: 'fields' })`.
- `updated_at` được đặt **rõ** trong câu `UPDATE` (không dựa vào `$onUpdate` hay trigger, ADR-0014 bổ sung NS-101).
- 0 hàng cập nhật → một truy vấn kiểm slug có tồn tại: có → `conflict` ("Sản phẩm vừa được sửa ở nơi khác. Tải lại trang để xem bản mới nhất."), không → `not-found`. Không ghi đè im lặng (13A).
- Ghi bị lỗi hoặc `DB_QUERY_TIMEOUT` → **vẫn** `updateTag` như khi thành công (không biết đã ghi chưa, ADR-0011; xoá cache thừa vô hại) rồi trả `unavailable`. Không tự thử lại.
- Không đổi slug, ảnh, danh mục, `featured`. Giới hạn input: tên ≤ 120 ký tự, mô tả ≤ 2.000, giá là số nguyên đồng 0..100.000.000, tồn kho 0..10.000; tên và mô tả `trim()`. *Sửa theo audit PR #108 L-3:* chuẩn hoá NFC; U+2028 / U+2029 thành dấu cách trong tên, thành `\n` trong mô tả; ký tự điều hướng bidi (U+202A–U+202E, U+2066–U+2069, U+200E, U+200F, U+061C) là lỗi form `invalid` như ký tự điều khiển; cắt ở hai đầu khoảng trắng, `\p{Cf}`, ký tự lấp chỗ (U+115F, U+1160, U+3164, U+FFA0, U+2800) và dấu kết hợp đứng đầu; trường phải còn ít nhất một chữ, số, ký hiệu (emoji) hay dấu câu thấy được, không thì `empty`. Emoji ZWJ giữ nguyên. Ràng buộc `CHECK` của DB là lớp cuối cho giá âm.
- Dữ liệu admin (`listProductsForAdmin`, `getProductForAdmin`) đọc không cache, không bao giờ nằm trong `'use cache'`. Ngoại lệ duy nhất là `cache()` của React trong `admin-queries.ts` cho phần đọc bên trong `getProductForAdmin` (audit PR #108 nit): chỉ sống trong một request, để `generateMetadata` và page dùng chung một truy vấn; kiểm phiên vẫn chạy ở mỗi lần gọi, trước nó.

**Chính sách xoá = ẩn (4A).** Không có code xoá hay ẩn ở M5 (3A). Khi làm (ticket và plan sau):

- Thêm `products.archived_at timestamptz` nullable (expand). Không `DELETE FROM products` trong code.
- Sản phẩm ẩn: biến khỏi danh sách, nổi bật, đếm, sitemap; trang chi tiết **vẫn mở** (200, `noindex`, nhãn "Ngừng bán", nút thêm vào giỏ vô hiệu), slug vẫn trong registry của ADR-0017, nên link cũ không thành 404 mềm.
- Dòng giỏ của sản phẩm ẩn hiện "Ngừng bán" như dòng hết hàng; M6 chặn thanh toán dòng đó; thêm vào giỏ bị từ chối ở server.
- Ẩn / bỏ ẩn là một ghi `slug-set` (xoá cả `product-slugs`).
- FK `cart_items.product_id` đổi từ `CASCADE` sang `RESTRICT` ở một migration **contract** của release sau, để không ai xoá cứng nhầm.
- Lựa chọn này thay gạch đầu dòng "Ẩn sản phẩm" của ADR-0014 ở một điểm: trang chi tiết của sản phẩm ẩn trả **200 + `noindex`**, không 404, và proxy không lọc theo cột này (proxy không chạm DB, ADR-0017).
- Loại B: dòng giỏ biến mất không báo, slug còn trong registry thành 404 mềm. Loại C: thêm bảng và giao diện mà vẫn có 404 mềm.

**"Mới nhất" theo `created_at` (11A)**

- `products.created_at timestamptz NOT NULL DEFAULT now()`, không `$onUpdate` (expand, có default). Backfill riêng, chạy lại được: `UPDATE products SET created_at = updated_at WHERE created_at > updated_at` (trước M5 không có sửa nào nên `updated_at` là lúc tạo).
- `ORDER_BY.newest` và `getFeaturedProducts` sắp theo `created_at desc, id asc`. Sửa sản phẩm không đổi thứ tự "Mới nhất" hay trang chủ. Migration ở plan M5 Task 5.

**Giá trong giỏ (12A).** Giữ ADR-0014 4A: giỏ luôn dùng giá hiện tại, không cột giá chụp, không báo "Giá đã đổi". Sửa tồn kho không chạm `cart_items`; dòng vượt tồn kho mới hiện cảnh báo như M4.

## Hệ quả

- **US-13 kiểm được:** lưu một sản phẩm chỉ làm mới trang của nó và các trang danh sách; `/products/<slug khác>` vẫn phục vụ từ cache (`x-nextjs-cache: HIT` dưới `next start`, `x-vercel-cache: HIT` với `age` không về 0 trên Vercel). Sau Task 4, entry `APP_PAGE` của `/products/<slug>` phải mang `product:<slug>` và `product-slugs`, **không** mang `products`. Đây là giả định C1 của plan M5, kiểm tại chỗ ở Task 4 Step 1 trước khi viết code và ở Task 15 Step 1; kết quả ghi vào mục này. C1 sai → dừng, sửa plan.
  - **Kết quả Task 4 Step 1 (NS-119, 2026-11-25, `next build` local, next 16.4.6):** đọc header `x-next-cache-tags` trong file `.meta` của entry dưới `.next/server/app/products/`. Trước khi sửa, `ao-git-push-force.meta` có `…,_N_T_/products/ao-git-push-force,products,product:ao-git-push-force`, ảnh OG (`ao-git-push-force/opengraph-image-16g1u1.meta`) cũng có `products`. Sau khi sửa, cả hai có `…,product-slugs,product:ao-git-push-force`, **không** còn `products`. `/` (`index.meta`) và `/sitemap.xml` vẫn có `products`; bảng route của `next build` không đổi (`/products/[slug]` vẫn ◐). C1 đúng ở phần tag; phần `HIT` sau `updateTag` kiểm ở Task 15 Step 1.
- **Trang chi tiết đọc danh sách slug cũ tối đa thời hạn `hours`** khi tập slug đổi mà không ai gọi `updateTag('product-slugs')`. Ở M5 tập slug không đổi lúc chạy (3A); thêm sản phẩm đi qua deploy (ADR-0017). Mọi tính năng sau đổi tập slug phải dùng `change: 'slug-set'`.
- **Sửa trường vẫn làm mới mọi trang danh sách** (`products`): danh sách hiện tên và giá nên phải vậy. Chỉ trang chi tiết được giữ.
- **Ghi bị hết giờ làm mới cache dù có thể chưa ghi.** Giá là một lần render lại thừa; ngược lại (không làm mới khi đã ghi) cửa hàng giữ giá cũ tới hết `hours`.
- **Xung đột hai tab** là một trạng thái lỗi mới trên form; form mang `updatedAt` mới sau mỗi lần lưu thành công nên lưu liên tiếp trong cùng tab không báo xung đột.
- **Khách không được báo khi giá đổi** (12A). Tổng giỏ luôn khớp giá sẽ thanh toán; M6 chụp giá vào `orders.items`. Muốn báo thì thêm cột giá chụp nullable trong `cart_items` (expand), ADR mới.
- **M6: mọi câu trừ kho PHẢI đặt `updated_at = now()`** (audit PR #107 L-4). Form admin ghi tồn kho **tuyệt đối** (`stock = <giá trị của form>`) và chỉ biết có người ghi chen vào nhờ `updated_at` (13A). Nếu checkout trừ kho mà không đổi `updated_at`, một form admin mở từ trước lần mua sẽ lưu đè tồn kho cũ mà không bị `conflict`, và cửa hàng bán quá số còn. Đổi `updated_at` không đảo thứ tự "Mới nhất" (11A: theo `created_at`). Admin vừa mở form khi có đơn thì nhận `conflict` và tải lại, đúng ý. Ghi trên ticket M6 (NS-6) và trong plan M5, mục "Chuyển sang M6".
- **Ẩn sản phẩm (khi làm) không bao giờ xoá khỏi DB;** sản phẩm ẩn vẫn chiếm slug. Đổi FK sang `RESTRICT` là contract, phải đi sau release cuối cùng còn code dựa vào cascade.
- **Một migration expand + một backfill ở M5** (Task 5): `products.created_at` và bảng `admin_login_failures` (ADR-0018). Code cũ chạy được trên schema mới (không đọc `created_at`, không chạm bảng mới).
- **Cách kiểm:**
  - Vitest `cache-tags.test.ts` (`tagsForProductWrite for a field edit is product:<slug> and products only`, `a slug-set change adds product-slugs`), `queries.test.ts` (`getCatalogSlugs is tagged product-slugs, not products`) (Task 4).
  - Vitest `listing.test.ts` (`editing a product does not move it in newest`, `US-02: newest stays stable on the seed`) (Task 5).
  - Vitest `actions.test.ts` (`invalidates product:<slug> and products, never product-slugs`, `still invalidates after a timed-out write`, `reports a conflict when the product changed since the form loaded`, `refuses without a session before parsing or touching the database`, `stock edit leaves cart lines untouched`) (Task 9).
  - E2E `US-13: các trang sản phẩm khác không bị render lại` (Task 15); audit Task 13 Step 5.

## Bổ sung (NS-141, audit PR #125 L1 / PR #126 N4): `NEXT_UPDATED_AT` thay `now()`

Mọi chỗ trên ghi `updated_at = now()` cho câu trừ kho (và lưu của admin) nay là `NEXT_UPDATED_AT` trong `src/features/products/updated-at-text.ts`: `greatest(clock_timestamp(), updated_at + interval '1 microsecond')`. `now()` là lúc bắt đầu transaction, nên hai ghi cùng transaction (hoặc cùng một micro giây) lưu cùng giá trị và form admin mở giữa hai lần ghi vẫn lưu được. Giá trị mới luôn lớn hơn giá trị cũ nghiêm ngặt, vẫn so khớp bằng văn bản đến micro giây như 13A.
