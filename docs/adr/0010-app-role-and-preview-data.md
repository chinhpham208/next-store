# ADR-0010: Role app cho runtime và nhánh cha không có dữ liệu khách cho preview

- Trạng thái: Đề xuất — chờ chủ dự án duyệt
- Ngày: 2026-11-22
- Bổ sung: [ADR-0007](./0007-dev-neon-branch.md) (hệ quả 2: "Rủi ro này và việc tách role / `preview-base` thuộc NS-36")
- Liên quan: ticket NS-36 (M3 Task 3), NS-53 (dọn nhánh Neon preview), audit PR #6 (mục M1, M2, M3)

## Bối cảnh

Audit PR #6 nêu các vấn đề về dữ liệu và quyền DB:

- **audit PR #6 M1:** biến `DATABASE_URL` tĩnh ở phạm vi Preview có thể đang trỏ `main` (production).
- **audit PR #6 M2:** preview và production dùng chung một database Neon, nên preview có thể đọc và ghi dữ liệu khách thật. Nhánh Neon của `develop` và của mỗi preview được fork từ `main` lúc tạo, nên dữ liệu của chúng là bản sao của production tại thời điểm đó. Role chạy ứng dụng là role chủ mà tích hợp Neon inject, cùng mật khẩu với production.
- **audit PR #6 M3:** domain Dev `next-store-dev-ginpham.vercel.app` có cần được bảo vệ hay không. Dữ kiện 6 xác nhận domain đang được bảo vệ bằng đăng nhập Vercel.

Các nhãn `audit ADR-0010 …` trong ADR này trỏ tới mục của audit PR #34 (vòng audit trên chính ADR này), không trỏ tới audit PR #6.

Việc chia role và tách dữ liệu preview khỏi production phụ thuộc vào những gì tích hợp Neon ↔ Vercel cho phép. Các dữ kiện dưới đây được Orchestrator thu thập ngày 2026-11-22 bằng thao tác chỉ đọc, với sự đồng ý của chủ dự án ở Cổng 1.

ADR-0007 vẫn đúng ở phần chọn Neon branch do tích hợp tạo cho Dev. ADR này bổ sung: runtime dùng role riêng, nhánh cha của preview không chứa dữ liệu khách, và có một ngoại lệ một lần cho `preview/develop` cũ (xem Quyết định B).

## Dữ kiện khảo sát

| # | Dữ kiện | Màn hình nguồn |
|---|---|---|
| 1 | Tích hợp cài từ Vercel Marketplace (Vercel → Integrations → Neon, installation `icfg_6lliwpCCNSyhjBAD54FOIIjW`). Resource `next-store-db` = Neon project `frosty-queen-67078672`, region `aws-ap-southeast-1` / `sin1`. Neon organization "Vercel: chinhpham208's projects" (`org-rapid-morning-11290345`, gói Free); tài khoản còn một organization riêng "Gin" (Free). Gói Free ở cấp installation: tối đa 100 project, 10 nhánh mỗi project. | Vercel → Integrations → Neon |
| 2 | Kết nối next-store, prefix `DATABASE`, environment Preview + Production, "Actions: Neon" (deployment branching cho Preview, bắt buộc). **Không** thấy tuỳ chọn chọn nhánh cha của preview, chọn role được inject, hay tự xoá nhánh khi nhánh git bị xoá. Có "Allowed Environments" (All / Production only) và "Rotate Secrets". | Màn hình resource Neon trong Vercel, Settings / Projects |
| 3 | Resource Neon thứ hai: gói cho tối đa 100 project; nút "Create Database" và "Connect to Project" chọn environment theo từng kết nối, nên B1 có vẻ làm được. **Chưa thử tạo.** | Neon console (gói, tổ chức) và luồng "Connect to Project" của Vercel. Ghi nhận không nêu màn hình cụ thể; Task 5 xác minh tại chỗ. |
| 4 | Biến DB trên Vercel (chỉ tên và phạm vi): `DATABASE_URL`, `DATABASE_URL_UNPOOLED` và 14 biến `DATABASE_PG*` / `POSTGRES_*` ở phạm vi Preview + Production (sensitive). Còn một `DATABASE_URL` **tĩnh** ở phạm vi Preview, giá trị không đọc được, nhiều khả năng trỏ `main`; lớp chặn `NEON_PRODUCTION_ENDPOINT` đang bảo vệ. `NEON_PRODUCTION_ENDPOINT` là biến thường cho cả 3 environment. | Danh sách biến môi trường trên Vercel (chỉ tên và phạm vi) |
| 5 | Neon: nhánh `main` (mặc định, chưa protected); `preview/develop`, `preview/NS-58-expand-contract`, `preview/NS-3-plan-m3` (đều có nhánh cha là `main`). Role: chỉ có `neondb_owner`. API key: hộp thoại "Create new API key" có Key scope "Org-wide" / "Project-scoped" (đã mở và Cancel, không tạo). Hiện có 0 key. | Neon console: danh sách nhánh, danh sách role, hộp thoại "Create new API key" |
| 6 | Mở `next-store-dev-ginpham.vercel.app` không cookie: redirect (opaqueredirect) sang đăng nhập Vercel, tức domain được bảo vệ. Project có `ssoProtection = all_except_custom_domains`. | Cửa sổ ẩn danh, trình duyệt; cài đặt project Vercel |

## Các phương án

### Role cho runtime

| Phương án | Ưu | Nhược |
|---|---|---|
| **A. Giữ tích hợp inject role chủ; runtime, prerender và `db:seed` dùng role `next_store_app` lấy từ `DATABASE_APP_USER` / `DATABASE_APP_PASSWORD`** | Không đụng cấu hình đang chạy ổn; không phụ thuộc tính năng chưa kiểm được | Thiếu biến thì mặc định chạy bằng role chủ (chặn bằng fail closed, xem Quyết định A); mật khẩu role chủ vẫn nằm trong biến môi trường của function |
| B. Đổi tích hợp để inject thẳng role app | Không cần biến mới | Chưa kiểm được tích hợp có làm vậy không; đã hai lần hỏng vì cài đặt console |

### Nhánh cha của preview ("preview-base")

| Phương án | Điều kiện | Ưu | Nhược |
|---|---|---|---|
| **B1. Database Neon riêng cho Preview** — một resource Neon thứ hai (resource 2) nối vào project Vercel chỉ cho environment Preview; nhánh mặc định của nó là nhánh cha ("preview-base") | Tích hợp cho nối nhiều resource vào một project theo từng environment mà không ai phải chép mật khẩu production | Preview không bao giờ là bản sao của production; mật khẩu khác hẳn production (sau khi đóng audit PR #6 M2, xem Quyết định B); hạn mức 10 nhánh tách riêng; API key của Task 16 không chạm được production | Thêm một resource phải theo dõi; phải gỡ kết nối Preview của resource 1 (resource 1 chỉ còn Production) |
| A. Nhánh `preview-base` trong cùng project — tạo từ `main`, tích hợp đặt làm nhánh cha của preview | Tích hợp cho chọn nhánh cha của preview | Ít thay đổi nhất | **Không khả thi theo dữ kiện 2**: tích hợp không có tuỳ chọn chọn nhánh cha. Ngoài ra cùng project với production: API key dọn nhánh đọc được chuỗi kết nối production |
| B2. Vẫn fork từ `main`, bước build preview xoá dữ liệu khách trước khi seed | Không cần gì | Không đổi hạ tầng | Dữ liệu khách vẫn được sao sang nhánh preview rồi mới bị xoá; một build hỏng giữa chừng để lại dữ liệu. **Không dùng một mình** |

## Quyết định

### A. Role cho runtime

- Tích hợp Neon **giữ nguyên**: vẫn inject `DATABASE_URL` / `DATABASE_URL_UNPOOLED` của role chủ. `db:migrate` tiếp tục dùng chuỗi này.
- Runtime, prerender và `db:seed` kết nối bằng role **`next_store_app`** (chỉ `SELECT / INSERT / UPDATE / DELETE` trên bảng, `USAGE / SELECT` trên sequence của schema `public`). Host, cổng và database lấy từ URL được inject; user và mật khẩu lấy từ `DATABASE_APP_USER` và `DATABASE_APP_PASSWORD`, do **chủ dự án** đặt trên Vercel.
- Chủ dự án xác nhận ở Cổng 1 (quyết định 2): giữ tích hợp như hiện tại. Biến `DATABASE_APP_*` là **bắt buộc trên Vercel sau khi đã xác minh**. Thiếu biến thì build hoặc runtime trên Vercel phải lỗi, không được lặng lẽ dùng role chủ.
- Việc bắt buộc role app là **một thay đổi code** áp dụng cho mọi `VERCEL_ENV` (production, preview, development); không bật riêng cho từng môi trường.
- Đánh đổi: mật khẩu role chủ vẫn nằm trong biến môi trường của function (Vercel không tách biến build và runtime).
- Phạm vi bảo vệ của role app (audit ADR-0010 M7): role này **chặn** `DROP`, `ALTER`, `TRUNCATE`, tạo đối tượng mới và leo quyền (vì không phải chủ bảng và không có `CREATE` trên schema). Role này **không chặn** đọc, sửa, xoá hàng loạt qua DML (`SELECT / UPDATE / DELETE` không điều kiện trên mọi bảng), nên SQL injection vẫn đọc và xoá được dữ liệu khách. Và không chặn kẻ đã đọc được biến môi trường.
- Bảng và sequence do migration sau này tạo được cấp quyền cho role app tự động nhờ `ALTER DEFAULT PRIVILEGES` (audit ADR-0010 L1); migration không tự `GRANT`. Script `app-role.sql` **phải chạy bằng đúng role `db:migrate` dùng** (role chủ), vì default privileges gắn với role tạo đối tượng; chạy bằng role khác thì bảng do migration tạo sẽ không tự cấp quyền cho role app.

### B. Nhánh cha của preview: B1, chờ xác nhận tại chỗ

**Quyết định: B1, với điều kiện Task 5 xác nhận tại chỗ.** Quy tắc chọn theo dữ kiện:

- B1 làm được → B1.
- B1 không làm được → **dừng, hỏi chủ dự án.** Phương án A không khả thi theo dữ kiện 2 (không có tuỳ chọn chọn nhánh cha). Không rẽ sang A và không tự chọn phương án khác.

Quyết định chỉ có hiệu lực khi Task 5 xác nhận đủ hai bước sau, **không ai chép mật khẩu production**:

1. Tạo resource 2 và nối vào project Vercel chỉ cho environment Preview.
2. Sửa kết nối của resource 1 (`next-store-db`) thành Production only (và xoá biến tĩnh, xem Thứ tự áp dụng bước 3).

**Quyết định của Orchestrator (đáp ứng audit ADR-0010, ghi lại 2026-11-22):**

- **audit ADR-0010 M1:** phương án A không khả thi (dữ kiện 2). Nếu B1 không làm được thì dừng và hỏi chủ dự án.
- **audit ADR-0010 M3:** nhánh cha của resource 2 **chỉ có role và default privileges, không có bảng**. Mỗi preview tự migrate từ đầu rồi seed (xem Thứ tự áp dụng). Lệnh `GRANT … ON ALL TABLES` trên nhánh cha là no-op; `app-role-check.sql` chạy trên `preview/develop`, không chạy trên nhánh cha. Plan Task 5 Step 4 (`count(*) = 24` trên nhánh cha) phải đổi thành kiểm trên `preview/develop`.
- **audit ADR-0010 L2:** không dùng phạm vi Development (không có `vercel dev`). Biến `DATABASE_APP_*` đặt ở phạm vi **Preview** (và Production cho resource 1), kiểu **Sensitive**. Không đặt biến nào ở phạm vi Development.
- **audit ADR-0010 L4:** `main` không được bảo vệ trên gói Free. Chấp nhận, ghi nhận.

**Ngoại lệ một lần của ADR-0007 (quyết định 4 của chủ dự án):** `preview/develop` hiện có trong project production là bản sao của `main`. Chủ dự án đồng ý **xoá nhánh này một lần** để dọn project production (Thứ tự áp dụng bước 6). Ngoại lệ này chỉ áp dụng cho nhánh cũ đó. Quy tắc "không xoá `preview/develop`" của ADR-0007 vẫn áp dụng cho nhánh `preview/develop` **mới ở resource 2**.

## Thứ tự áp dụng (Task 5)

Thứ tự này **thay thế plan M3 Task 5 Step 1–4**. Planner phải cập nhật `docs/plans/M3.md` trước khi Task 5 bắt đầu.

Mỗi bước ghi rõ người thực hiện. Không agent nào nhìn thấy, gõ hay chép mật khẩu; mật khẩu chỉ do chủ dự án đặt trong Neon console và Vercel.

1. **Chủ dự án** (Neon console, SQL Editor, role chủ): trên nhánh `main` của resource 1, tạo role `next_store_app` với mật khẩu do chủ dự án đặt; chạy `scripts/sql/app-role.sql` bằng role `db:migrate` (role chủ); chạy `scripts/sql/app-role-check.sql`, mọi cột boolean `false`, `can_dml` `true`. Điều kiện: Task 4 đã release lên nhánh `production` (không chỉ đã merge vào `develop`).
2. **Chủ dự án** đặt `DATABASE_APP_USER` / `DATABASE_APP_PASSWORD` ở phạm vi **Production** (Sensitive), redeploy production. **Orchestrator** xác minh bằng smoke test trên production và truy vấn `pg_stat_activity` (qua console, không đọc chuỗi kết nối) cho thấy kết nối của `next_store_app`. Lưu ý: production bỏ qua `db:seed`, nên log build không có dòng `user=next_store_app`; bằng chứng là smoke và `pg_stat_activity`.
3. **Chủ dự án** thông báo dừng merge. Chủ dự án **xoá** biến `DATABASE_URL` tĩnh ở phạm vi Preview (xoá không cần đọc giá trị; audit ADR-0010 H1), rồi sửa resource 1 thành Production only. Điều kiện xong: danh sách biến trên Vercel (tên và phạm vi) không còn biến `DATABASE*` / `POSTGRES*` nào của resource 1 ở phạm vi Preview hay Development. Từ bước này preview không build được (code báo `DATABASE_URL is required on Vercel`); đây là hành vi fail closed có chủ đích.
4. **Chủ dự án** tạo resource 2 **cùng region `aws-ap-southeast-1` (`sin1`)** (audit ADR-0010 M6). Resource 2 dùng prefix `DATABASE`, bật deployment branching cho Preview (Actions: Neon). Ghi lại tên nhánh mặc định thực tế (audit ADR-0010 L3). Nếu "Create Database" bắt nối ngay, xoá mọi nhánh con đã tạo trước khi role tồn tại (nhánh con không có role). Tạo role `next_store_app` trên nhánh mặc định đó với mật khẩu **khác** production; chạy `app-role.sql` (nhánh cha chưa có bảng, chỉ đặt default privileges). Đặt `DATABASE_APP_USER` / `DATABASE_APP_PASSWORD` ở phạm vi **Preview** (Sensitive), giá trị khác production. **Rồi mới** nối resource 2 vào Preview.
5. **Chủ dự án** redeploy `develop`. **Orchestrator** kiểm log: `db:migrate … user=<role chủ>`, `db:seed … user=next_store_app`; host thuộc project của resource 2 và khác `NEON_PRODUCTION_ENDPOINT`. Chạy `app-role-check.sql` trên `preview/develop` mới (có bảng, `count(*)` và cột boolean như bước 1). Dừng merge được gỡ sau khi có bằng chứng bước 5.
6. **Chủ dự án** bấm "Rotate Secrets" của resource 1 (có sẵn trong Vercel, không cần chép mật khẩu). Giả định: Rotate Secrets đặt lại mật khẩu của `next_store_app`. Chủ dự án sẵn sàng đặt lại mật khẩu role đó, cập nhật `DATABASE_APP_PASSWORD` ở Production và redeploy ngay (theo quy trình đổi mật khẩu production trong Hệ quả). Sau đó redeploy production. **Chủ dự án xoá mọi nhánh `preview/*` trong project production** (kể cả `preview/develop` cũ, theo ngoại lệ một lần ở trên). Điều kiện xong: project production chỉ còn `main`.
7. **Orchestrator** merge PR "contract" sau khi chủ dự án đồng ý, khi đã có bằng chứng bước 2 và 5. Chỉ sau đó **chủ dự án** cấp API key project-scoped cho project của resource 2 để dùng cho Task 16. Key này không được gắn project production.

Ghi chú về cửa sổ thời gian: giữa bước 2 và bước 6, production chạy bằng role app nhưng role chủ còn dùng được cho `db:migrate`; giữa bước 3 và bước 5, preview đứng yên. Không có bước nào làm preview fork production sau bước 3.

## Rollback

- **Trước PR "contract":** xoá `DATABASE_APP_*` là quay về role chủ (code chưa bắt buộc role app).
- **Sau PR "contract":** không xoá biến để rollback. Phải **revert PR đó**; nếu không, thiếu biến là lỗi build.
- **B1 hỏng giữa chừng:** **không bao giờ** nối lại resource 1 vào Preview để chữa. Preview đứng yên (fail closed) cho tới khi sửa xong.
- **Điểm không quay lại:** "Rotate Secrets" của resource 1 (bước 6) và xoá các nhánh `preview/*` cũ (bước 6). Không khôi phục được mật khẩu cũ và nhánh đã xoá.
- **Gián đoạn ngắn khi đổi mật khẩu production:** xem Hệ quả.

## Hệ quả

- **Dừng và hỏi (audit ADR-0010 M1):** nếu bước 4 không làm được (không nối được resource 2 cho Preview hoặc phải chép mật khẩu), Task 5 dừng và hỏi chủ dự án. Không tự chuyển sang phương án khác.
- **Nhánh cha không có bảng (audit ADR-0010 M3):** nhánh cha của resource 2 chỉ có role và default privileges. Mỗi preview migrate từ đầu rồi seed chính nó (`db:migrate` và `db:seed` chạy trên nhánh con `preview/<nhánh git>`). Không có "schema lệch khỏi develop" vì không có schema ở nhánh cha; không có lý do tạo lại nhánh cha, trừ khi role hoặc default privileges của nó hỏng (khi đó chủ dự án đồng ý và tạo lại từ đầu).
- **`preview-base` không bao giờ được "reset from parent"** (không có dữ liệu để reset).
- **Đổi mật khẩu role app trên resource 2 (audit ADR-0010 M4):** mật khẩu đi theo nhánh. Đổi trên nhánh cha không đổi các nhánh con đã fork. Chủ dự án phải đổi mật khẩu trên **từng** nhánh có role (nhánh cha và mỗi nhánh `preview/*` đang tồn tại) cùng một giá trị mới, rồi cập nhật `DATABASE_APP_PASSWORD` ở Preview và redeploy. Biến Preview là một giá trị dùng chung, nên mọi nhánh phải khớp; không có cách đổi một nhánh.
- **Đổi mật khẩu role app ở production (audit ADR-0010 M4):** giữa lúc đổi mật khẩu trong DB và lúc redeploy xong, function đang chạy giữ mật khẩu cũ, kết nối mới bị từ chối. Thứ tự: chủ dự án đổi mật khẩu trên DB → cập nhật `DATABASE_APP_PASSWORD` ở Production → redeploy ngay. Có gián đoạn ngắn; chủ dự án phải có mặt suốt thao tác.
- **Biến Preview tĩnh biến mất** khi bước 3 xong. Lớp chặn `NEON_PRODUCTION_ENDPOINT` vẫn giữ nguyên làm lớp dự phòng, **nhưng có giới hạn (audit ADR-0010 M2):** nó chỉ so endpoint với endpoint của `main`. Nếu ai đó đổi "Allowed Environments" của resource 1 về "All", preview sẽ fork production sang nhánh có endpoint riêng và lớp chặn cho qua. Kiểm soát phát hiện: **project production chỉ được có nhánh `main`; mọi nhánh `preview/*` xuất hiện ở đó là sự cố bảo mật.** Orchestrator kiểm điều này sau mỗi lần đổi cài đặt tích hợp và trước mỗi release.
- **Dev (`develop`)** nằm trên resource 2. Quy tắc không xoá `preview/develop` áp dụng cho nhánh mới ở resource 2.
- **NS-53 (audit ADR-0010 L3):** API key dọn nhánh (Task 16) chỉ dùng loại **project-scoped**, gắn project của resource 2. Task 16 **phải từ chối** `NEON_PROJECT_ID` bằng id project production (`frosty-queen-67078672`) và từ chối xoá nhánh mặc định của resource 2. Key này không đọc được chuỗi kết nối production (dữ kiện 5 cho thấy loại key này có sẵn).
- **Diff của ADR-0007 chỉ là dòng trạng thái** ("Đã chấp nhận; bổ sung bởi ADR-0010"); nội dung ADR-0007 không đổi. Ngoại lệ một lần của `preview/develop` cũ được ghi trong ADR này, không sửa ADR-0007.
- Trạng thái ADR này vẫn là "Đề xuất" cho tới khi chủ dự án duyệt. Orchestrator đổi thành "Đã chấp nhận" sau khi chủ dự án duyệt (audit ADR-0010 L5).
