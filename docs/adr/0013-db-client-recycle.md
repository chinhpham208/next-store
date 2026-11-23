# ADR-0013: Dựng lại client Postgres khi `dbQuery` hết giờ

- Trạng thái: Đã chấp nhận (theo hướng sửa đã ghi trong ADR-0011 và ticket NS-73)
- Ngày: 2026-11-23
- Thay thế một phần: [ADR-0011](./0011-db-query-wrapper.md) (gạch đầu dòng "Hết giờ chỉ bỏ chờ… kết nối không bị đóng", ý "mạng nuốt gói", và quy tắc dependency-cruiser `db-internals-stay-in-db`)
- Liên quan: ticket NS-73, audit PR #38 (M1, L2), ticket NS-77 (audit PR #44), [ADR-0010](./0010-app-role-and-preview-data.md) (`statement_timeout` của role app), [ADR-0009](./0009-product-404-in-proxy.md) (ngưỡng 400 ms của proxy, không đổi)

## Bối cảnh

ADR-0011: khi `dbQuery` hết giờ, nó chỉ bỏ chờ. Truy vấn không bị huỷ, kết nối không bị đóng. Treo phía server đã có `statement_timeout = '6s'` của role app (NS-60): server tự huỷ câu lệnh và kết nối về lại pool. Mạng nuốt gói (blackhole) trên kết nối đang mở thì không có gì cứu:

- postgres-js 4.1.1 không có giới hạn đọc cho socket đã kết nối. `connect_timeout` chỉ áp dụng lúc kết nối. `idle_timeout` và `max_lifetime` chỉ đóng kết nối rảnh, mà kết nối đang chờ trả lời thì không rảnh.
- Keepalive TCP (`keep_alive: 60`) không giúp được. Khi còn dữ liệu chưa được ACK, kernel dùng bộ đếm truyền lại (`tcp_retries2`, khoảng 15 phút) chứ không dùng keepalive. Node cũng không cho đặt `TCP_USER_TIMEOUT`.
- Pool đầy (`max = 5`) thì `pick()` xếp truy vấn mới lên một kết nối đang bận (pipeline, tới `max_pipeline = 100`). Vậy là truy vấn mới cũng kẹt sau kết nối chết.
- Đo bằng proxy TCP local (test của ticket này). Ấm 5 kết nối, rồi cho proxy nuốt gói trên các kết nối đó: 8 truy vấn liên tiếp đều hết giờ. Truy vấn 1 → 5 mỗi cái lấy một kết nối rảnh đã chết, từ truy vấn 6 trở đi thì pipeline lên kết nối chết. Audit đo trên app thật: DB khoẻ mà app trả `DB_QUERY_TIMEOUT` hơn 10 phút.
- Hàng đợi của postgres-js không giới hạn (`queue_timeout: 0`): việc đã bị `dbQuery` bỏ vẫn nằm trong hàng và chạy muộn.

Audit PR #38 L2 cũng yêu cầu đảo luật dependency-cruiser. Ngoài `src/db` chỉ được import `src/db/index.ts`, và chỉ `src/db` được chạm driver.

## Các phương án

| Phương án | Ưu | Nhược |
|---|---|---|
| `query_timeout` + `cancel_timeout` của postgres-js 4.1.1 | Có sẵn trong driver. Chỉ huỷ đúng kết nối kẹt | Một giá trị chung cho mọi truy vấn, không theo `timeoutMs` của `dbQuery`. Slot chỉ được nhả sau `query_timeout + cancel_timeout`. Mỗi lần hết giờ mở một kết nối cancel tới pooler của Neon (chưa thử qua PgBouncer). Dựa vào logic nội bộ phức tạp của driver |
| Socket tự viết (`socket` option) có giới hạn đọc | Đúng chỗ hỏng | Phải tự lo TLS và startup, những chỗ `client.ts` đã kiểm kỹ (ADR-0010, NS-36). Socket rảnh hợp lệ cũng bị cắt |
| Dựng lại client sau **N > 1** lần hết giờ liên tiếp | Ít dựng lại hơn khi DB chậm | Mỗi kết nối rảnh đã chết ăn một request: với N > 1, cứ thêm một lần hết giờ là thêm 5 s người dùng chờ. Một lần thành công thì bộ đếm về 0, nên kết nối chết lẫn trong kết nối sống không bao giờ bị dọn |
| **Dựng lại client ngay lần hết giờ đầu tiên (N = 1), mỗi client một lần, client cũ được đóng êm** | Request sau lần hết giờ đầu tiên đã chạy trên client mới. Không phụ thuộc logic nội bộ của driver. Truy vấn còn sống trên client cũ vẫn chạy xong | Một truy vấn chậm hợp lệ (khoá phía server) cũng làm pool kết nối lại: tối đa 5 lần bắt tay TLS. Chấp nhận được vì sau 5 s đó là lỗi với người dùng rồi |

## Quyết định

- Runtime giữ client trong `RuntimeConnection` (`createRuntimeConnection(open)` ở `src/db/client.ts`, lưu ở `globalThis.nextStoreDbRuntime` để hot reload không mở PGlite hai lần). `current` là kết nối cho truy vấn mới. `recycle(stale)` thay `stale` bằng `open()` mới, **chỉ khi** `stale` vẫn là `current`. Vì vậy 5 truy vấn cùng hết giờ trên một client chỉ dựng lại một lần. PGlite (một tiến trình, một handle) không bao giờ bị dựng lại.
- `dbQuery` lấy `current` khi bắt đầu. Khi hết giờ, nó gọi `recycle` với đúng kết nối đó rồi mới ném `DB_QUERY_TIMEOUT`. Giới hạn 5 s, các thông điệp lỗi và API của `@/db` không đổi.
- Client cũ được đóng bằng `end({ timeout: 10 })`: không nhận truy vấn mới, truy vấn đang chạy có 10 s, rồi socket bị huỷ. 10 s là `MAX_QUERY_WAIT_MS` (`src/db/limits.ts`), mức trần của giới hạn `dbQuery` (100 → 10000). Vì vậy không truy vấn nào mà người gọi còn chờ bị cắt ngang. Lỗi của việc đóng bị nuốt, vì không ai chờ nó. Mỗi lần dựng lại in một dòng cảnh báo nội dung cố định (không host, không câu SQL): `database client recycled after a query timeout`.
- `queue_timeout: 10` (cùng `MAX_QUERY_WAIT_MS`): việc chờ slot quá 10 s không còn ai chờ, nên postgres-js bỏ nó (`QUEUE_TIMEOUT`) thay vì chạy muộn.
- `connection` và `db` export từ `@/db/client` là kết nối **đầu tiên**. Chúng dành cho script (`db:seed`, `db:migrate`, không qua `dbQuery`, nên không bị dựng lại) và test (PGlite). Code runtime chỉ đi qua `dbQuery`.
- Treo phía server vẫn do `statement_timeout = '6s'` của role app chặn (ADR-0010).
- dependency-cruiser thay `db-internals-stay-in-db` bằng hai luật:
  - `db-public-api-only`: file ngoài `src/db` (trừ `*.test.ts`) chỉ được import `src/db/index.ts`.
  - `db-drivers-stay-in-db`: chỉ `src/db` được import `postgres`, `@electric-sql/pglite`, `drizzle-orm/postgres-js`, `drizzle-orm/pglite` (áp dụng cả cho test). NS-77 thêm `pg`, `@neondatabase/serverless` và adapter Drizzle của chúng (`drizzle-orm/node-postgres`, `neon-http`, `neon-serverless`). Các gói này chưa cài; có trong danh sách để ai cài vào là bị chặn ngay.

## Hệ quả

- Kiểm bằng `src/db/blackhole.test.ts`. Một proxy TCP local đặt trước PGlite: ấm 5 kết nối, rồi nuốt mọi gói của 5 kết nối đó và không trả lời. Truy vấn đầu tiên hết giờ, mọi truy vấn sau thành công trong giới hạn, và 5 truy vấn cùng hết giờ chỉ dựng lại client một lần. Bỏ lời gọi `recycle` thì test fail (mutation đã chạy, ghi trong PR NS-73).
- Proxy giữ ngưỡng 400 ms của riêng nó (ADR-0009). Ngưỡng 400 ms của proxy không kích recycle. `dbQuery` bên dưới (`products.slug-guard`, giới hạn mặc định 5 s) vẫn chạy nền sau khi proxy bỏ chờ, và vẫn có thể kích recycle ở mốc 5 s (audit PR #44 L3). Không thành storm: ngưỡng vẫn là 5 s, `pendingLookups` gộp các lookup cùng slug, và mỗi client chỉ bị dựng lại một lần. Trên serverless, instance bị đóng băng sau khi proxy trả lời có thể chạy timer 5 s (đã `unref`) lúc được đánh thức, gây một lần recycle thừa. Cái giá chỉ là một lần bắt tay.
- Khi DB treo hẳn (E2E `hung-db`), mỗi lần hết giờ có thể dựng một client mới. Client cũ bị huỷ sau 10 s.
- **Client trẻ hơn 2 s không bị dựng lại** (`MIN_RECYCLE_AGE_MS`, NS-77, audit PR #44 L2). Nếu không có sàn này, `DB_QUERY_TIMEOUT_MS` nhỏ (100–300 ms) gặp DB chậm sẽ dựng một client mỗi 100–300 ms: tới khoảng 30–100 client sống cùng lúc, 150–500 socket mỗi instance, mỗi socket một lần bắt tay TLS + SCRAM. Có sàn thì tối đa 1 + 10 / 2 = 6 client (30 socket). Lần hết giờ sau, khi client đã đủ tuổi, sẽ dựng lại. Tuổi đo bằng đồng hồ đơn điệu (`performance.now()`), để đồng hồ hệ thống lùi không chặn recycle.
  - Phương án bị loại: nâng sàn của `DB_QUERY_TIMEOUT_MS`. Muốn chặn ngang bằng thì sàn phải khoảng 2000 ms. Giá trị 100–1999 đang hợp lệ sẽ thành không hợp lệ và âm thầm về 5000 (chỉ còn một dòng cảnh báo), và giới hạn ngắn hợp lệ cho đường đọc nhanh cũng bị cấm. Sàn theo tuổi client thì chặn số client bất kể giới hạn là bao nhiêu.
  - Sàn "bằng timeout" không có tác dụng: một truy vấn phải bắt đầu trên client rồi mới hết giờ, nên client luôn đã sống ít nhất bằng giới hạn. Với giới hạn mặc định 5000 ms, sàn 2 s không bao giờ chặn.
  - Cái giá: với giới hạn dưới 2 s, client vừa dựng mà bị nuốt gói sẽ cho thêm vài request hết giờ, cho tới khi nó đủ 2 s.
- **`run` chỉ được là một câu lệnh. Nhiều câu thì dùng `transaction`** (NS-77, audit PR #44 L1). Giả sử request B đã chạy xong câu 1 trên client cũ, rồi request A hết giờ và dựng lại client (`end()`). Lúc đó câu 2 của B nhận `CONNECTION_ENDED`, dù DB khoẻ. Ràng buộc nằm ở kiểu:
  - `run: (client) => DbStatement<T>`, tức `PromiseLike<T> & SQLWrapper`. Builder của Drizzle (select, insert, update, delete, execute, `$count`) có `getSQL`. Hàm `async` và `Promise.all` thì không, nên không typecheck.
  - Nhiều câu thì truyền `transaction: (tx) => …`. `dbQuery` gọi `db.transaction` trên client hiện tại. Transaction lấy lease ngay từ `BEGIN`, giữ tới `COMMIT`, nên recycle chen giữa không đụng tới. Transaction bắt đầu sau `end()` thì nhận `CONNECTION_ENDED` ở `BEGIN`, như một câu lệnh đơn, và chưa ghi gì.
  - `run` và `transaction` loại trừ nhau.
  - `src/db/query.test.ts` khoá điều này bằng `@ts-expect-error`. Nếu nới kiểu, `npm run typecheck` báo lỗi.
  - Phương án bị loại: thử lại một lần khi gặp `CONNECTION_ENDED`. Với câu ghi (M4), việc thử lại có thể ghi hai lần, và `dbQuery` không biết câu nào là đọc.
- **Client cũ tự nhả socket kể cả khi FIN bị nuốt** (audit PR #44 L4). `src/db/blackhole.test.ts` có một bridge `allowHalfOpen: true`, không bao giờ trả FIN. Client cũ có một kết nối rảnh (đã gửi Terminate + FIN) và một kết nối đang chờ trả lời. Sau 100 ms cả hai socket vẫn mở: không có FIN trả về, nên chỉ `end()` thì giữ chúng mãi. Hết `retireTimeoutSeconds` (test rút xuống 0,3 s qua tham số của `createRuntimeConnection`, runtime giữ 10 s) thì cả hai bị huỷ, và truy vấn kẹt nhận `CONNECTION_DESTROYED`. Bỏ `timeout` khỏi `end()` thì test fail.
- **Runtime phải đi qua host `-pooler` của Neon** (NS-77, audit PR #44 N1).
  - Recycle không giảm tải. Trong 10 s, mỗi instance có tới khoảng 15 socket (client cũ còn chạy tới `statement_timeout` 6 s, client mới mở thêm 5). Qua PgBouncer (transaction mode, `max_client_conn` 10 000) thì socket client thêm là rẻ: kết nối server vẫn bị pooler chặn, phần dư chờ ở pooler. Qua host trực tiếp thì 15 × số instance chạm 105 `max_connections` của ứng dụng (0.25 CU) khá nhanh.
  - `resolveDatabaseTarget` trên Vercel, sau guard endpoint, từ chối host Neon (`*.neon.tech`) mà nhãn đầu không có hậu tố `-pooler`. Thông điệp là chuỗi cố định, không in host, endpoint hay mật khẩu, theo cùng cách với các guard endpoint và `DB_LOG`. Ngoài Vercel và với host không phải Neon thì không kiểm.
  - `db:migrate` không bị chặn. Nó dùng `DATABASE_URL_UNPOOLED` (endpoint trực tiếp, DDL, `max: 1`), nên `resolveMigrationTarget` gọi `resolveDatabaseTarget(…, { requirePooler: false })`, nhưng chỉ khi URL đó thật sự được dùng. Thiếu `DATABASE_URL_UNPOOLED` thì migrate chạy trên `DATABASE_URL`, và URL này vẫn phải là pooler. Mặc định là bắt buộc, nên một nơi gọi mới không thể vô tình bỏ qua.
- Còn hở: role chủ (đang dùng trong cửa sổ expand của ADR-0010, `APP_ROLE_REQUIRED_ON_VERCEL = false`) không có `statement_timeout`. Bước contract của M3 Task 5 bắt buộc role app nên chỗ hở này đóng lại. Ghi dữ liệu bị hết giờ vẫn là "không biết đã ghi hay chưa" (ADR-0011, M4).
