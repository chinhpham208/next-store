# ADR-0014: Giỏ hàng lưu trong DB, cookie chỉ giữ id giỏ

- Trạng thái: Đã chấp nhận (chủ dự án duyệt 2026-11-23, PR #66)
- Ngày: 2026-11-23
- Quyết định của chủ dự án: 2026-11-23 (plan M4, Cổng 1, quyết định 1, 2, 3, 4, 5, 6, 7, 9, 10, 11)
- Bổ sung: [ADR-0003](./0003-cache-strategy.md) (gạch đầu dòng "Blog: tĩnh hoàn toàn lúc build"), [ADR-0012](./0012-blog-static-registry.md) (mục Cache: blog vẫn prerender nhưng header có một lỗ động), [ADR-0009](./0009-product-404-in-proxy.md) (proxy bỏ qua request không phải `GET` / `HEAD`)
- Liên quan: [ADR-0010](./0010-app-role-and-preview-data.md) (role app chỉ DML), [ADR-0011](./0011-db-query-wrapper.md) (ghi bị hết giờ là "không biết đã ghi hay chưa"), [ADR-0013](./0013-db-client-recycle.md) (`run` một câu, nhiều câu dùng `transaction`), [ADR-0015](./0015-edge-rate-limit.md) (giới hạn tốc độ cho Server Action, quyết định 8), `docs/plans/M4.md`, ticket NS-4 (epic M4), NS-86 (Task 1), NS-77, NS-79

## Bối cảnh

M4 làm ba story của khách vãng lai:

- **US-06:** thêm sản phẩm từ trang chi tiết, số trên biểu tượng giỏ tăng ngay, trước khi server trả lời. Lỗi thì số trở lại và có thông báo.
- **US-07:** sửa số lượng, xoá dòng, đặt về 0 là xoá, tổng tiền cập nhật. Đóng trình duyệt mở lại thì giỏ vẫn còn.
- **US-08:** thêm quá tồn kho bị từ chối với "Chỉ còn N sản phẩm". Sản phẩm hết hàng có nút "Thêm vào giỏ" bị vô hiệu.

Không giữ chỗ tồn kho, không thanh toán (US-09 thuộc M6), không tài khoản khách hàng (`requirements.md` §6).

Những ràng buộc đã có trước M4:

- `design.md` §4–5 và `architecture.md` §5 (duyệt từ M1) đã vẽ bảng `carts`, `cart_items` và cookie `httpOnly` giữ id giỏ.
- **M6 xoá giỏ trong webhook.** Webhook thanh toán là request server-to-server: nó không đặt hay xoá được cookie của trình duyệt, nên giỏ phải nằm ở chỗ webhook tìm được theo đơn hàng.
- **Role app chỉ DML** (ADR-0010, NS-61 có thể xong trước, giữa hay sau M4). Runtime không được `CREATE`, `ALTER`, `GRANT`; bảng mới tự có quyền nhờ `ALTER DEFAULT PRIVILEGES`, nhưng sequence của cột `serial` / identity cần quyền riêng.
- **Một câu mỗi `run`** (NS-77, ADR-0013). Từ hai câu trở lên phải dùng `dbQuery({ transaction })`. Ghi bị `DB_QUERY_TIMEOUT` nghĩa là không biết đã ghi hay chưa (ADR-0011), nên không được tự thử lại.
- **Proxy chạy ở edge, không ở `sin1`** (NS-79, ADR-0009). Mỗi lần tra slug từ edge xa có thể tốn tới 400 ms rồi fail-open.

Những điều đã đọc trong tài liệu của next 16.4.6 và Vercel (plan M4, D1–D9):

- D1: `cookies()` chỉ `set` / `delete` được trong Server Function hoặc Route Handler. Gọi `cookies()` trong `<Suspense>` thì chỉ cây con đó stream lúc request; gọi ngoài boundary thì route mất prerender.
- D2: Server Action đặt hoặc xoá cookie thì Next.js tự render lại route hiện tại và gửi RSC mới trong cùng response.
- D3: client gửi Server Action tuần tự; server thì không xếp hàng, hai tab là hai luồng song song.
- D4: CSRF: Next.js so `Origin` với `Host` / `X-Forwarded-Host`. Request không có `Origin` được cho qua kèm cảnh báo. Body tối đa 1 MB.
- D5: mỗi Server Action là một POST công khai: phải tự validate input, tự xác định quyền từ server, giới hạn giá trị trả về. Deploy mới đổi action ID.
- D6: `useOptimistic` giữ giá trị lạc quan trong lúc transition chờ. Action **ném** trong transition thì lỗi tới error boundary gần nhất.
- D7: `updateTag`, `refresh()` chỉ gọi được trong Server Action.
- D8: hàm `'use cache'` không gọi được `cookies()`. Đối số và tag của cache lưu dạng văn bản thường.
- D9: Vercel WAF Rate Limiting có trên mọi gói; Hobby chỉ có một quy tắc rate limit mỗi project (ADR-0015).

Chưa kiểm, có bước kiểm tại chỗ trong plan (kết quả khác dự kiến thì dừng, sửa plan và ADR này):

- C1: số lạc quan về 0 cùng lúc với RSC mới, không nháy "1 → 0 → 1" (Task 8 Step 1).
- C2: lỗ `<Suspense>` đọc cookie trong `(shop)/layout.tsx` giữ vỏ prerender của `/`, `/products/<slug>`, `/blog/<slug>`; `app/not-found.tsx` vẫn tĩnh (Task 8 Step 1).
- C3: POST của Server Action tới `/products/<slug>` có chạy qua `src/proxy.ts` (Task 7 Step 1).
- C4: action trả `{ ok: false }` không đặt cookie thì không có RSC mới; gọi `refresh()` thì có (Task 5 Step 1).

## Các phương án

Số của mỗi mục là số quyết định trong plan M4. Quyết định 8 (giới hạn tốc độ) nằm ở [ADR-0015](./0015-edge-rate-limit.md). Quyết định 12 (NS-84 chặn E2E của M4) là việc quy trình, không phải kiến trúc: nó nằm trong plan M4, không ghi lại ở đây.

### 1. Giỏ của khách vãng lai lưu ở đâu

| Phương án | Ưu | Nhược |
|---|---|---|
| **A. DB** (`carts`, `cart_items`), cookie chỉ giữ id giỏ | Đúng `design.md` §4–5 và `architecture.md` §5 đã duyệt từ M1. Server là nguồn sự thật. M6 đọc giỏ trong transaction tạo đơn và webhook xoá giỏ được (webhook là server-to-server, không đặt được cookie cho trình duyệt). Cookie nhỏ, không chứa gì đọc được | Thêm migration (expand) và hai bảng. Mỗi lượt xem trang khi có cookie tốn một truy vấn đếm. Khách ẩn danh tạo được hàng trong DB nên cần giới hạn (mục 5, 7, ADR-0015) và dọn giỏ hết hạn |
| B. Cookie chứa toàn bộ giỏ (danh sách `slug × số lượng`, ký HMAC hoặc chỉ validate bằng Zod) | Không bảng, không migration, không ghi DB khi thêm (vẫn đọc tồn kho). Không có tải ghi từ người lạ. Không cần dọn | Lệch `design.md` / `architecture.md`. Webhook M6 không xoá được giỏ, nên phải xoá ở `/checkout/success` bằng một action hay Route Handler riêng. Cookie lớn dần (gửi kèm mọi request, kể cả ảnh), giới hạn khoảng 4 KB. Nếu ký thì thêm một secret phải quản lý |
| C. `localStorage` ở trình duyệt, gửi lên server khi cần | Không ghi DB | Số trên biểu tượng chỉ có sau khi JavaScript chạy (vỏ trang không biết). Trái `conventions.md` §2 (state server ở client). M6 phải tin dữ liệu client gửi lên |

### 2. Có đăng nhập khách hàng ở M4 không

| Phương án | Ưu | Nhược |
|---|---|---|
| **A. Không.** Giỏ gắn với trình duyệt qua cookie | Đúng `requirements.md` §2 ("Không cần đăng ký tài khoản") và §6 ("Tài khoản khách hàng" ngoài phạm vi). Không cần email, mật khẩu hay nhà cung cấp đăng nhập | Đổi trình duyệt hay thiết bị thì không thấy giỏ cũ. Xoá cookie là mất giỏ |
| B. Đăng nhập bằng email (magic link) để giữ giỏ qua thiết bị | Giỏ theo người | Ngoài phạm vi đã duyệt. Cần dịch vụ gửi email (tài khoản, chi phí), bảng người dùng, gộp giỏ. Có dữ liệu cá nhân thật trên production trước khi mở bán |
| C. Không ở M4, nhưng để ngỏ: ADR này ghi cách thêm `carts.customer_id` nullable (expand) và quy tắc gộp giỏ | Như A, cộng đường đi rõ khi cần | Không thêm gì lúc này |

### 3. Định danh giỏ trong cookie

| Phương án | Ưu | Nhược |
|---|---|---|
| **A. UUID v4 ngẫu nhiên do server sinh** (`crypto.randomUUID()`, 122 bit ngẫu nhiên), cookie `httpOnly` | Không đoán được. Không secret mới. Validate bằng `z.uuidv4()` rồi tra theo khoá chính | Cookie giả (UUID hợp lệ bịa ra) vẫn tốn một truy vấn theo khoá chính, không có kết quả |
| B. UUID v4 + chữ ký HMAC-SHA256 bằng secret `CART_COOKIE_SECRET` (Web Crypto) | Cookie giả bị loại trước khi chạm DB | Thêm một secret chủ dự án phải đặt trên Vercel cho Production và Preview. Xoay secret là mọi giỏ mất. Không tăng bảo mật cho chính giỏ (UUID đã không đoán được) |
| C. Id tăng dần (`serial`) ký HMAC | Id ngắn | Bắt buộc có chữ ký (id đoán được). Cần quyền sequence cho role app. Lộ số giỏ đã tạo |

### 4. Giá trong giỏ: chụp lúc thêm hay giá hiện tại

| Phương án | Ưu | Nhược |
|---|---|---|
| **A. Giá hiện tại** (đọc `products.price` mỗi lần hiện giỏ; `cart_items` không có cột giá) | Đơn giản. Tổng tiền luôn khớp giá sẽ thanh toán. M6 chụp giá vào `orders.items` lúc tạo đơn (`architecture.md` §5) | Khi admin đổi giá (M5), khách thấy giá mới mà không được báo |
| B. Chụp giá lúc thêm (`cart_items.unit_price`) và tính tổng theo giá chụp | Khách thấy đúng giá lúc chọn | Thanh toán theo giá nào? Theo giá chụp là bán giá cũ vô thời hạn; theo giá hiện tại thì tổng trong giỏ sai. Thêm cột phải giữ đồng bộ |
| C. Giá hiện tại + chụp giá để **báo** "Giá đã đổi từ X thành Y" | Minh bạch nhất | Thêm cột, thêm trạng thái giao diện. Giá chỉ đổi được từ M5 nên M4 không có ca thật để kiểm |

### 5. Giới hạn số lượng

| Phương án | Ưu | Nhược |
|---|---|---|
| **A. Mỗi dòng tối đa 10 cái (và không quá tồn kho), mỗi giỏ tối đa 20 loại sản phẩm** | Chặn một giỏ phình to vô hạn. Số nhỏ hợp cửa hàng quà tặng. Ô số lượng đơn giản | Khách mua sỉ (> 10 cái) phải liên hệ. Với tồn kho hiện có (tối đa 20), giới hạn 10 thấp hơn tồn kho ở vài sản phẩm |
| B. Chỉ giới hạn theo tồn kho | Không chặn ai mua hết kho | Không có trần khi admin nhập tồn kho lớn (M5). Số loại trong giỏ không giới hạn |
| C. Mỗi dòng tối đa 99, mỗi giỏ 50 loại | Rộng rãi | Trần lỏng, ít tác dụng chống lạm dụng |

### 6. Giỏ hết hạn sau bao lâu

| Phương án | Ưu | Nhược |
|---|---|---|
| **A. 30 ngày, trượt** (mỗi lần thêm / sửa / xoá đặt lại `Max-Age` của cookie và `carts.updated_at`) | Đủ dài cho "quay lại sau". Giỏ bỏ quên tự biến mất. Cookie và DB cùng một hạn | Chỉ xem giỏ (không ghi) thì không gia hạn |
| B. 7 ngày, trượt | Ít dữ liệu tồn đọng hơn | Khách quay lại sau một tuần mất giỏ |
| C. 90 ngày hoặc không hết hạn | Giỏ gần như vĩnh viễn | Nhiều giỏ chết. Cookie sống lâu hơn mức cần cho một cửa hàng chưa mở bán |

### 7. Dọn giỏ hết hạn bằng cách nào

| Phương án | Ưu | Nhược |
|---|---|---|
| **A. Dọn dần trong action:** mỗi lần tạo giỏ mới, xoá tối đa 50 giỏ quá hạn (một câu `DELETE … LIMIT 50`, lỗi bị bỏ qua) | Không endpoint mới, không secret, không cron. Tốc độ dọn tăng theo tốc độ tạo giỏ | Thêm một câu lệnh vào lần thêm đầu tiên của khách mới (sau khi đã xong phần chính). Không ai tạo giỏ mới thì không dọn (khi đó cũng không có giỏ mới tích luỹ) |
| B. Vercel Cron hằng ngày (Hobby cho phép) gọi một Route Handler có `CRON_SECRET` | Dọn đều, tách khỏi đường người dùng | Thêm một route công khai, một secret, một cấu hình cron. Route Handler chỉ dùng cho request từ bên ngoài (`conventions.md` §2): cron là ngoại lệ phải ghi thêm |
| C. Không dọn ở M4 | Ít việc nhất | Bảng chỉ tăng. Neon Free 0,5 GB |

### 9. Biểu tượng giỏ có số trên header ở mọi trang

| Phương án | Ưu | Nhược |
|---|---|---|
| **A. Có, ở mọi trang `(shop)`** (lỗ động trong Suspense ở layout) | Đúng cách người dùng hiểu "biểu tượng giỏ". Khách thấy giỏ ở mọi nơi | Mọi trang (cả blog) có một lỗ động. Khách có cookie giỏ tốn một truy vấn mỗi lượt xem. Blog thôi "tĩnh hoàn toàn" (bổ sung ADR-0003, ADR-0012) |
| B. Chỉ trên trang sản phẩm và `/cart`; các trang khác có link "Giỏ hàng" không số | Blog, trang chủ, danh sách giữ nguyên tĩnh và không chạm DB | Số "nhảy" mất khi rời trang sản phẩm. Header khác nhau giữa các trang |

### 10. Dòng trong giỏ vượt tồn kho hiện tại

Tồn kho giảm sau khi đã thêm: ở M4 chỉ xảy ra khi seed lại, từ M5 khi admin sửa, từ M6 khi người khác mua.

| Phương án | Ưu | Nhược |
|---|---|---|
| **A. Giữ nguyên số lượng, hiện cảnh báo trên dòng** ("Chỉ còn N sản phẩm"; tồn 0 thì Badge "Hết hàng"). Cho giảm, không cho tăng. Tổng tiền vẫn tính cả dòng. M6 chặn thanh toán khi còn dòng như vậy | Không ghi DB khi chỉ đọc. Khách tự quyết | Tổng tiền có thể gồm hàng không mua được tới khi khách sửa |
| B. Tự kẹp số lượng về tồn kho khi mở giỏ | Giỏ luôn mua được | Ghi DB lúc đọc (Server Component không nên ghi). Khách không biết vì sao số đổi |
| C. Tự xoá dòng hết hàng | Giỏ gọn | Mất dấu món khách muốn. Như B, ghi lúc đọc |

### 11. Proxy có bỏ qua request không phải `GET` / `HEAD` không

| Phương án | Ưu | Nhược |
|---|---|---|
| **A. Có:** `POST` (Server Action trên `/products/<slug>`) đi thẳng, không tra slug | Thêm vào giỏ không chờ tới 400 ms tra slug từ edge xa (NS-79). Proxy không tốn truy vấn cho mỗi lần thêm | Đổi hành vi đã ghi trong ADR-0009 (bổ sung bằng ADR này). Một POST tới slug lạ không còn 404 từ proxy (action vẫn tự kiểm sản phẩm, trang không có gì để lưu cache) |
| B. Không, giữ như M3 | Không đổi proxy | Mỗi lần thêm vào giỏ từ khách ở xa Singapore có thể chậm thêm tới 400 ms (fail-open) |

## Quyết định

Câu trả lời của chủ dự án ở Cổng 1 (plan M4, mục "Cần chủ dự án quyết"), chép nguyên văn:

> **Đã quyết (2026-11-23):** chủ dự án duyệt tất cả: 1A, 2A (kèm ghi chú C trong ADR-0014), 3A, 4A, 5A, 6A, 7A, 8A, 9A, 10A, 11A (nếu Task 7 Step 1 xác nhận C3), 12A.

Áp vào giỏ hàng như sau.

- **Lưu trữ (1A).** Giỏ nằm trong DB, thêm bằng **một** migration `drizzle/0001_*.sql` chỉ expand (`conventions.md` §10):
  - `carts`: `id uuid PRIMARY KEY` không có default (server sinh), `created_at`, `updated_at timestamptz NOT NULL DEFAULT now()`. Index `carts_updated_at_idx (updated_at)` để dọn giỏ hết hạn.
  - `cart_items`: `cart_id uuid NOT NULL REFERENCES carts(id) ON DELETE CASCADE`, `product_id integer NOT NULL REFERENCES products(id) ON DELETE CASCADE`, `quantity integer NOT NULL`, `created_at timestamptz NOT NULL DEFAULT now()` (thứ tự dòng). `PRIMARY KEY (cart_id, product_id)`: mỗi sản phẩm một dòng mỗi giỏ. `CHECK cart_items_quantity_positive (quantity > 0)`. Index `cart_items_product_id_idx (product_id)`.
  - Không cột `serial` / identity, nên không có sequence cần quyền: chạy được với cả role chủ và `next_store_app` (ADR-0010). Mọi truy vấn runtime là DML.
- **Không tài khoản (2A, kèm ghi chú C).** Giỏ gắn với trình duyệt qua cookie. Đường mở rộng khi sau này có tài khoản khách hàng: xem Hệ quả (d). Không có code nào cho việc này ở M4.
- **Id giỏ (3A).** UUID v4 do server sinh bằng `crypto.randomUUID()`, không ký, không secret mới.
  - Cookie chỉ chứa id giỏ. Tên `__Host-ns_cart` khi site chạy HTTPS (`getSiteUrl()` có `https:`), `ns_cart` khi không (local, CI).
  - Thuộc tính cố định: `httpOnly: true`, `sameSite: 'lax'`, `path: '/'`, `secure` = site HTTPS, `maxAge` = `CART_TTL_DAYS × 86400`, không `domain`.
  - Đọc cookie chỉ trong `src/features/cart/cookie.ts`, validate bằng `z.uuidv4()`. Id sai dạng thì coi như không có giỏ và **không** chạm DB.
  - Server **không bao giờ** tạo giỏ với id do client gửi. Cookie có id hợp lệ mà giỏ không tồn tại hoặc đã hết hạn thì lần thêm tạo giỏ với id mới.
- **Giá (4A).** Giá là `products.price` hiện tại, đọc mỗi lần hiện giỏ. `cart_items` không có cột giá. Thành tiền = giá × số lượng.
- **Giới hạn số lượng (5A).** `MAX_LINE_QUANTITY = 10`, `MAX_CART_LINES = 20` trong `src/features/cart/limits.ts`. DB chỉ có `CHECK (quantity > 0)`: đổi số sau này không cần migration và không phải contract.
  - Kiểm tồn kho so **tổng đã có trong giỏ + số thêm** với tồn kho (có 2, thêm 2 khi còn 3 thì bị từ chối với "Chỉ còn 3 sản phẩm").
  - Tồn kho đọc trong transaction của action, **không** qua hàm `'use cache'`. Trang sản phẩm vẫn dùng dữ liệu cache để vô hiệu nút khi hết hàng; server là nơi quyết định cuối.
  - M4 không trừ, giữ chỗ hay sửa `products.stock`, nên không gọi `updateTag` / `revalidateTag` nào.
- **Hết hạn (6A).** `CART_TTL_DAYS = 30`, trượt. Mỗi lần thêm / sửa / xoá thành công đặt lại `Max-Age` của cookie và `carts.updated_at`. Giỏ có `updated_at` cũ hơn 30 ngày đọc như giỏ trống, kể cả khi chưa bị dọn.
- **Dọn giỏ (7A).** Chỉ khi một action vừa tạo giỏ mới, nó chạy thêm **một** câu `DELETE FROM carts WHERE id IN (SELECT id FROM carts WHERE updated_at < cutoff ORDER BY updated_at LIMIT 50)`. `cart_items` theo `ON DELETE CASCADE`. Lỗi của câu này bị nuốt, chỉ in một dòng cố định `cart: purge of expired carts failed`. Không cron, không Route Handler.
- **Ghi bằng Server Action.** Chỉ ba action trong `src/features/cart/actions.ts`: `addToCartAction`, `setCartQuantityAction`, `removeFromCartAction`.
  - Tham số `unknown`, parse bằng Zod trước mọi thứ khác (D5). Input sai thì trả `invalid`, không chạm cookie, không chạm DB.
  - Mỗi action chạy **một** `dbQuery({ transaction })` (NS-77, ADR-0013). Transaction bắt đầu bằng `UPDATE carts SET updated_at … RETURNING id` để khoá hàng giỏ: mọi ghi của cùng một giỏ đi tuần tự, kể cả từ hai tab (D3).
  - Lần thêm đầu bị từ chối thì không ghi gì: `INSERT carts` nằm **sau** mọi kiểm.
  - Action **không ném** lỗi nghiệp vụ (D6). Nó trả `CartActionResult = { ok: true; count } | { ok: false; error; available? }` và client hiện thông báo cạnh nút. Giá trị trả về không có hàng DB thô, không có id giỏ.
  - `dbQuery` ném (`DB_QUERY_TIMEOUT`, lỗi DB): action gọi `refresh()` rồi trả `unavailable`, **không** thử lại (ADR-0011: ghi bị hết giờ là không biết đã ghi hay chưa).
  - Sửa / xoá khi giỏ đã hết hạn hoặc không có cookie: trả giỏ rỗng và xoá cookie, không tạo giỏ mới.
  - Không action inline trong component, không `redirect()` trong action, không Route Handler cho giỏ.
- **Biểu tượng giỏ ở mọi trang `(shop)` (9A).**
  - `(shop)/layout.tsx` bọc header trong một `CartProvider` (client) giữ `useOptimistic` **độ lệch** số lượng đang chờ.
  - Số trên biểu tượng là một lỗ động `<Suspense>` (đọc cookie + một truy vấn đếm), nên vỏ trang vẫn prerender (D1, C2).
  - Truy vấn đếm lỗi thì biểu tượng hiện không có số và in một dòng cố định; lỗi không tới `error.tsx`.
  - `src/components/layout/site-header.tsx` nhận biểu tượng qua slot, không import feature.
  - `app/not-found.tsx` (ngoài `(shop)`) dùng một link "Giỏ hàng" tĩnh không số, nên trang 404 giữ tĩnh.
  - Dữ liệu giỏ không bao giờ nằm trong `'use cache'` (D8), không dùng `'use cache: private'`. Trang `/cart` động hoàn toàn, `noindex`, không vào sitemap.
- **Dòng vượt tồn kho (10A).** Giữ nguyên số lượng, hiện "Chỉ còn N sản phẩm" trên dòng (tồn 0 thì Badge "Hết hàng"). Giảm số lượng luôn được, kể cả khi vẫn vượt tồn kho. Kiểm `quantity > stock` chỉ áp khi tăng. Tổng tiền vẫn tính cả dòng. Đọc giỏ không bao giờ ghi DB.
- **Proxy (11A, có điều kiện).** Nếu Task 7 Step 1 xác nhận C3 (POST của Server Action chạy qua proxy): `src/proxy.ts` trả `NextResponse.next()` cho mọi request không phải `GET` / `HEAD` **trước** mọi kiểm slug, không tra DB, không log. `GET` / `HEAD` giữ nguyên hành vi của ADR-0009 và ADR-0012; matcher không đổi. Nếu C3 sai (proxy không chạy cho POST) thì không sửa proxy và Task 7 đóng là "không cần". Proxy không đọc cookie giỏ và không tra DB cho giỏ trong cả hai trường hợp.

## Hệ quả

- **(a) Mọi trang `(shop)` có một lỗ động; blog không còn "tĩnh hoàn toàn"** (bổ sung ADR-0003, ADR-0012). `/blog` và `/blog/<slug>` vẫn prerender lúc build (`generateStaticParams`, không `'use cache'`, không tag), nhưng lỗ biểu tượng giỏ ở header được stream lúc request. Bảng route của `next build` phải cho thấy `/`, `/products/<slug>`, `/blog/<slug>` là partial prerender (C2, Task 8). C2 sai thì dừng và quyết định lại mục 9.
- **(b) Một truy vấn mỗi lượt xem trang khi có cookie giỏ.** Không có cookie (hoặc cookie sai dạng) thì không truy vấn. Có cookie hợp lệ thì một câu `SELECT coalesce(sum(quantity), 0)` theo khoá chính, chạy ở `sin1` cạnh Neon. Cookie giả có id hợp lệ cũng tốn đúng một truy vấn như vậy, kết quả rỗng (mục 3).
- **(c) M6 đọc giỏ trong transaction tạo đơn.** Server Action thanh toán đọc `cart_items` + giá hiện tại trong cùng transaction tạo `orders`, chụp giá vào `orders.items` (`architecture.md` §5). Webhook xoá `cart_items` theo `cart_id` của đơn (không cần cookie). Giỏ không giữ hàng: hai người có thể cùng có món cuối trong giỏ; M6 xử lý bằng `needs_refund`. M6 chặn thanh toán khi còn dòng vượt tồn kho (mục 10).
- **(d) Đường mở rộng khi có tài khoản khách hàng** (ghi chú C của quyết định 2, chỉ là văn bản). Thêm `carts.customer_id` nullable bằng một migration expand (cột nullable, index, khoá ngoại tới bảng khách hàng mới). Khi khách đăng nhập: giỏ của trình duyệt được gắn `customer_id`; nếu khách đã có giỏ cũ thì gộp từng dòng, số lượng cộng lại rồi kẹp theo `MAX_LINE_QUANTITY`, tồn kho và `MAX_CART_LINES`, xoá giỏ còn lại. Quy tắc gộp chi tiết là quyết định của chủ dự án khi làm tính năng đó, ADR mới.
- **(e) Proxy bỏ qua POST** (bổ sung ADR-0009, nếu C3 đúng). Một POST tới slug sản phẩm lạ không còn nhận 404 từ proxy. Action vẫn tự kiểm sản phẩm (`not-found`), và POST không tạo entry route cache. Ca này được thêm vào `scripts/smoke.sh` (POST không có `next-action` tới `/products/khong-ton-tai` không trả 5xx). Task 7 ghi kết quả đo C3 vào mục này.
- **Giá có thể đổi mà khách không được báo** (từ M5, khi admin sửa được giá). Muốn báo "Giá đã đổi" (4C) thì thêm cột giá chụp nullable ở M5: expand, không phải viết lại.
- **Khách ẩn danh tạo được hàng trong DB.** Trần cấu trúc: mỗi giỏ tối đa 20 dòng × 10 cái; chỉ tạo giỏ khi lần thêm đầu thành công; dọn 50 giỏ hết hạn mỗi lần tạo giỏ mới. Trần theo thời gian là quy tắc WAF của [ADR-0015](./0015-edge-rate-limit.md). Task 11 tính trần tăng trưởng thật trên Neon Free (0,5 GB).
- **CSRF.** Next.js từ chối Server Action có `Origin` lệch host (D4). Request không có `Origin` được cho qua, nhưng trình duyệt luôn gửi `Origin` cho POST khác site, và cookie `SameSite=Lax` không đi kèm POST khác site. Kẻ tấn công vì vậy chỉ ghi được giỏ của chính mình. Task 11 kiểm lại trên Dev.
- **Deploy mới đổi action ID** (D5). Client còn mở trang cũ nhận lỗi "Failed to find Server Action": nút bắt lỗi trong `try` / `catch`, trả số về như cũ và hiện "Không kết nối được. Vui lòng tải lại trang và thử lại." thay vì rơi vào trang lỗi.
- **Không log dữ liệu giỏ.** Không `console.*` object lỗi, `cause`, SQL, host, id giỏ hay giá trị cookie; chỉ chuỗi cố định. Tên truy vấn là hằng `cart.<việc>`.
- **`"use client"` mở rộng** ra đúng bốn file của `src/features/cart/components` (`cart-provider.tsx`, `cart-link.tsx`, `add-to-cart-form.tsx`, `cart-line-controls.tsx`), cộng `src/app/(shop)/error.tsx` đã có (`conventions.md` §2). Có test kiểm danh sách này (Task 8).
- **Kiểm chứng:** Vitest và E2E liệt kê trong plan M4 (mục "Ánh xạ tiêu chí chấp nhận → test" và "Review Focus"); audit bảo mật Task 11 (cookie, Server Action, CSRF, input, giới hạn tốc độ). Kết quả C1–C4 được ghi vào PR của task kiểm, và vào mục này khi chúng đổi điều đã ghi.
