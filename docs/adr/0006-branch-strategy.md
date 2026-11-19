# ADR-0006: Chiến lược nhánh develop → production, main đóng băng

- Trạng thái: Đã chấp nhận
- Ngày: 2026-11-19
- Thay thế một phần: [ADR-0005](./0005-hosting.md) (nhánh kích hoạt deploy production và câu "nhánh `main` được bảo vệ"; giữ nguyên Vercel + Neon, CI trên GitHub Actions, `build:vercel`)

## Bối cảnh

ADR-0005 cho production deploy mỗi khi merge vào `main`. Như vậy mỗi ticket merge xong là lên production ngay, trong khi quy trình (`process.md` §2) chỉ cho chủ dự án nghiệm thu ở cuối mốc. Đội cần:

- một môi trường tích hợp hằng ngày, luôn chạy code mới nhất đã review, có dữ liệu seed để QA và demo;
- production chỉ thay đổi khi chủ dự án duyệt, và biết chính xác phiên bản nào đang chạy;
- cách sửa lỗi gấp trên production mà không kéo theo việc dở dang ở nhánh tích hợp.

Ràng buộc: GitHub Free, repo riêng tư → không có branch protection, quy tắc do Orchestrator đảm bảo. Vercel Hobby → không có Custom Environments, nhưng có domain cố định theo nhánh git cho bản preview. Repo đặt tự xoá nhánh head sau khi merge (nhánh mặc định không bao giờ bị tự xoá).

## Các phương án

| Phương án | Ưu | Nhược |
|---|---|---|
| Trunk-based: `main` = production, merge ticket là deploy | Đơn giản nhất, một nhánh | Mỗi ticket lên production trước khi chủ dự án nghiệm thu mốc; không có môi trường tích hợp ổn định ngoài preview từng PR |
| Release theo tag trên `main` (production chỉ build từ tag `v*`) | Một nhánh, phiên bản rõ | Vercel deploy production theo nhánh, không theo tag → cần deploy hook hoặc workflow riêng; hotfix phải tạo nhánh từ tag rồi đưa ngược về `main` thủ công |
| **`develop` → `production`, `main` đóng băng** | Vercel gắn production vào nhánh `production`, `develop` có domain cố định làm môi trường Dev; release là một PR có duyệt; hotfix có điểm xuất phát rõ (`production`) | Hai nhánh sống lâu, phải back-merge sau hotfix; cần giữ lịch sử chung giữa hai nhánh (merge commit, không squash) |

## Quyết định

- **`main`** đóng băng ở commit `40f402f` (nền khởi tạo). Không commit, không merge vào nữa; không deploy.
- **`develop`** là nhánh mặc định, tích hợp hằng ngày. Nhánh ticket `NS-xx-…` tạo từ `develop`, PR vào `develop`, **squash-merge** sau khi CI xanh và review duyệt.
- **`production`** là nhánh deploy Production. Chỉ thay đổi qua **release PR** `develop → production` do chủ dự án duyệt, merge bằng **merge commit** (không squash, để `develop` và `production` giữ lịch sử chung), kèm tag `v0.x.y` trên merge commit.
- **Hotfix:** nhánh `hotfix/NS-xx-…` tạo từ `production` → PR vào `production` (merge commit) → back-merge vào `develop` qua PR từ nhánh tạm `sync/production-to-develop-v0.x.y`. Không bao giờ dùng chính `production` làm head của PR.
- **Môi trường:** code không kiểm tra tên môi trường; mọi khác biệt nằm trong biến môi trường.

| Môi trường | Nhánh git | Vercel | Neon |
|---|---|---|---|
| **Preview** | mỗi PR | preview, một URL cho mỗi PR | branch riêng cho mỗi PR |
| **Dev** | `develop` | preview của nhánh `develop`, domain nhánh cố định (có trên Hobby) | branch `dev`, có seed |
| **Production** | `production` | production branch = `production` | nhánh chính |

- Repo: nhánh mặc định `develop`; cho phép merge commit và squash, tắt rebase; tự xoá nhánh head sau khi merge. Không có branch protection (GitHub Free, repo riêng tư).

## Hệ quả

- **Phiên bản:** tag có dạng `v0.<mốc>.<n>`. `n` bắt đầu từ 0 cho release đầu tiên của mốc và tăng 1 cho mọi release sau trong cùng mốc (release trung gian, release cuối mốc hoặc hotfix). Tag không bao giờ bị di chuyển hay tái sử dụng. Release cuối mốc chỉ là tag cuối cùng của mốc đó (M1: `v0.1.0` là bản đầu tiên, các bản sau là `v0.1.1`, `v0.1.2`, …). Tag đặt trên merge commit của release PR hoặc hotfix PR, do Orchestrator tạo sau khi merge.
- **Release:** Orchestrator mở PR `head=develop`, `base=production` → CI xanh → chủ dự án duyệt (CỔNG 3) → merge bằng `merge_method=merge` → tag → smoke trên Production. `develop` là nhánh mặc định nên không bị tự xoá khi làm head.
- **Hotfix và back-merge:** sau khi hotfix PR merge vào `production` và gắn tag, Orchestrator tạo nhánh `sync/production-to-develop-v0.x.y` trỏ vào commit hiện tại của `production`, mở PR vào `develop` và merge bằng merge commit. Nhánh tạm bị tự xoá sau khi merge; nếu dùng `production` làm head, cài đặt tự xoá sẽ xoá luôn nhánh `production`.
- **Quy tắc merge commit:** release PR, hotfix PR và back-merge PR luôn dùng merge commit. Squash ở các PR này làm hai nhánh lệch lịch sử, release sau sẽ xung đột với chính những thay đổi đã lên production. Chỉ PR ticket vào `develop` dùng squash.
- **Không có branch protection:** không gì chặn kỹ thuật việc push thẳng hoặc merge sai cách vào `develop` / `production`. Orchestrator kiểm tra base, merge method và CI trước mỗi lần merge; chỉ Orchestrator merge.
- **CI** chạy trên mọi `pull_request` (bất kể base) và trên `push` vào `develop` và `production`; không chạy cho `main`.
- **Dev dùng `VERCEL_ENV=preview`** (vì là bản preview của nhánh `develop`), nên `build:vercel` seed branch Neon `dev` như mọi preview. Biến `DATABASE_URL` / `DATABASE_URL_UNPOOLED` của Dev đặt ở phạm vi Preview, giới hạn cho nhánh git `develop`.
- **Thêm `stg` / `demo` sau này:** mỗi môi trường là một nhánh sống lâu, cập nhật bằng PR merge commit từ `develop` (hoặc từ `production`, tuỳ mục đích), có domain nhánh và branch Neon riêng như Dev (Hobby); hoặc dùng Vercel Custom Environments khi lên Pro. Không đổi code, chỉ thêm biến môi trường.
- Tài liệu quy trình (`process.md`, `conventions.md` §8, file vai, `design.md` §7, `architecture.md` §6, `plans/M1.md`) và `ci.yml` cập nhật theo ADR này.
