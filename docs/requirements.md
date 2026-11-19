# Yêu cầu: next-store

## 1. Bối cảnh

next-store là một cửa hàng online nhỏ bán đồ dùng cho lập trình viên (áo thun, cốc, sticker, sách), kèm một blog, được **deploy công khai trên internet** và phát triển theo quy trình của một dự án thật (ticket, PR, CI, review, môi trường preview và production).

**Giai đoạn hiện tại — trước khi mở bán:** mọi tính năng chạy thật trên production, **trừ thanh toán**: thanh toán chạy ở chế độ test, không thu tiền thật. Kiến trúc phải sẵn sàng để khi mở bán chỉ cần cắm cổng thanh toán Việt Nam (PayOS / VNPay / MoMo), không phải viết lại luồng đặt hàng.

## 2. Người dùng

| Vai trò | Mô tả |
|---|---|
| **Khách hàng** | Người xem và mua hàng. Không cần đăng ký tài khoản. |
| **Admin** | Chủ cửa hàng. Quản lý sản phẩm và theo dõi đơn hàng. |

## 3. User stories

### Khách hàng — xem hàng
- **US-01** Là khách hàng, tôi muốn xem sản phẩm nổi bật và bài blog mới ngay trên trang chủ, để biết cửa hàng có gì.
- **US-02** Là khách hàng, tôi muốn lọc sản phẩm theo danh mục, sắp xếp theo giá hoặc mới nhất, và tìm theo tên, để nhanh chóng tìm được món mình cần.
- **US-03** Là khách hàng, tôi muốn gửi link danh sách đã lọc cho bạn bè và họ thấy đúng kết quả như tôi.
- **US-04** Là khách hàng, tôi muốn xem chi tiết sản phẩm: ảnh, mô tả, giá, còn hàng hay không.
- **US-05** Là khách hàng, khi mở một sản phẩm không tồn tại, tôi muốn thấy trang báo lỗi thân thiện thay vì trang trắng.

### Khách hàng — mua hàng
- **US-06** Là khách hàng, tôi muốn thêm sản phẩm vào giỏ và thấy số lượng trong giỏ cập nhật ngay lập tức.
- **US-07** Là khách hàng, tôi muốn sửa số lượng hoặc xoá sản phẩm trong giỏ, và giỏ vẫn còn khi tôi quay lại sau.
- **US-08** Là khách hàng, tôi muốn được báo rõ nếu số lượng tôi muốn mua vượt quá tồn kho.
- **US-09** Là khách hàng, tôi muốn thanh toán và nhận trang xác nhận đơn hàng.

### Khách hàng — blog
- **US-10** Là khách hàng, tôi muốn đọc các bài blog của cửa hàng.
- **US-11** Là khách hàng, khi chia sẻ link sản phẩm hoặc bài blog lên mạng xã hội, tôi muốn link hiện ảnh và tiêu đề đẹp.

### Admin
- **US-12** Là admin, tôi muốn đăng nhập vào khu quản trị; người khác không vào được.
- **US-13** Là admin, tôi muốn sửa tên, giá, mô tả, tồn kho của sản phẩm và thấy thay đổi trên cửa hàng ngay sau khi lưu.
- **US-14** Là admin, tôi muốn xem danh sách đơn hàng, đặc biệt các đơn cần hoàn tiền vì hết hàng.

## 4. Tiêu chí chấp nhận

Dữ liệu mẫu (seed): 4 danh mục — `ao-thun`, `coc`, `sticker`, `sach` — mỗi danh mục 6 sản phẩm; 6 sản phẩm nổi bật; ít nhất 2 sản phẩm hết hàng.

| Story | Tiêu chí (Given / When / Then) | Mốc |
|---|---|---|
| US-01 | **Cho** dữ liệu mẫu, **khi** mở `/`, **thì** thấy 6 sản phẩm nổi bật, mỗi sản phẩm có ảnh, tên, giá dạng `199.000 ₫`, tên danh mục. **Cho** không có sản phẩm nổi bật, **thì** thấy "Chưa có sản phẩm nổi bật." **Cho** có bài blog, **thì** thấy 3 bài mới nhất (từ M3). | M1, M3 |
| US-02 | **Khi** mở `/products?category=ao-thun`, **thì** chỉ thấy áo thun. **Khi** thêm `&sort=price-asc`, **thì** giá tăng dần. **Khi** tìm `?q=git`, **thì** chỉ thấy sản phẩm có "git" trong tên (không phân biệt hoa thường). **Khi** có hơn 12 kết quả, **thì** chia trang, `?page=2` hiện 12 sản phẩm tiếp theo. | M2 |
| US-03 | **Cho** một URL có bộ lọc, **khi** mở ở trình duyệt khác, **thì** thấy đúng cùng kết quả. **Khi** đổi bộ lọc trên giao diện, **thì** URL cập nhật theo. **Cho** tham số không hợp lệ (`?page=abc`, `?sort=xyz`), **thì** dùng giá trị mặc định, không lỗi. | M2 |
| US-04 | **Khi** mở `/products/<slug>`, **thì** thấy ảnh, tên, mô tả, giá, và "Còn N sản phẩm" hoặc "Hết hàng". | M2 |
| US-05 | **Khi** mở `/products/khong-ton-tai`, **thì** nhận status 404 và trang báo không tìm thấy có link về danh sách sản phẩm. **Cho** lỗi khi đọc DB, **thì** thấy trang lỗi có nút thử lại. | M2 |
| US-06 | **Khi** bấm "Thêm vào giỏ", **thì** số trên biểu tượng giỏ tăng ngay (trước khi server trả lời). **Cho** server báo lỗi, **thì** số trở lại như cũ và hiện thông báo lỗi. | M4 |
| US-07 | **Cho** giỏ có hàng, **khi** sửa số lượng hoặc xoá, **thì** tổng tiền cập nhật. **Khi** đóng trình duyệt và mở lại, **thì** giỏ vẫn còn. **Khi** đặt số lượng về 0, **thì** sản phẩm bị xoá khỏi giỏ. | M4 |
| US-08 | **Cho** sản phẩm còn 3, **khi** thêm 4 vào giỏ, **thì** bị từ chối với thông báo "Chỉ còn 3 sản phẩm". **Cho** sản phẩm hết hàng, **thì** nút "Thêm vào giỏ" bị vô hiệu. | M4 |
| US-09 | Thanh toán chạy ở chế độ test (không thu tiền thật). **Cho** giỏ hợp lệ, **khi** thanh toán thành công, **thì** đơn chuyển `paid`, tồn kho giảm đúng số lượng, giỏ trống, và thấy trang xác nhận có mã đơn. **Khi** webhook gửi lặp lại cùng một thanh toán, **thì** tồn kho chỉ giảm một lần. **Cho** hai người cùng mua món cuối, **thì** đơn sau chuyển `needs_refund`. | M6 |
| US-10 | **Khi** mở `/blog`, **thì** thấy danh sách bài mới nhất trước. **Khi** mở `/blog/<slug>`, **thì** thấy nội dung MDX đã render. Slug không tồn tại trả 404. | M3 |
| US-11 | **Khi** đọc HTML của trang sản phẩm hoặc bài blog, **thì** có `og:title`, `og:description`, `og:image` đúng nội dung trang. `/sitemap.xml` liệt kê mọi sản phẩm và bài blog. | M3 |
| US-12 | **Khi** chưa đăng nhập mà mở `/admin/products`, **thì** bị chuyển tới `/admin/login`. **Khi** nhập sai mật khẩu, **thì** thấy lỗi. **Khi** nhập đúng, **thì** vào được; cookie phiên bị sửa tay thì bị đá ra. | M5 |
| US-13 | **Khi** admin đổi giá một sản phẩm và lưu, **thì** trang sản phẩm đó hiện giá mới ở lần tải kế tiếp, còn các trang sản phẩm khác không bị render lại. **Cho** giá âm hoặc tên trống, **thì** bị từ chối với lỗi cạnh ô nhập. | M5 |
| US-14 | **Khi** admin mở `/admin/orders`, **thì** thấy danh sách đơn mới nhất trước, có lọc theo trạng thái; đơn `needs_refund` được làm nổi bật. | M6 |

## 5. Yêu cầu phi chức năng

| Nhóm | Yêu cầu | Cách đo |
|---|---|---|
| **Hiệu năng** | Trang chủ, danh sách và chi tiết sản phẩm, blog: LCP < 2,5 s, CLS < 0,1, INP < 200 ms trên mobile | Web Vitals đo trên production (M6), Lighthouse trên preview |
| **SEO** | Mỗi trang công khai có title, description, ảnh Open Graph; có sitemap và robots; trang admin `noindex` | Test HTML + kiểm tra thủ công |
| **Đúng dữ liệu** | Không bán quá tồn kho mà không bị phát hiện; webhook thanh toán chỉ xử lý mỗi đơn một lần | Test tích hợp với DB |
| **Bảo mật** | Khu admin được bảo vệ; webhook xác minh chữ ký; mọi input validate; secret chỉ nằm trong biến môi trường, không trong repo; header bảo mật cơ bản (CSP, HSTS) | Review bảo mật M5–M6, CI quét secret |
| **Truy cập (a11y)** | Đạt WCAG 2.2 AA cho luồng chính: duyệt sản phẩm, giỏ hàng, thanh toán | Kiểm tra tự động trong E2E + review UI |
| **Sẵn sàng thanh toán thật** | Chuyển sang cổng thanh toán Việt Nam chỉ cần thêm một adapter và đổi cấu hình; không đổi luồng đặt hàng hay schema đơn hàng | ADR-0004 |
| **Vận hành** | Production chạy HTTPS trên domain công khai; mỗi PR có môi trường preview riêng; lỗi production được ghi nhận và báo về | Hosting + theo dõi lỗi (ADR-0005) |
| **Phát triển** | Chạy trên máy cá nhân không cần cài database hay tài khoản thanh toán; CI chặn merge khi check / test / build lỗi | CI trên mọi PR |
| **Dễ mở rộng** | Thêm miền nghiệp vụ mới (tài khoản khách hàng, đánh giá, …) không phải sắp xếp lại code cũ | Quy tắc phụ thuộc (dependency-cruiser) |

## 6. Ngoài phạm vi (giai đoạn hiện tại)

- Thu tiền thật (để giai đoạn mở bán, xem mục 7)
- Tài khoản khách hàng, đa ngôn ngữ, đa tiền tệ, mã giảm giá
- Thuế, hoá đơn điện tử, tích hợp đơn vị vận chuyển
- Admin upload ảnh sản phẩm (ảnh nằm trong repo)

## 7. Giai đoạn mở bán (sau này)

Khi quyết định bán thật, cần thêm — không nằm trong 6 mốc hiện tại:

- Adapter cổng thanh toán Việt Nam (ADR-0004) và tài khoản merchant
- Thông tin giao hàng trong checkout, email xác nhận đơn
- Gói hosting cho phép dùng thương mại (ADR-0005)
- Thủ tục pháp lý cho website bán hàng (cần chủ sở hữu tự xác minh)
