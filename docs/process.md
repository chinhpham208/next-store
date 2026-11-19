# Quy trình làm việc: next-store

Đội gồm một **chủ dự án** (người) và các **agent** đóng vai trong một team phần mềm. Tài liệu này là luật chơi chung; mỗi agent đọc file vai của mình trong `docs/agents/` cùng với tài liệu này.

## 1. Vai trò

| Vai | Ai | Chịu trách nhiệm | Không làm |
|---|---|---|---|
| **Product Owner** | Chủ dự án | Ưu tiên, duyệt plan, duyệt thiết kế, nghiệm thu mốc, quyết định khi bị leo thang | — |
| **Orchestrator** | Phiên Claude chính | Điều phối từng bước, chạy script, git, PR, chuyển trạng thái YouTrack, leo thang | Viết code tính năng |
| **Planner** | `planner` (model mạnh) | Plan mốc, chia ticket, xác định rủi ro | Viết code |
| **Designer** | `designer` | Design system, màn hình mỗi mốc; review giao diện trên preview | Viết code tính năng |
| **Implementer** | `implementer` (model tầm trung; việc cấu hình / CI / tài liệu: model nhẹ) | Code một ticket theo TDD, mở PR | Tự đổi phạm vi ticket, thêm thư viện ngoài plan |
| **Reviewer** | `reviewer` (chỉ đọc) | Review PR theo tiêu chí chấp nhận và `conventions.md` | Sửa code |
| **QA** | `qa` | Viết E2E theo tiêu chí chấp nhận; test trên preview; mở ticket Bug | Sửa code tính năng |
| **Security & Architecture auditor** | `auditor` (model mạnh, chỉ đọc) | Soát PR chạm auth, cookie, webhook, thanh toán, cache; soát cả mốc M4–M6 | Sửa code |

Việc DevOps (CI, cấu hình Vercel / Neon, script) là ticket bình thường, do Implementer làm và Reviewer duyệt; thao tác cần tài khoản do chủ dự án làm.

## 2. Vòng đời một mốc

```
1. Planner viết docs/plans/M<n>.md            ──► [CỔNG 1] chủ dự án duyệt plan
2. Orchestrator tạo ticket trên YouTrack bằng script
3. Designer thiết kế màn hình mới của mốc     ──► [CỔNG 2] chủ dự án duyệt thiết kế
4. Với từng ticket, tuần tự:
     a. Implementer: nhánh NS-xx, TDD, scripts/verify.sh, mở PR trên GitHub      ticket → In Progress
     b. Reviewer (+ Auditor nếu chạm vùng nhạy cảm), song song, chỉ đọc
     c. Có lỗi chặn → quay lại (a); tối đa 2 vòng
     d. CI xanh + không còn lỗi chặn → Orchestrator squash-merge qua API sau khi CI xanh     ticket → To Verify
5. QA chạy E2E + thử tay trên production/preview theo tiêu chí chấp nhận; lỗi → ticket Bug
6. Auditor soát toàn mốc (M4–M6)
7. Orchestrator gửi demo: link production, danh sách ticket, kết quả QA ──► [CỔNG 3] chủ dự án nghiệm thu → Done
```

Riêng M1: thêm một điểm dừng sau ticket đầu tiên để kiểm tra quy trình chạy đúng.

## 3. Trạng thái trên YouTrack

| Loại | Open | In Progress | To Verify | Done |
|---|---|---|---|---|
| **Task / Bug** | Đã tạo | Implementer bắt đầu (có nhánh) | PR đã merge, đã deploy | Chủ dự án nghiệm thu |
| **User Story** | Chưa bắt đầu | Có task đang làm | Mọi task xong, E2E của story xanh | Chủ dự án nghiệm thu |
| **Epic** | Chưa bắt đầu | Mốc đang chạy | Chờ CỔNG 3 | Chủ dự án nghiệm thu |

- Mỗi lần chuyển trạng thái kèm **một** comment bằng chứng (link PR, kết quả CI, link preview) — không comment từng vòng review.
- Story trải nhiều mốc (ví dụ US-01: M1 + M3) chỉ sang To Verify khi phần ở mốc cuối xong.
- Chỉ dùng script `scripts/youtrack/ticket.py` để chuyển trạng thái, không gọi `yt` tuỳ hứng.

## 4. Quy tắc an toàn

- **Một người viết tại một thời điểm.** Chỉ một agent được ghi vào `/home/claude/next-store`; Reviewer, QA (khi chỉ đọc), Auditor chạy song song được.
- **Giới hạn vòng lặp.** Implementer sửa tối đa 2 vòng theo review; vẫn hỏng → gọi `deep-reasoner` một lần để chẩn đoán → vẫn hỏng → dừng, hỏi chủ dự án.
- **Leo thang ngay** (không tự quyết) khi: lệch ADR, thêm thư viện ngoài plan, lùi phiên bản, vấn đề bảo mật, cần tài khoản / chi phí, xoá dữ liệu production.
- **Bằng chứng thật.** Mọi khẳng định "đã chạy / đã qua" phải kèm output thật từ `scripts/verify.sh` hoặc CI; không viết lại bằng trí nhớ.
- **Kiểm tra API đúng phiên bản.** Khi dùng API Next.js / Drizzle không chắc chắn, đọc tài liệu trong `node_modules/next/dist/docs` hoặc trang docs chính thức của đúng phiên bản trong `package.json`.
- **Secret** không bao giờ vào repo, log, comment ticket hay mô tả PR.

## 5. Môi trường làm việc của agent

- Agent làm việc trong workspace cloud `/home/claude/next-store`, dùng chung cho mọi agent; **một người viết tại một thời điểm** (xem §4).
- Source of truth là GitHub `chinhpham208/next-store` (riêng tư). Máy Mac của chủ dự án kéo code từ GitHub vào một bản clone riêng; chủ dự án không chạy `npm` trong workspace.
- Shell trên máy ảo Linux; mỗi lệnh tối đa 180 giây → lệnh dài (`npm ci`, `next build`, Playwright) chạy qua `scripts/verify.sh` (chạy nền + đọc log).
- `yt` (YouTrack CLI) và `gh` đã đăng nhập sẵn trong workspace.
- Secret nằm ngoài repo: `/home/claude/secrets/` (workspace); `~/Projects/.youtrack-token`, `~/Projects/.github-token` (trên Mac).

### GitHub trong workspace

GraphQL bị chặn bởi proxy của phiên, nên dùng REST:

- Mở PR: `gh api repos/chinhpham208/next-store/pulls -f title=… -f head=… -f base=main -f body=…`
- Check: `gh api repos/chinhpham208/next-store/commits/<sha>/check-runs`
- Merge (chỉ Orchestrator): `gh api -X PUT repos/chinhpham208/next-store/pulls/<n>/merge -f merge_method=squash`
- Cài đặt repo: chỉ squash-merge; nhánh tự xoá sau khi merge. Vì repo tự xoá nhánh sau khi merge, thường không cần xoá nhánh thủ công. Nếu còn nhánh cần xoá, lệnh xoá qua proxy bị chặn → Orchestrator xử lý.
- Branch protection không khả dụng (GitHub Free, repo riêng tư), nên quy tắc "chỉ merge khi CI xanh và review đã duyệt" do Orchestrator đảm bảo.

## 6. Cuối mỗi mốc

Orchestrator ghi ngắn vào `docs/retro/M<n>.md`: điều gì chậm, vòng review nào lặp, leo thang nào, đề xuất chỉnh quy trình. Chủ dự án duyệt các đề xuất trước mốc tiếp theo.

## 7. File vai của agent

Định nghĩa vai nằm ở `docs/agents/*.md` (định dạng frontmatter của Claude Code). Orchestrator giao việc bằng cách đưa nội dung file vai vào prompt của agent tương ứng. Muốn dùng trực tiếp trong Claude Code, chủ dự án sao chép thư mục này thành `.claude/agents/` (Claude không được phép ghi vào `.claude/` từ xa).
