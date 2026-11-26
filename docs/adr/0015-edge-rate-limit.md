# ADR-0015: Giới hạn tốc độ ở biên bằng một quy tắc Vercel WAF cho Server Action

- Trạng thái: Đã chấp nhận (chủ dự án duyệt 2026-11-23, PR #66); bổ sung bởi [ADR-0018](./0018-admin-auth.md) (đề xuất, M5: quy tắc cũng đếm `loginAction`; giới hạn đăng nhập sai nằm trong app, bảng `admin_login_failures`) và [ADR-0021](./0021-payment-orders-and-webhook.md) (M6: webhook thanh toán không vào quy tắc)
- Ngày: 2026-11-23
- Quyết định của chủ dự án: 2026-11-23 (plan M4, Cổng 1, quyết định 8)
- Bổ sung: [ADR-0008](./0008-listing-cache-keys.md) (câu "Cần ADR riêng nếu thêm thư viện hoặc kho đếm" ở mục *Giới hạn tần suất*), [ADR-0009](./0009-product-404-in-proxy.md) (gạch đầu dòng "Cần giới hạn tần suất ở biên (chưa làm ở M2)… ADR riêng")
- Liên quan: [ADR-0005](./0005-hosting.md) (Vercel Hobby), [ADR-0014](./0014-cart-storage-and-cookie.md) (giỏ hàng, giới hạn cấu trúc trong code), `docs/plans/M4.md` Task 10, 11, ticket NS-86 (Task 1)

## Bối cảnh

Từ M4, khách ẩn danh **ghi** được vào DB: mỗi lần thêm vào giỏ thành công đầu tiên tạo một hàng `carts` (ADR-0014). Mỗi Server Action là một POST công khai (plan M4, D5). Không có gì ở biên thì một người tạo được hàng nghìn giỏ, mỗi giỏ một request, trên Neon Free (0,5 GB).

ADR-0014 đã đặt giới hạn **cấu trúc** trong code: mỗi dòng tối đa 10 cái, mỗi giỏ tối đa 20 loại, chỉ tạo giỏ khi lần thêm đầu thành công, dọn 50 giỏ hết hạn mỗi lần tạo giỏ mới. Những giới hạn đó chặn một giỏ phình to, nhưng không chặn **số giỏ** theo thời gian.

ADR-0008 (tìm kiếm `q` không cache, mỗi request chạm DB) và ADR-0009 (slug sản phẩm lạ tốn một truy vấn mỗi request) đều ghi "cần giới hạn tần suất ở biên", và nói thêm thư viện hay kho đếm thì cần ADR riêng. ADR này là ADR đó.

Điều đã đọc (plan M4, D9, tài liệu Vercel đọc 2026-11-23): Vercel WAF Rate Limiting có trên **mọi gói**. Gói Hobby:

- **1 quy tắc rate limit mỗi project**, trong tổng 3 custom rule;
- khoá đếm theo IP hoặc JA4;
- cửa sổ cố định từ 10 s tới 10 phút;
- 1.000.000 request được phép;
- bộ đếm theo **từng region**.

Chưa kiểm (C5, Task 10 Step 1): quy tắc trên Hobby lọc được theo method `POST` và header `next-action` không; quy tắc áp cho Preview không; cấu hình ghi được vào repo (`vercel.json`) hay chỉ nằm trong console.

## Các phương án

| Phương án | Ưu | Nhược |
|---|---|---|
| **A. Một quy tắc Vercel WAF:** `POST` (+ header `next-action` nếu lọc được), theo IP, 60 request / 60 s, bật **Log** trước rồi **429**; cộng giới hạn cấu trúc trong code (ADR-0014 mục 5, 7; chỉ tạo giỏ khi lần thêm đầu thành công) | Chặn ở biên, trước function và DB. Có trên Hobby (D9). Không thư viện, không kho đếm | Hobby chỉ có **một** quy tắc rate limit: dùng cho action thì tìm kiếm `q` và slug lạ (ADR-0008, ADR-0009) vẫn chưa có. Bộ đếm theo region nên kẻ tấn công từ nhiều region vượt được. Cấu hình có thể chỉ nằm trong console (Task 10 kiểm) |
| B. Đếm trong bộ nhớ từng instance (Map theo IP) | Ghi trong repo, test được | Gần như vô dụng trên serverless (mỗi instance một bộ đếm, instance mới đếm lại từ 0). IP lấy từ header có thể giả nếu không cẩn thận |
| C. Chỉ giới hạn cấu trúc trong code, không rate limit | Không cấu hình ngoài repo | Không chặn được người tạo hàng nghìn giỏ (mỗi giỏ một request) |

Không xét kho đếm dùng chung (Redis, Upstash, bảng đếm trong Postgres): thêm dịch vụ hoặc thư viện ngoài plan M4, và bảng đếm trong Postgres biến mỗi request bị giới hạn thành thêm một lần ghi vào chính DB cần bảo vệ.

## Quyết định

Câu trả lời của chủ dự án ở Cổng 1 (plan M4, mục "Cần chủ dự án quyết"), chép nguyên văn:

> **Đã quyết (2026-11-23):** chủ dự án duyệt tất cả: 1A, 2A (kèm ghi chú C trong ADR-0014), 3A, 4A, 5A, 6A, 7A, 8A, 9A, 10A, 11A (nếu Task 7 Step 1 xác nhận C3), 12A.

Quyết định 8A áp như sau.

- **Một quy tắc Vercel WAF** (quy tắc rate limit duy nhất của gói Hobby) dành cho Server Action:
  - **Điều kiện:** method `POST` **và** có header `next-action`, nếu C5 cho lọc theo header. Không lọc được header thì chỉ `POST`: M4 không có POST nào khác (không Route Handler cho giỏ; webhook thanh toán ở M6 phải được xét lại khi thêm, xem Hệ quả).
  - **Khoá đếm:** IP.
  - **Cửa sổ:** cố định 60 s.
  - **Ngưỡng:** 60 request.
  - **Hành động:** **Log** trước, đổi sang **429** sau khi xem log trên Production một ngày mà không có lượt khớp từ người dùng thật.
- **Không đếm trong bộ nhớ instance (B bị loại).** Trên Vercel mỗi instance function có bộ nhớ riêng, instance mới đếm lại từ 0 và số instance tăng theo tải. Bộ đếm như vậy cho giới hạn lớn dần đúng lúc bị tấn công. IP phải lấy từ header do Vercel đặt; đọc nhầm header do client gửi là ai cũng giả được.
- **Giới hạn cấu trúc trong code vẫn giữ** (ADR-0014): quy tắc WAF giới hạn tốc độ, code giới hạn kích thước. Một bên hỏng thì bên kia vẫn còn.
- **Cấu hình nằm ở đâu.** Chủ dự án tạo quy tắc trong console Vercel (Task 10 Step 2). Nếu C5 cho ghi vào repo thì quy tắc được ghi vào repo theo đề xuất 2 của retro M2 (Task 10, nhánh `NS-<số>-waf-rule`). Dù ở đâu, cấu hình (tên quy tắc, điều kiện, khoá, cửa sổ, ngưỡng, hành động; không có secret) được chép vào mục Hệ quả của ADR này ở Task 10 Step 4.

## Hệ quả

- **Tìm kiếm `q` và slug sản phẩm lạ chưa có giới hạn tốc độ.** Hobby chỉ có một quy tắc rate limit, và nó dành cho Server Action. Mỗi request `/products?q=…` vẫn chạy tới hai truy vấn quét tuần tự (ADR-0008); mỗi slug lạ đúng dạng vẫn tốn một truy vấn (ADR-0009). **Rủi ro chấp nhận** tới khi đổi gói. Khi có thêm quy tắc (gói Pro), áp quy tắc thứ hai cho `GET /products` có `q` và cho `/products/<slug>`, ADR mới hoặc bổ sung ADR này.
- **Bộ đếm theo region.** Một kẻ tấn công gửi từ nhiều region có trần bằng 60 × số region mỗi phút. Chấp nhận: giới hạn cấu trúc của ADR-0014 vẫn chặn kích thước mỗi giỏ, và Task 11 Step 4 tính trần tăng trưởng (số giỏ mỗi ngày một IP tạo được dưới ngưỡng, dung lượng ước tính trên Neon Free, dọn 50 giỏ mỗi lần tạo có theo kịp không).
- **Khoá IP chặn chung người dùng sau NAT.** Một văn phòng hay mạng di động dùng chung IP chia nhau 60 action mỗi phút. Với một cửa hàng quà tặng, 60 lần thêm / sửa / xoá mỗi phút cho cả một IP là đủ; chế độ Log trong ngày đầu cho thấy có ai chạm ngưỡng không trước khi bật 429.
- **429 đến từ biên, không từ action.** Client nhận lỗi HTTP thay vì `CartActionResult`, nên nút thêm vào giỏ xử lý nó như mọi POST thất bại (ADR-0014: `try` / `catch`, số trở lại như cũ, thông báo "Không kết nối được. Vui lòng tải lại trang và thử lại."). Không có trang lỗi.
- **Webhook thanh toán (M6) là POST.** Nếu quy tắc chỉ lọc được theo `POST` (C5), webhook của cổng thanh toán cũng bị đếm theo IP của cổng. M6 phải thêm ngoại lệ đường dẫn `/api/webhooks/payment` vào điều kiện (vẫn trong cùng một quy tắc) hoặc xác nhận ngưỡng đủ cao cho lưu lượng webhook.
  - **Trả lời (M6, chủ dự án duyệt 2026-11-26, quyết định 11A, [ADR-0021](./0021-payment-orders-and-webhook.md)):** không thêm quy tắc WAF và không sửa điều kiện. C5 đã cho thấy quy tắc lọc được theo header: nó chỉ đếm `POST` **có** `next-action`, nên webhook (không có header đó) không bị đếm. Chữ ký được kiểm trước mọi đọc DB và thân tối đa 8 KB, nên POST rác chỉ tốn một HMAC. Rủi ro còn lại: một đợt POST rác vẫn tốn invocation (hạn mức Hobby).
- **Một phần cấu hình có thể chỉ nằm ngoài repo.** Nếu C5 cho thấy quy tắc chỉ cấu hình được trong console: thay đổi không qua PR, không có lịch sử trong git. Bù lại bằng việc chép cấu hình vào ADR này và ghi ngày đổi Log → 429.
- **Cách kiểm:**
  - Task 10 Step 3: trên Production sau `v0.4.0` (hoặc Preview nếu quy tắc áp ở đó), 61 POST giả lập từ một IP trong 60 s bằng `curl` có `next-action` không hợp lệ (action ID sai không ghi gì) cho thấy log Firewall có lượt khớp, và trang `GET` không bị đếm. Sau khi đổi sang 429, request thứ 61 nhận 429.
  - Task 11 Step 4: Auditor đọc quy tắc, tính trần tăng trưởng, nhận xét về giới hạn theo region.
  - Kết quả (số liệu, ngày đổi sang 429) được ghi vào mục này ở Task 10 Step 4.
  - **Sửa ghi chú 2026-11-24 (Task 10 Step 3):** ghi chú trước đây nói quy tắc ở chế độ Log đã đếm đúng 61 POST lúc 03:06 UTC dựa trên xác nhận của chủ dự án. **Sai:** ngày 2026-11-25 trang Firewall không có quy tắc nào ("No Custom Rules Yet"); Audit Log của Firewall không có lần publish nào trước 07:30 UTC ngày 2026-11-25. Nhiều khả năng quy tắc đã được lưu nháp mà chưa Publish. Bài học ghi trong retro M4 (đề xuất 2: Orchestrator đọc lại cấu hình trong console trước khi ghi "đạt").
  - **Cấu hình thật (đọc lại từ trang Rules, 2026-11-25):** tên `ns-95-cart-action-rate-limit` (ID `rule_ns_95_cart_action_rate_limit_AOkpzB`), bật. If **Method** Equals `POST` AND **Request Header** `next-action` **Exists** → **Rate Limit**: Fixed Window, cửa sổ **60 s**, ngưỡng **60** request, key **IP Address** → Then **Too Many Requests (429)**. Chỉ cấu hình trong console (dashboard), không có trong repo. Orchestrator tạo và publish theo yêu cầu của chủ dự án.
  - **Lịch sử (Firewall Audit Log):** version #1, 07:30 UTC 2026-11-25: tạo quy tắc, hành động **Log**. Version #2, 08:15 UTC 2026-11-25: đổi hành động sang **429**.
  - **Chế độ Log không cho thấy gì trên Hobby:** 61 POST lúc 07:31 UTC (version #1) đi qua hết như mong đợi, nhưng 33 phút sau vẫn không có lượt Log nào ở overview, trang traffic của quy tắc hay Explore query. Vì vậy không chờ một ngày Log như kế hoạch; chủ dự án đồng ý đổi thẳng sang 429 và kiểm ngay.
  - **Kết quả kiểm 429 (Task 10 Step 4, 2026-11-25):** lúc 08:16:33–08:16:43 UTC, 65 `POST /cart` có `next-action` sai từ một IP (trình duyệt của chủ dự án): request 1–60 nhận 409 từ Next.js (action không tồn tại, không ghi gì), **request 61–65 nhận 429** từ Vercel WAF. 3 `GET /cart` ngay sau đó trả 200: trang không bị đếm. Một lượt thử trước đó lúc 08:14 UTC (65 POST, tất cả 409) chạy khi thay đổi 429 mới lưu nháp, chưa publish, nên khớp với version #1.
