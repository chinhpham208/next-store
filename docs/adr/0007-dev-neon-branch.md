# ADR-0007: Dev dùng Neon branch do tích hợp tự tạo cho nhánh git `develop`

- Trạng thái: Đã chấp nhận; bổ sung bởi ADR-0010
- Ngày: 2026-11-20
- Thay thế một phần: [ADR-0006](./0006-branch-strategy.md) (dòng Dev trong bảng môi trường: "branch `dev`, có seed"; hệ quả về biến `DATABASE_URL` / `DATABASE_URL_UNPOOLED` của Dev). Mọi phần khác của ADR-0006 giữ nguyên.

## Bối cảnh

ADR-0006 quy định Dev dùng một Neon branch `dev` cố định. Khi triển khai (PR #6, mục 1), tạo branch `dev` cố định và biến ghi đè theo nhánh buộc phải chép mật khẩu DB vào Vercel bằng tay. Làm vậy thì mật khẩu nằm ở một bước vận hành thủ công mỗi lần tạo lại branch, trái với nguyên tắc không ai cầm mật khẩu database.

Chủ dự án xác nhận ADR-0005 là "Đã chấp nhận" và duyệt nội dung ADR này ngày 2026-11-20.

## Các phương án

| Phương án | Ưu | Nhược |
|---|---|---|
| (a) Branch `dev` cố định + biến ghi đè theo nhánh | Tên branch rõ ràng, dữ liệu Dev tách biệt | Phải chép mật khẩu DB vào Vercel bằng tay; bảo trì thêm biến ghi đè |
| **(b) Branch tích hợp tự tạo cho nhánh git `develop`** | Tích hợp Neon tự inject `DATABASE_URL` / `DATABASE_URL_UNPOOLED`, không ai cầm mật khẩu; cùng cơ chế với branch của mỗi preview | Branch fork từ nhánh chính tại thời điểm tạo; tên branch do tích hợp đặt |
| (c) Dev dùng chung nhánh chính của Neon | Không cần branch riêng | Dev và seed chạy mỗi lần build sẽ ghi vào database production; không chấp nhận |

## Quyết định

Chọn **(b)**. Dev nhận `DATABASE_URL` / `DATABASE_URL_UNPOOLED` do tích hợp Neon inject. Cùng một Neon branch được dùng qua mọi lần deploy `develop`. Vì seed chạy ở mỗi lần build, seed phải idempotent (`onConflictDoNothing` theo `slug`).

## Hệ quả

- Không ai cầm mật khẩu DB của Dev; không còn biến ghi đè theo nhánh để bảo trì.
- Branch của `develop` fork từ nhánh chính tại thời điểm tạo, nên dữ liệu Dev ban đầu là bản sao của production lúc đó. Rủi ro này và việc tách role / `preview-base` thuộc NS-36.
- Nếu tích hợp ngừng inject biến, preview rơi về biến tĩnh trỏ Neon `main`. Lớp chặn trong code (Task 16 của M2) chặn trường hợp này bằng `NEON_PRODUCTION_ENDPOINT`, biến đã được đặt trên Vercel cho Production, Preview và Development (NS-36 phần 1, PR #15).
- **Giới hạn số branch:** Neon Free cho tối đa 10 branch. Tích hợp chỉ xoá branch `preview/<branch>` khi Vercel deployment tương ứng bị xoá, không xoá khi nhánh git bị xoá. Ngày 2026-11-20, preview lỗi "Resource provisioning failed" cho đến khi Orchestrator xoá 8 branch preview cũ, với sự đồng ý của chủ dự án.
- Ticket NS-53 sẽ tự động hoá việc dọn dẹp. Cho đến khi xong, Orchestrator xoá branch Neon `preview/<branch>` đã cũ sau mỗi lần merge. Không bao giờ xoá `main` hoặc `preview/develop`.
