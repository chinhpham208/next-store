# ADR-0008: Khoá cache của danh sách sản phẩm

- Trạng thái: Đã chấp nhận; bổ sung bởi [ADR-0011](./0011-db-query-wrapper.md) (cách bọc lỗi truy vấn)
- Ngày: 2026-11-20
- Bổ sung: [ADR-0003](./0003-cache-strategy.md) (không thay thế; mọi quyết định của ADR-0003 giữ nguyên)

## Bối cảnh

ADR-0003 quy định danh sách sản phẩm dùng `"use cache"` với tag `products`. Ở M2, `/products` nhận bộ lọc từ URL: `category`, `sort`, `q`, `page` (US-02, US-03). Đối số của một hàm `"use cache"` chính là khoá cache, và trên Vercel cache này nằm trong bộ nhớ của từng instance (`design.md` §6).

Nếu đưa thẳng giá trị từ URL vào hàm cache, người dùng điều khiển được khoá: mỗi từ khoá `q`, mỗi danh mục bịa ra, mỗi số trang khác nhau tạo một entry mới. Kẻ xấu chỉ cần đổi URL là làm đầy bộ nhớ cache của instance, đẩy các entry có ích ra ngoài. Từ khoá tìm kiếm lại gần như không lặp lại giữa các người dùng, nên cache theo `q` cũng không có lợi.

Chủ dự án đã duyệt hướng này ngày 2026-11-20 (plan M2, quyết định 2 và 3).

## Các phương án

| Phương án | Ưu | Nhược |
|---|---|---|
| Cache mọi tổ hợp tham số | Đơn giản, mọi request đều có thể trúng cache | Khoá do người dùng điều khiển, số entry không giới hạn; `q` gần như không trúng cache |
| Không cache danh sách | Không có rủi ro khoá cache | Mỗi lượt xem `/products` (kể cả trang mặc định, nhiều người xem nhất) tốn hai truy vấn DB; mất phần prerender |
| **Cache theo khoá đã chuẩn hoá, tìm kiếm không cache** | Số entry hữu hạn và nhỏ; trang mặc định và các bộ lọc thường dùng vẫn nhanh | Tìm kiếm tốn hai truy vấn DB mỗi request |

## Quyết định

- `listProducts` (`src/features/products/queries.ts`) chuẩn hoá tham số **trước** khi gọi bất kỳ hàm cache nào của danh sách:
  1. Parse lại `category`, `sort`, `q` bằng `parseProductQuery` (không tin kiểu tĩnh): `sort` lạ → `newest`, `q` không phải chuỗi hoặc có ký tự điều khiển → `''`. `page` do `readPage` chuẩn hoá (ở đây `page` là số, không phải chuỗi URL): chỉ nhận thuộc tính dữ liệu riêng là số nguyên dương an toàn, còn lại (kể cả chuỗi `'2'`, getter hay Proxy ném lỗi) → `1`.
  2. `category` phải trùng một slug trong danh mục lấy từ DB (`getCategoryRows`, hàm cache không đối số, cũng là nguồn của `getCategories()`); không trùng → `null` (bỏ lọc). Bước này chạy cả ở đường tìm kiếm khi có `category`: khoá của nó không phụ thuộc người dùng.
  3. `page` được kẹp vào `1..pageCount` sau khi đếm, rồi mới tính `OFFSET` và gọi hàm lấy trang.
- `q === ''` → đường cache: `countCatalog(categoryId)` và `getCatalogPage({ categoryId, sort, page })`, cả hai `"use cache"`, `cacheTag('products')`, `cacheLife('hours')`. Khoá chỉ gồm danh mục có thật (hoặc `null`), 3 kiểu sắp xếp và số trang có thật: với 4 danh mục, 24 sản phẩm thì tối đa 5 entry đếm và 5 × 3 × 2 entry trang.
- `q !== ''` → đường không cache: `await connection()` rồi chạy thẳng truy vấn, `q` chỉ đi vào SQL dưới dạng tham số bind: `name ILIKE $1` (`ilike()` của Drizzle), `$1 = '%' + escapeLikePattern(q) + '%'`. `escapeLikePattern` thêm `\` trước `\`, `%`, `_` trong một lượt (`/[\\%_]/g`). Không có mệnh đề `ESCAPE`: với `LIKE` / `ILIKE`, ký tự escape của Postgres là `\` khi câu lệnh không chọn ký tự khác, và không có cấu hình server nào đổi được điều này.
- `q` không bao giờ nằm trong khoá cache hay `cacheTag`. Lỗi truy vấn tìm kiếm không mang `q` ra log: Drizzle bọc lỗi driver thành `Failed query: … params: …` (có `params`, `cause`) và Next in cả object, nên `searchCatalog` bắt lỗi và ném một `Error` **mới** với nội dung cố định và chỉ mã SQLSTATE (`product search query failed (SQLSTATE 42703)`), không có `cause`, `params` hay message gốc. Ngoại lệ còn lại: `DB_LOG=1` (`src/db/client.ts`) in mọi câu lệnh kèm tham số, nên **không được bật ở production**; chặn hẳn `DB_LOG` khi `VERCEL_ENV=production` thuộc phần còn lại của NS-36 (L3).
- `ORDER BY` lấy từ bảng `Record<ProductSort, SQL[]>` cố định, luôn kết thúc bằng `id` tăng dần để phân trang ổn định.
- Danh mục (`getCategoryRows`) cũng là `"use cache"` với tag `products`, không có đối số. Đếm lọc theo `products.category_id` (cột `NOT NULL` có khoá ngoại và index), không join `categories`.
- Tìm không ra kết quả (`total === 0`) thì dừng sau câu đếm, không chạy câu lấy trang.

## Hệ quả

- Số entry cache của danh sách tỉ lệ với số danh mục × 3 × số trang thật, không phụ thuộc người dùng gửi gì.
- Admin sửa sản phẩm (M5) gọi `updateTag('products')` là làm mới cả danh mục, số lượng và mọi trang danh sách.
- Entry đếm (`countCatalog`) và entry trang (`getCatalogPage`) được nạp ở hai thời điểm nên **hết hạn độc lập** (lệch nhau tối đa một vòng `cacheLife('hours')`). Khi hết hạn tự nhiên mà dữ liệu đã đổi, tổng số / số trang có thể tạm lệch với nội dung trang; trang luôn được kẹp theo số đếm nên không lỗi, chỉ có thể thiếu hoặc thừa vài sản phẩm cho tới lần nạp sau. `updateTag('products')` làm mới cả hai cùng lúc nên không lệch khi admin sửa.
- **Chi phí của tìm kiếm không cache.** Mỗi request có `q` chạy hai truy vấn (`count` và trang; một nếu không có kết quả). `ILIKE '%…%'` có ký tự đại diện ở đầu nên B-tree không dùng được: Postgres quét tuần tự bảng `products`. Với vài chục đến vài nghìn sản phẩm chi phí này nhỏ; nhưng ai cũng gửi được nhiều request tìm kiếm liên tiếp, và mỗi request chạm DB.
- **Nơi xử lý sau này (chưa làm ở M2):**
  - *Giới hạn tần suất:* đặt ở tầng biên trước khi tới DB, ví dụ quy tắc rate limit của Vercel Firewall cho `/products?q=*`, hoặc trong `src/proxy.ts` (có từ Task 12 của M2) nếu cần logic theo IP. Cần ADR riêng nếu thêm thư viện hoặc kho đếm (Redis).
  - *Index trigram:* migration bật `pg_trgm` và tạo `CREATE INDEX products_name_trgm_idx ON products USING gin (name gin_trgm_ops)`; Postgres dùng được index này cho `ILIKE '%…%'`. Làm khi số sản phẩm hoặc lượng tìm kiếm đủ lớn để thấy trong log chậm của Neon; M2 không có migration.
- **Giới hạn kiểm thử:** test chạy trên PGlite. Việc `%`, `_`, `\`, `\%`, `a\` khớp đúng nghĩa đen và `ILIKE` không phân biệt hoa thường với chữ có dấu chỉ được kiểm trên PGlite; Neon (collation, phiên bản Postgres) được kiểm bằng E2E trên preview / Dev (Task 14 của M2).
