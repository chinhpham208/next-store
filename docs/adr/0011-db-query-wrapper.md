# ADR-0011: Truy vấn runtime đi qua `dbQuery`

- Trạng thái: Đã chấp nhận (theo plan M3 đã duyệt ở Cổng 1, quyết định 10)
- Ngày: 2026-11-22
- Bổ sung: [ADR-0008](./0008-listing-cache-keys.md) (thay câu "`searchCatalog` bắt lỗi và ném một `Error` mới"), [ADR-0009](./0009-product-404-in-proxy.md) (không đổi ngưỡng 400 ms của proxy)
- Liên quan: ticket NS-55 (M3 Task 7), audit PR #26 (L4), QA NS-52

## Bối cảnh

Drizzle 0.45 bọc mọi lỗi của driver thành `Error('Failed query: <câu SQL>\nparams: <giá trị>')`, có thêm thuộc tính `query`, `params` và `cause` là lỗi của postgres-js (`connect ECONNREFUSED 10.1.2.3:5432`, kèm `address`, `port`). Next.js in nguyên object lỗi ra log server. Audit PR #26 (L4) và QA NS-52 thấy trên bản build thật:

- Đường danh sách (`getCategories`, `countCatalog`, `getCatalogPage`) và trang chi tiết in `Failed query: select … from "products" …` và `[cause]: Error: connect ECONNREFUSED 127.0.0.1:9` — câu SQL, tham số (slug do người dùng gõ) và host:port của database nằm trong log.
- Chỉ đường tìm kiếm đã tự bọc lỗi (`searchCatalog`, ADR-0008); mỗi truy vấn mới phải nhớ làm lại điều đó.
- Không truy vấn nào có giới hạn thời gian: với database nhận kết nối TCP rồi im lặng, trang lỗi chỉ hiện sau `connect_timeout` của client (10 giây); E2E trên `develop` đo được 10,4 giây cho `/products`.

## Các phương án

| Phương án | Ưu | Nhược |
|---|---|---|
| Bọc từng hàm như `searchCatalog` | Không đổi cấu trúc | Mỗi truy vấn mới phải nhớ bọc; không có gì kiểm tự động; lặp mã |
| `Proxy` JavaScript quanh `db` | Mã gọi không đổi | Builder của Drizzle là chuỗi đối tượng lười, lỗi nổ ở `then` của đối tượng cuối; phải bọc mọi phương thức trả về builder, dễ sót (`transaction`, `execute`, `$count`); khó đọc, khó review |
| **Hàm bọc `dbQuery` + không export `db` thô** | Một chỗ duy nhất thay lỗi và đặt giới hạn thời gian; dependency-cruiser chặn được đường vòng | Mỗi truy vấn đổi thành `dbQuery({ name, run: (db) => … })` |

## Quyết định

- `src/db/query.ts` có `dbQuery({ name, run, timeoutMs? })`. `name` có kiểu `` `${string}.${string}` `` (`<miền>.<việc>`), là hằng trong code, không bao giờ chứa dữ liệu người dùng; nó là thứ duy nhất của truy vấn xuất hiện trong log.
- `run` ném hoặc reject → `dbQuery` ném một `Error` **mới**: `database query failed: <name>` hoặc `database query failed: <name> (<mã>)`, thuộc tính `code` = mã. Mã đọc từ `error.cause` rồi tới `error`, chỉ nhận SQLSTATE (`^[0-9A-Z]{5}$`) hoặc errno (`^E[A-Z0-9_]{2,30}$`); mã khác bị bỏ. Không `cause`, `params`, `query`, message gốc.
- Quá `timeoutMs` → ném `database query timed out: <name>`, `code = 'DB_QUERY_TIMEOUT'`. Mặc định lấy từ `DB_QUERY_TIMEOUT_MS` qua `resolveQueryTimeout`: chỉ chữ số, 100 → 10000; thiếu hoặc khác → **5000 ms** (quyết định 10: Neon thức dậy thường dưới 1–2 giây, client chờ kết nối tới 10 giây). Timer `unref()` và `clearTimeout` khi xong. `Promise.race` giữ handler trên lời hứa của `run`, nên reject muộn (ví dụ `CONNECT_TIMEOUT` sau 10 giây) không thành `unhandledRejection`.
- Truy vấn phía driver **không bị huỷ**: trang thôi chờ, còn kết nối tự đóng theo `connect_timeout` / `idle_timeout` của postgres-js.
- `@/db` (`src/db/index.ts`) export `dbQuery`, `resolveQueryTimeout`, `DbQueryName`, bảng và kiểu; **không export `db`**. Quy tắc dependency-cruiser `db-internals-stay-in-db` cấm `src/app`, `src/features`, `src/lib`, `src/components`, `src/proxy.ts` (trừ file `*.test.ts`) import `src/db/client|migrate|seed.ts`. Test và script trong `src/db` vẫn dùng `db` từ `@/db/client`.
- Tên truy vấn của `features/products`: `products.featured`, `products.detail`, `products.slugs`, `products.categories`, `products.count`, `products.page`, `products.search-count`, `products.search-page`, `products.slug-guard`. `searchFailed` / `sqlStateOf` của `queries.ts` bị xoá.
- Hàm `'use cache'` giữ nguyên chữ ký, tag, `cacheLife`; timer bên trong hàm `'use cache'` chạy bình thường (K12 của plan M3).

## Hệ quả

- Lỗi tìm kiếm nay là `database query failed: products.search-count (42703)` thay cho `product search query failed (SQLSTATE 42703)` của ADR-0008.
- Log server khi database chết (đo bằng E2E `NS-55: log server không có câu SQL hay host khi DB chết`): chỉ `Error: database query failed: products.<việc> (ECONNREFUSED)` kèm stack của bundle; khi database treo: `database query timed out: products.<việc>` sau giới hạn.
- Proxy vẫn có ngưỡng riêng 400 ms và fail-open (ADR-0009); `products.slug-guard` chịu thêm giới hạn của `dbQuery`, lớn hơn nên không đổi hành vi của proxy.
- Một trang có thể chạy vài truy vấn nối tiếp (danh mục → đếm → trang), mỗi truy vấn có giới hạn riêng: trường hợp xấu nhất là vài lần giới hạn, không phải một. Database treo thì truy vấn đầu tiên đã hết giờ nên trang lỗi hiện sau khoảng một lần giới hạn.
- `DB_LOG=1` vẫn in câu lệnh kèm tham số qua logger của Drizzle (không qua lỗi), và vẫn bị chặn trên production (NS-36 Task 1).
- Từ M4 (giỏ hàng, đơn hàng), mọi truy vấn và transaction mới cũng đi qua `dbQuery`; ghi dữ liệu bị timeout không có nghĩa là chưa ghi — Server Action phải coi kết quả là không biết và không tự thử lại một thao tác không lặp lại được.
