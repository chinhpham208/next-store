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
| **Security & Architecture auditor** | `auditor` (model mạnh, chỉ đọc) | Soát PR chạm auth, cookie, webhook, thanh toán, cache, migration (`drizzle/*.sql`), kết nối và quyền DB, workflow dùng secret hoặc chạm Production; soát cả mốc M4–M6 | Sửa code |

Việc DevOps (CI, cấu hình Vercel / Neon, script) là ticket bình thường, do Implementer làm và Reviewer duyệt; thao tác cần tài khoản do chủ dự án làm.

## 2. Vòng đời một mốc

```
1. Planner viết docs/plans/M<n>.md            ──► [CỔNG 1] chủ dự án duyệt plan
2. Orchestrator tạo ticket trên YouTrack bằng script
3. Designer thiết kế màn hình mới của mốc     ──► [CỔNG 2] chủ dự án duyệt thiết kế
4. Với từng ticket, tuần tự:
     a. Implementer: nhánh NS-xx từ develop, TDD, scripts/verify.sh, mở PR vào develop      ticket → In Progress
     b. Reviewer (+ Auditor nếu chạm vùng nhạy cảm), song song, chỉ đọc
     c. Có lỗi chặn → quay lại (a); tối đa 2 vòng
     d. CI xanh + không còn lỗi chặn → Orchestrator squash-merge vào develop qua API; Vercel deploy Dev      ticket → To Verify
5. QA chạy E2E + thử tay trên Dev / preview theo tiêu chí chấp nhận; lỗi → ticket Bug
6. Auditor soát toàn mốc (M4–M6)
7. Orchestrator mở release PR develop → production, gửi demo: link Dev, link release PR, danh sách ticket, kết quả QA
     ──► [CỔNG 3] chủ dự án nghiệm thu; chủ dự án duyệt bằng lời trong chat là đủ (repo riêng tư, không có branch protection)
8. Orchestrator merge release PR bằng merge commit, gắn tag v0.<mốc>.<n> (`n` tiếp theo trong mốc; xem conventions §8), smoke trên Production; sau release chạy workflow `Production E2E` (có hiệu lực khi M3 Task 17 merge)     ticket → Done
```

Riêng M1: thêm một điểm dừng sau ticket đầu tiên để kiểm tra quy trình chạy đúng.

Nhánh, merge method, tag, hotfix và back-merge: [`conventions.md`](./conventions.md) §8 và [ADR-0006](./adr/0006-branch-strategy.md). `main` đóng băng, không dùng nữa.

## 3. Trạng thái trên YouTrack

| Loại | Open | In Progress | To Verify | Done |
|---|---|---|---|---|
| **Task / Bug** | Đã tạo | Implementer bắt đầu (có nhánh) | PR đã merge vào `develop`, đã lên Dev | Chủ dự án nghiệm thu |
| **User Story** | Chưa bắt đầu | Có task đang làm | Mọi task xong, E2E của story xanh | Chủ dự án nghiệm thu |
| **Epic** | Chưa bắt đầu | Mốc đang chạy | Chờ CỔNG 3 | Chủ dự án nghiệm thu |

- Mỗi lần chuyển trạng thái kèm **một** comment bằng chứng (link PR, kết quả CI, link preview) — không comment từng vòng review.
- Story trải nhiều mốc (ví dụ US-01: M1 + M3) chỉ sang To Verify khi phần ở mốc cuối xong.
- Chỉ dùng script `scripts/youtrack/ticket.py` để chuyển trạng thái, không gọi `yt` tuỳ hứng.

## 4. Quy tắc an toàn

- **Mỗi người viết một worktree.** `/home/claude/next-store` là của Orchestrator. Mỗi ticket chạy song song có worktree riêng `/home/claude/wt/NS-xx` (`git worktree add -b <nhánh> /home/claude/wt/NS-xx origin/develop`, rồi `npm ci`), do Orchestrator tạo và xoá sau khi merge. Reviewer, Auditor, QA (khi chỉ đọc) dùng worktree tạm `/tmp/<vai>-<số PR>` và tự xoá. Không ai `git checkout` trong worktree của người khác (audit PR #15 từng chạy nhầm code vì workspace chung bị đổi nhánh giữa chừng). `scripts/verify.sh` dùng cổng 3100: nếu bận thì chờ hoặc chạy từng bước với `SMOKE_PORT` khác.
- **Giới hạn vòng lặp.** Implementer sửa tối đa 2 vòng theo review; vẫn hỏng → gọi `deep-reasoner` một lần để chẩn đoán → vẫn hỏng → dừng, hỏi chủ dự án.
- **Leo thang ngay** (không tự quyết) khi: lệch ADR, thêm thư viện ngoài plan, lùi phiên bản, vấn đề bảo mật, cần tài khoản / chi phí, xoá dữ liệu production.
- **Bằng chứng thật.** Mọi khẳng định "đã chạy / đã qua" phải kèm output thật từ `scripts/verify.sh` hoặc CI; không viết lại bằng trí nhớ.
- **Kiểm tra API đúng phiên bản.** Khi dùng API Next.js / Drizzle không chắc chắn, đọc tài liệu trong `node_modules/next/dist/docs` hoặc trang docs chính thức của đúng phiên bản trong `package.json`.
- **Sau mỗi merge**, Orchestrator xoá Neon branch `preview/<nhánh>` của PR vừa merge (chủ dự án đã đồng ý một lần cho việc này; không bao giờ xoá `main`, `preview/develop`, nhánh cha của preview) cho tới khi workflow của NS-53 chạy.
- **Cài đặt hạ tầng** ghi được vào repo (`vercel.json`, workflow) thì ghi vào repo, không đặt trong console.
- **Secret** không bao giờ vào repo, log, comment ticket hay mô tả PR.

## 5. Môi trường làm việc của agent

- Agent làm việc trong workspace cloud: Orchestrator ở `/home/claude/next-store`, mỗi ticket một worktree `/home/claude/wt/NS-xx` (xem §4).
- Seed production: `npm run db:seed:sql` sinh SQL, chạy trong Neon SQL Editor trên nhánh `main` (README, mục Seed production); `db:seed` bị từ chối trên production.
- Source of truth là GitHub `chinhpham208/next-store` (riêng tư). Máy Mac của chủ dự án kéo code từ GitHub vào một bản clone riêng; chủ dự án không chạy `npm` trong workspace.
- Shell trên máy ảo Linux; mỗi lệnh tối đa 180 giây → lệnh dài (`npm ci`, `next build`, Playwright) chạy qua `scripts/verify.sh` (chạy nền + đọc log).
- `yt` (YouTrack CLI) và `gh` đã đăng nhập sẵn trong workspace.
- Sau release, Orchestrator chạy workflow `Production E2E` (chỉ đọc; có hiệu lực khi M3 Task 17 merge).
- Preview và Dev được kiểm tự động (E2E, smoke) bằng workflow CI chạy sau mỗi deploy, thêm ở M2. Workflow cần GitHub secret `VERCEL_AUTOMATION_BYPASS_SECRET`; chủ dự án đã tạo secret này ngày 2026-11-20 (có trong Vercel và GitHub Actions).
- Secret nằm ngoài repo: `/home/claude/secrets/` (workspace); `~/Projects/.youtrack-token`, `~/Projects/.github-token` (trên Mac).

### GitHub trong workspace

GraphQL bị chặn bởi proxy của phiên, nên dùng REST:

- Mở PR ticket: `gh api repos/chinhpham208/next-store/pulls -f title=… -f head=NS-xx-… -f base=develop -f body=…`
- Check: `gh api repos/chinhpham208/next-store/commits/<sha>/check-runs`
- Merge PR ticket (chỉ Orchestrator): `gh api -X PUT repos/chinhpham208/next-store/pulls/<n>/merge -f merge_method=squash`
- Release (chỉ Orchestrator, sau khi chủ dự án duyệt):
  - Mở PR: `gh api repos/chinhpham208/next-store/pulls -f title="Release v0.x.y" -f head=develop -f base=production -f body=…`
  - Merge: `gh api -X PUT repos/chinhpham208/next-store/pulls/<n>/merge -f merge_method=merge` (merge commit, **không** squash)
  - Tag trên merge commit (`merge_commit_sha` trong kết quả merge): `gh api repos/chinhpham208/next-store/git/refs -f ref=refs/tags/v0.x.y -f sha=<merge_commit_sha>`
- Hotfix: PR `head=hotfix/NS-xx-…`, `base=production`, `merge_method=merge`, rồi tag. Back-merge: tạo nhánh tạm từ `production` — `gh api repos/chinhpham208/next-store/git/refs -f ref=refs/heads/sync/production-to-develop-v0.x.y -f sha=<sha của production>` — rồi PR `head=sync/production-to-develop-v0.x.y`, `base=develop`, `merge_method=merge`. Không dùng `production` làm head (sẽ bị tự xoá sau khi merge).
- Cài đặt repo: nhánh mặc định `develop`; cho phép squash và merge commit, tắt rebase; nhánh head tự xoá sau khi merge (nhánh mặc định không bị xoá). Thường không cần xoá nhánh thủ công; nếu còn nhánh cần xoá, lệnh xoá qua proxy bị chặn → Orchestrator xử lý.
- Branch protection không khả dụng (GitHub Free, repo riêng tư), nên quy tắc "chỉ merge khi CI xanh và review đã duyệt", đúng base và đúng merge method do Orchestrator đảm bảo.

## 6. Cuối mỗi mốc

Orchestrator ghi ngắn vào `docs/retro/M<n>.md`: điều gì chậm, vòng review nào lặp, leo thang nào, đề xuất chỉnh quy trình. Chủ dự án duyệt các đề xuất trước mốc tiếp theo.

## 7. File vai của agent

Định nghĩa vai nằm ở `docs/agents/*.md` (định dạng frontmatter của Claude Code). Orchestrator giao việc bằng cách đưa nội dung file vai vào prompt của agent tương ứng. Muốn dùng trực tiếp trong Claude Code, chủ dự án sao chép thư mục này thành `.claude/agents/` (Claude không được phép ghi vào `.claude/` từ xa).
