# ADR-0013: Dựng lại client Postgres khi `dbQuery` hết giờ

- Trạng thái: Đã chấp nhận (theo hướng sửa đã ghi trong ADR-0011 và ticket NS-73)
- Ngày: 2026-11-23
- Thay thế một phần: [ADR-0011](./0011-db-query-wrapper.md) (gạch đầu dòng "Hết giờ chỉ bỏ chờ… kết nối không bị đóng", ý "mạng nuốt gói", và quy tắc dependency-cruiser `db-internals-stay-in-db`)
- Liên quan: ticket NS-73, audit PR #38 (M1, L2), [ADR-0010](./0010-app-role-and-preview-data.md) (`statement_timeout` của role app), [ADR-0009](./0009-product-404-in-proxy.md) (ngưỡng 400 ms của proxy, không đổi)

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
  - `db-drivers-stay-in-db`: chỉ `src/db` được import `postgres`, `@electric-sql/pglite`, `drizzle-orm/postgres-js`, `drizzle-orm/pglite` (áp dụng cả cho test).

## Hệ quả

- Kiểm bằng `src/db/blackhole.test.ts`. Một proxy TCP local đặt trước PGlite: ấm 5 kết nối, rồi nuốt mọi gói của 5 kết nối đó và không trả lời. Truy vấn đầu tiên hết giờ, mọi truy vấn sau thành công trong giới hạn, và 5 truy vấn cùng hết giờ chỉ dựng lại client một lần. Bỏ lời gọi `recycle` thì test fail (mutation đã chạy, ghi trong PR NS-73).
- Proxy giữ ngưỡng 400 ms của riêng nó (ADR-0009). `products.slug-guard` hết giờ ở 400 ms là của proxy, không phải của `dbQuery`, nên không dựng lại client. Chỉ hết giờ 5 s của `dbQuery` mới dựng lại.
- Khi DB treo hẳn (E2E `hung-db`), mỗi lần hết giờ dựng một client mới. Client cũ bị huỷ sau 10 s, nên số client tồn tại cùng lúc bị chặn theo số request trong 10 s.
- Còn hở: role chủ (đang dùng trong cửa sổ expand của ADR-0010, `APP_ROLE_REQUIRED_ON_VERCEL = false`) không có `statement_timeout`. Bước contract của M3 Task 5 bắt buộc role app nên chỗ hở này đóng lại. Ghi dữ liệu bị hết giờ vẫn là "không biết đã ghi hay chưa" (ADR-0011, M4).
