# ADR-0010: Role app cho runtime và nhánh cha không có dữ liệu khách cho preview

- Trạng thái: Đề xuất — chờ chủ dự án duyệt
- Ngày: 2026-11-22
- Bổ sung: [ADR-0007](./0007-dev-neon-branch.md) (hệ quả 2: "Rủi ro này và việc tách role / `preview-base` thuộc NS-36")
- Liên quan: ticket NS-36 (M3 Task 3), NS-53 (dọn nhánh Neon preview), audit PR #6 (mục M2, M3)

## Bối cảnh

Audit PR #6 nêu hai vấn đề về dữ liệu và quyền DB:

- **M2:** preview và production dùng chung một database Neon, nên preview có thể đọc và ghi dữ liệu khách thật. Ở ADR-0007, nhánh Neon của `develop` và của mỗi preview được fork từ `main` lúc tạo, nên dữ liệu của chúng là bản sao của production tại thời điểm đó. Role chạy ứng dụng cũng là role chủ mà tích hợp Neon inject, tức cùng mật khẩu với production.
- **M3:** domain Dev `next-store-dev-ginpham.vercel.app` có cần được bảo vệ hay không. Dữ kiện 6 bên dưới xác nhận domain đang được bảo vệ bằng đăng nhập Vercel.

Việc chia role và tách dữ liệu preview khỏi production phụ thuộc vào những gì tích hợp Neon ↔ Vercel đang cài cho phép. Các dữ kiện dưới đây được Orchestrator thu thập ngày 2026-11-22 bằng thao tác chỉ đọc, với sự đồng ý của chủ dự án ở Cổng 1.

ADR-0007 vẫn đúng ở phần chọn Neon branch do tích hợp tạo cho Dev. ADR này bổ sung: runtime dùng role riêng, và nhánh cha của preview không chứa dữ liệu khách.

## Dữ kiện khảo sát

| # | Dữ kiện | Màn hình nguồn |
|---|---|---|
| 1 | Tích hợp cài từ Vercel Marketplace (Vercel → Integrations → Neon, installation `icfg_6lliwpCCNSyhjBAD54FOIIjW`). Resource `next-store-db` = Neon project `frosty-queen-67078672`, region `aws-ap-southeast-1` / `sin1`. Neon organization "Vercel: chinhpham208's projects" (`org-rapid-morning-11290345`, gói Free); tài khoản còn một organization riêng "Gin" (Free). Gói Free ở cấp installation: tối đa 100 project, 10 nhánh mỗi project. | Vercel → Integrations → Neon |
| 2 | Kết nối next-store, prefix `DATABASE`, environment Preview + Production, "Actions: Neon" (deployment branching cho Preview, bắt buộc). **Không** thấy tuỳ chọn chọn nhánh cha của preview, chọn role được inject, hay tự xoá nhánh khi nhánh git bị xoá. Có "Allowed Environments" (All / Production only) và "Rotate Secrets". | Màn hình resource Neon trong Vercel, Settings / Projects |
| 3 | Resource Neon thứ hai: gói cho tối đa 100 project; nút "Create Database" và "Connect to Project" chọn environment theo từng kết nối, nên B1 có vẻ làm được. **Chưa thử tạo.** | Neon console (gói, tổ chức) và luồng "Connect to Project" của Vercel. Ghi nhận không nêu màn hình cụ thể; Task 5 xác minh tại chỗ. |
| 4 | Biến DB trên Vercel (chỉ tên và phạm vi): `DATABASE_URL`, `DATABASE_URL_UNPOOLED` và 14 biến `DATABASE_PG*` / `POSTGRES_*` ở phạm vi Preview + Production (sensitive). Còn một `DATABASE_URL` tĩnh ở phạm vi Preview, giá trị không đọc được, nhiều khả năng trỏ `main`; lớp chặn `NEON_PRODUCTION_ENDPOINT` đang bảo vệ. `NEON_PRODUCTION_ENDPOINT` là biến thường cho cả 3 environment. | Danh sách biến môi trường trên Vercel (chỉ tên và phạm vi) |
| 5 | Neon: nhánh `main` (mặc định, chưa protected); `preview/develop`, `preview/NS-58-expand-contract`, `preview/NS-3-plan-m3` (đều có nhánh cha là `main`). Role: chỉ có `neondb_owner`. API key: hộp thoại "Create new API key" có Key scope "Org-wide" / "Project-scoped" (đã mở và Cancel, không tạo). Hiện có 0 key. | Neon console: danh sách nhánh, danh sách role, hộp thoại "Create new API key" |
| 6 | Mở `next-store-dev-ginpham.vercel.app` không cookie: redirect (opaqueredirect) sang đăng nhập Vercel, tức domain được bảo vệ. Project có `ssoProtection = all_except_custom_domains`. | Cửa sổ ẩn danh, trình duyệt; cài đặt project Vercel |

## Các phương án

### Role cho runtime

| Phương án | Ưu | Nhược |
|---|---|---|
| **A. Giữ tích hợp inject role chủ; runtime, prerender và `db:seed` dùng role `next_store_app` lấy từ `DATABASE_APP_USER` / `DATABASE_APP_PASSWORD`** | Không đụng cấu hình đang chạy; không phụ thuộc tính năng chưa kiểm được | Thiếu biến thì mặc định chạy bằng role chủ (phải chặn bằng fail closed, xem Quyết định A); mật khẩu role chủ vẫn nằm trong biến môi trường của function |
| B. Đổi tích hợp để inject thẳng role app | Không cần biến mới | Chưa kiểm được tích hợp có làm vậy không; đã hai lần hỏng vì cài đặt console |

### Nhánh cha của preview ("preview-base")

| Phương án | Điều kiện | Ưu | Nhược |
|---|---|---|---|
| **B1. Database Neon riêng cho Preview + Development** — một resource Neon thứ hai nối vào project Vercel chỉ cho hai environment đó; nhánh mặc định của nó chính là "preview-base" (schema + seed) | Tích hợp cho nối nhiều resource vào một project theo từng environment mà không ai phải chép mật khẩu production | Preview không bao giờ là bản sao của production; mật khẩu khác hẳn production (đóng mục M2 của audit PR #6); hạn mức 10 nhánh tách riêng; API key của Task 16 không chạm được production | Thêm một resource phải theo dõi; phải gỡ kết nối Preview / Development của resource production |
| A. Nhánh `preview-base` trong cùng project — tạo từ `main` ngay bây giờ (lúc `main` chỉ có danh mục và sản phẩm), tích hợp đặt làm nhánh cha của preview | Tích hợp cho chọn nhánh cha của preview | Ít thay đổi nhất | Cùng project với production: API key dọn nhánh đọc được chuỗi kết nối production; mật khẩu role giống production trừ khi đặt lại riêng trên `preview-base`; chiếm 1 trong 10 nhánh |
| B2. Vẫn fork từ `main`, bước build preview xoá dữ liệu khách trước khi seed | Không cần gì | Không đổi hạ tầng | Dữ liệu khách vẫn được sao sang nhánh preview rồi mới bị xoá (còn trong lịch sử nhánh); một build hỏng giữa chừng để lại dữ liệu. **Không dùng một mình** |

## Quyết định

### A. Role cho runtime

- Tích hợp Neon **giữ nguyên**: vẫn inject `DATABASE_URL` / `DATABASE_URL_UNPOOLED` của role chủ. `db:migrate` tiếp tục dùng chuỗi này.
- Runtime, prerender và `db:seed` kết nối bằng role **`next_store_app`** (chỉ `SELECT / INSERT / UPDATE / DELETE` trên bảng, `USAGE / SELECT` trên sequence của schema `public`). Host, cổng và database lấy từ URL được inject; user và mật khẩu lấy từ `DATABASE_APP_USER` và `DATABASE_APP_PASSWORD`, do **chủ dự án** đặt trên Vercel.
- Chủ dự án xác nhận ở Cổng 1 (quyết định 2): giữ tích hợp như hiện tại. Biến `DATABASE_APP_*` là **bắt buộc trên Vercel sau khi đã xác minh** (Task 5). Thiếu biến thì build hoặc runtime trên Vercel phải lỗi, không được lặng lẽ dùng role chủ.
- Lý do không đổi role mà tích hợp inject: không đụng vào cấu hình đang chạy ổn, và không phụ thuộc tính năng chưa kiểm được.
- Đánh đổi: mật khẩu role chủ vẫn nằm trong biến môi trường của function (Vercel không tách biến build và runtime). Role app chặn được lỗi ở tầng ứng dụng (SQL injection, truy vấn sai xoá hoặc đổi schema), **không** chặn được kẻ đã đọc được biến môi trường.

### B. Nhánh cha của preview: B1, chờ xác nhận tại chỗ

**Quyết định: B1, với điều kiện Task 5 xác nhận tại chỗ.** Quy tắc chọn theo dữ kiện: làm được B1 → B1; không thì A; cả hai không được → dừng, hỏi chủ dự án. Dữ kiện 3 cho thấy B1 có vẻ làm được, nhưng chưa thử. Quyết định chỉ có hiệu lực khi Task 5 xác nhận đủ hai bước sau, **không ai chép mật khẩu production**:

1. Tạo resource Neon thứ hai và nối vào project Vercel chỉ cho environment Preview + Development. Nhánh mặc định của nó là "preview-base".
2. Sửa kết nối của resource 1 (`next-store-db`) thành Production only.

Nếu bước nào không làm được, hoặc phải chép mật khẩu để làm, thì **dùng phương án A** và Task 5 phải sửa ADR này (ghi lại phương án đã dùng và lý do).

## Hệ quả

- **Thứ tự áp dụng (Task 5):**
  1. Task 4 đã merge. Chủ dự án tạo role `next_store_app` trên database production và đặt mật khẩu; chạy `scripts/sql/app-role.sql` bằng role mà `db:migrate` dùng; chạy `scripts/sql/app-role-check.sql`, mọi cột boolean phải `false`, `can_dml` phải `true`.
  2. Chủ dự án đặt `DATABASE_APP_USER` / `DATABASE_APP_PASSWORD` trên Vercel cho Production và xác minh bản deploy production chạy bằng role app (dòng `user=next_store_app` trong log build).
  3. Tạo resource Neon thứ hai cho Preview + Development (B1 bước 1), rồi tạo role `next_store_app` trên database của nó, cũng do chủ dự án đặt mật khẩu, và chạy lại hai script SQL.
  4. Sửa resource 1 thành Production only (B1 bước 2). Sau đó mới bật bắt buộc role app cho Preview.
  5. Chỉ sau khi xác minh xong mới đổi lỗi thiếu biến trên Vercel thành bắt buộc. Task 16 (NS-53) chỉ được cấp API key sau bước này.
- **`preview-base` không bao giờ được "reset from parent".** Nhánh cha không có nhánh cha; nếu cần làm lại thì phải tạo lại từ schema và seed, không sao chép từ nhánh khác.
- **Schema của nhánh cha có thể cũ hơn `develop`.** Mỗi preview tự chạy migrate phần còn thiếu khi build. Vì vậy migration của preview phải chạy được trên schema cũ hơn `develop` một vài bước.
- **Khi nào tạo lại nhánh cha:** chỉ khi schema của `preview-base` lệch quá xa `develop` mà migrate không bù được, hoặc seed hỏng. Luôn cần chủ dự án đồng ý; không làm tự động.
- **Đổi mật khẩu role app:** chủ dự án đổi mật khẩu trên database đó, cập nhật `DATABASE_APP_PASSWORD` trên Vercel cho đúng environment, rồi deploy lại. Không ai cầm mật khẩu trong chat hay trong repo.
- **`DATABASE_URL` tĩnh ở phạm vi Preview biến mất** khi resource 1 chỉ còn Production. Lớp chặn `NEON_PRODUCTION_ENDPOINT` vẫn giữ nguyên làm lớp dự phòng.
- **Dev (`develop`)** cũng nằm trên resource 2 sau B1. Quy tắc không xoá `preview/develop` và nhánh cha vẫn áp dụng.
- **NS-53:** API key dọn nhánh (Task 16) chỉ dùng loại **project-scoped**, gắn với project Neon của resource 2 (preview). Key này không đọc được chuỗi kết nối production. Dữ kiện 5 cho thấy loại key project-scoped có sẵn.
- ADR-0007 giữ nguyên, chỉ thêm dòng "bổ sung bởi ADR-0010" ở trạng thái.
