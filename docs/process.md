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
     d. `scripts/pr-gate.sh <n>` thoát 0 + không còn lỗi chặn → Orchestrator squash-merge vào develop qua API; Vercel deploy Dev      ticket → To Verify
5. QA chạy E2E + thử tay trên Dev / preview theo tiêu chí chấp nhận; lỗi → ticket Bug
6. Auditor soát toàn mốc (M4–M6)
7. Orchestrator mở release PR develop → production, chạy `scripts/pr-gate.sh <n>` trên PR đó (gồm `release-smoke`), chỉ khi
   thoát 0 mới gửi demo: link Dev, link release PR, danh sách ticket, kết quả QA, output của pr-gate
     ──► [CỔNG 3] chủ dự án nghiệm thu; chủ dự án duyệt bằng lời trong chat là đủ (chưa bật branch protection / ruleset)
8. Orchestrator merge release PR bằng merge commit (pr-gate vừa thoát 0 trên PR đó), gắn tag v0.<mốc>.<n> (`n` tiếp theo trong mốc; xem conventions §8), smoke trên Production; sau release chạy workflow `Production E2E` (có hiệu lực khi M3 Task 17 merge)     ticket → Done
```

Riêng M1: thêm một điểm dừng sau ticket đầu tiên để kiểm tra quy trình chạy đúng.

### Cổng merge: `scripts/pr-gate.sh` (NS-111)

Orchestrator **chỉ** merge một PR (ticket, release, hotfix, back-merge) sau khi `bash scripts/pr-gate.sh <số PR>` thoát 0, và dán output vào comment bằng chứng của ticket. Không xem tay danh sách check thay cho lệnh này.

- Lệnh chờ (mặc định tối đa 20 phút, `PR_GATE_TIMEOUT`) tới khi mọi check-run và commit status của head sha xong, rồi chỉ cho qua khi: commit status `Vercel` = success, check-run `check` = success, check-run `e2e-preview` = success, không check nào khác fail, PR `mergeable == true`. PR vào `production` cần thêm check-run `release-smoke` = success (workflow `Release gate`).
- **skipped không phải là qua**, neutral, cancelled, thiếu hay còn chạy khi hết hạn cũng vậy. `e2e-preview` chỉ chạy khi Vercel deploy thành công, nên preview fail hiện ra là `e2e-preview` skipped: đó là cách #87 và #89 được merge khi preview đã fail (NS-111). `preview-e2e.yml` không có điều kiện bỏ qua chủ ý nào (kể cả PR chỉ đổi docs), nên không có ngoại lệ.
- Lệnh chặn thì không merge: sửa nguyên nhân (deploy lỗi, test đỏ, xung đột) rồi chạy lại. Không có cờ bỏ qua.
- Mã thoát: 0 = qua, 1 = chặn (lý do in bằng tiếng Việt), 2 = cách gọi sai hoặc không đọc được GitHub.

Nhánh, merge method, tag, hotfix và back-merge: [`conventions.md`](./conventions.md) §8 và [ADR-0006](./adr/0006-branch-strategy.md). `main` đóng băng, không dùng nữa.

## 3. Trạng thái trên YouTrack

| Loại | Open | In Progress | To Verify | Done |
|---|---|---|---|---|
| **Task / Bug** | Đã tạo | Implementer bắt đầu (có nhánh) | PR đã merge vào `develop`, đã lên Dev | Chủ dự án nghiệm thu |
| **User Story** | Chưa bắt đầu | Có task đang làm | Mọi task xong, E2E của story xanh | Chủ dự án nghiệm thu |
| **Epic** | Chưa bắt đầu | Mốc đang chạy | Chờ CỔNG 3 | Chủ dự án nghiệm thu |

- **Phân cấp:** Epic `M<n>` → User Story → Task / Bug, bằng link **subtask of**. Board Development xếp thẻ theo User Story, nên Task / Bug chỉ "relates to" story sẽ rơi vào "Uncategorized Cards". Ticket kỹ thuật (DB, CI, proxy, quy trình, thiết kế) là subtask của story kỹ thuật `M<n>-TECH` ("M<n> — Kỹ thuật & hạ tầng"). `ticket.py tasks` chọn story theo `US-xx` trong tiêu đề task, không có thì `M<n>-TECH`; `ticket.py bug --story` tạo link subtask. Đầu mỗi mốc mới, Orchestrator tạo story `M<n>-TECH` và ghi vào `issue-map.json`.
- Sau mỗi release, mọi Task / Bug đã lên `production` chuyển Done (bước 8 ở trên), cùng các story đã đủ task.
- Mỗi lần chuyển trạng thái kèm **một** comment bằng chứng (link PR, kết quả CI, link preview) — không comment từng vòng review.
- Story trải nhiều mốc (ví dụ US-01: M1 + M3) chỉ sang To Verify khi phần ở mốc cuối xong.
- Chỉ dùng script `scripts/youtrack/ticket.py` để chuyển trạng thái, không gọi `yt` tuỳ hứng.

## 4. Quy tắc an toàn

- **Mỗi người viết một worktree.** `/home/claude/next-store` là của Orchestrator. Mỗi ticket chạy song song có worktree riêng `/home/claude/wt/NS-xx` (`git worktree add -b <nhánh> /home/claude/wt/NS-xx origin/develop`, rồi `npm ci`), do Orchestrator tạo và xoá sau khi merge. Reviewer, Auditor, QA (khi chỉ đọc) dùng worktree tạm `/tmp/<vai>-<số PR>` và tự xoá. Không ai `git checkout` trong worktree của người khác (audit PR #15 từng chạy nhầm code vì workspace chung bị đổi nhánh giữa chừng). `scripts/verify.sh` mặc định dùng cổng 3100 → 3104; worktree chạy song song đặt `E2E_PORT=<n>` (smoke theo cùng cổng, trừ khi đặt `SMOKE_PORT` riêng). Verify chỉ tắt tiến trình do chính nó khởi động; cổng bận thì nó dừng với lỗi.
- **Giới hạn vòng lặp.** Implementer sửa tối đa 2 vòng theo review; vẫn hỏng → gọi `deep-reasoner` một lần để chẩn đoán → vẫn hỏng → dừng, hỏi chủ dự án.
- **Leo thang ngay** (không tự quyết) khi: lệch ADR, thêm thư viện ngoài plan, lùi phiên bản, vấn đề bảo mật, cần tài khoản / chi phí, xoá dữ liệu production.
- **Bằng chứng thật.** Mọi khẳng định "đã chạy / đã qua" phải kèm output thật từ `scripts/verify.sh` hoặc CI; không viết lại bằng trí nhớ.
- **Kiểm tra API đúng phiên bản.** Khi dùng API Next.js / Drizzle không chắc chắn, đọc tài liệu trong `node_modules/next/dist/docs` hoặc trang docs chính thức của đúng phiên bản trong `package.json`.
- **Nhánh Neon preview** được workflow `Neon preview cleanup` (`.github/workflows/neon-preview-cleanup.yml`, `scripts/neon-cleanup.mjs`, NS-111) xoá: khi PR đóng (`preview/<head_ref>`) và mỗi ngày một lần (mọi `preview/*` không còn PR mở). Không bao giờ xoá `main`, `preview/develop`, nhánh mặc định / protected, nhánh có nhánh con, nhánh không có tiền tố `preview/`. Workflow fail (ví dụ chưa có `NEON_API_KEY`) thì Orchestrator báo chủ dự án và, tới khi sửa xong, dọn tay như trước (chủ dự án đã đồng ý một lần cho việc này, cùng các giới hạn trên).
- **Cài đặt hạ tầng** ghi được vào repo (`vercel.json`, workflow) thì ghi vào repo, không đặt trong console.
- **Secret** không bao giờ vào repo, log, comment ticket hay mô tả PR.

## 5. Môi trường làm việc của agent

- Agent làm việc trong workspace cloud: Orchestrator ở `/home/claude/next-store`, mỗi ticket một worktree `/home/claude/wt/NS-xx` (xem §4).
- Seed production: `npm run db:seed:sql` sinh SQL, chạy trong Neon SQL Editor trên nhánh `main` (README, mục Seed production); `db:seed` bị từ chối trên production.
- Source of truth là GitHub `chinhpham208/next-store` (public từ 2026-11-25: chủ dự án chuyển để có phút GitHub Actions miễn phí, sau khi Orchestrator quét lịch sử git không có secret; Vercel Git Fork Protection bật, workflow từ fork cần duyệt, secret scanning + push protection bật). Máy Mac của chủ dự án kéo code từ GitHub vào một bản clone riêng; chủ dự án không chạy `npm` trong workspace.
- Shell trên máy ảo Linux; mỗi lệnh tối đa 180 giây → lệnh dài (`npm ci`, `next build`, Playwright) chạy qua `scripts/verify.sh` (chạy nền + đọc log).
- `yt` (YouTrack CLI) và `gh` đã đăng nhập sẵn trong workspace.
- Sau release, Orchestrator chạy workflow `Production E2E` (chỉ đọc; có hiệu lực khi M3 Task 17 merge).
- Preview và Dev được kiểm tự động (E2E, smoke) bằng workflow CI chạy sau mỗi deploy, thêm ở M2. Workflow cần GitHub secret `VERCEL_AUTOMATION_BYPASS_SECRET`; chủ dự án đã tạo secret này ngày 2026-11-20 (có trong Vercel và GitHub Actions).
- Secret nằm ngoài repo: `/home/claude/secrets/` (workspace); `~/Projects/.youtrack-token`, `~/Projects/.github-token` (trên Mac).

### GitHub trong workspace

GraphQL bị chặn bởi proxy của phiên, nên dùng REST:

- Mở PR ticket: `gh api repos/chinhpham208/next-store/pulls -f title=… -f head=NS-xx-… -f base=develop -f body=…`
- Check: `gh api repos/chinhpham208/next-store/commits/<sha>/check-runs`
- Trước mọi merge: `bash scripts/pr-gate.sh <n>` phải thoát 0 (§2, "Cổng merge").
- Merge PR ticket (chỉ Orchestrator): `gh api -X PUT repos/chinhpham208/next-store/pulls/<n>/merge -f merge_method=squash`
- Release (chỉ Orchestrator, sau khi chủ dự án duyệt):
  - Mở PR: `gh api repos/chinhpham208/next-store/pulls -f title="Release v0.x.y" -f head=develop -f base=production -f body=…`
  - Merge: `gh api -X PUT repos/chinhpham208/next-store/pulls/<n>/merge -f merge_method=merge` (merge commit, **không** squash)
  - Tag trên merge commit (`merge_commit_sha` trong kết quả merge): `gh api repos/chinhpham208/next-store/git/refs -f ref=refs/tags/v0.x.y -f sha=<merge_commit_sha>`
- Hotfix: PR `head=hotfix/NS-xx-…`, `base=production`, `merge_method=merge`, rồi tag. Back-merge: tạo nhánh tạm từ `production` — `gh api repos/chinhpham208/next-store/git/refs -f ref=refs/heads/sync/production-to-develop-v0.x.y -f sha=<sha của production>` — rồi PR `head=sync/production-to-develop-v0.x.y`, `base=develop`, `merge_method=merge`. Không dùng `production` làm head (sẽ bị tự xoá sau khi merge).
- Cài đặt repo: nhánh mặc định `develop`; cho phép squash và merge commit, tắt rebase; nhánh head tự xoá sau khi merge (nhánh mặc định không bị xoá). Thường không cần xoá nhánh thủ công; nếu còn nhánh cần xoá, lệnh xoá qua proxy bị chặn → Orchestrator xử lý.
- Branch protection / ruleset chưa bật (repo public dùng được miễn phí, xem §8), nên quy tắc "chỉ merge khi `pr-gate.sh` qua và review đã duyệt", đúng base và đúng merge method do Orchestrator đảm bảo. Nếu chủ dự án nâng lên GitHub Pro, xem §8.

## 6. Cuối mỗi mốc

Orchestrator ghi ngắn vào `docs/retro/M<n>.md`: điều gì chậm, vòng review nào lặp, leo thang nào, đề xuất chỉnh quy trình. Chủ dự án duyệt các đề xuất trước mốc tiếp theo.

## 7. File vai của agent

Định nghĩa vai nằm ở `docs/agents/*.md` (định dạng frontmatter của Claude Code). Orchestrator giao việc bằng cách đưa nội dung file vai vào prompt của agent tương ứng. Muốn dùng trực tiếp trong Claude Code, chủ dự án sao chép thư mục này thành `.claude/agents/` (Claude không được phép ghi vào `.claude/` từ xa).

## 8. Việc của chủ dự án (NS-111)

1. **Neon API key cho workflow dọn nhánh.** GitHub → repo `chinhpham208/next-store` → Settings → Secrets and variables → Actions:
   - tab **Secrets** → New repository secret `NEON_API_KEY`: API key tạo trong Neon console (hộp thoại "Create new API key", Key scope **Project-scoped**, ADR-0010 dữ kiện 5) cho project đang chứa các nhánh `preview/*`;
   - tab **Variables** → New repository variable `NEON_PROJECT_ID` = `frosty-queen-67078672` (không phải secret).

   Thiếu secret thì workflow `Neon preview cleanup` **fail** với thông báo "thiếu secret NEON_API_KEY", không bỏ qua âm thầm. Sau khi thêm, chạy tay một lần: Actions → Neon preview cleanup → Run workflow, tích `dry_run`, xem danh sách nhánh sẽ xoá, rồi chạy lại không tích.

   Lưu ý ADR-0010 (audit L3): khi resource 2 (project Neon riêng cho Preview, M3 Task 5 / NS-61) đã nối, các nhánh `preview/*` nằm ở project đó: đổi `NEON_PROJECT_ID` sang id của project resource 2 và thay key bằng key project-scoped của project đó. Tới lúc ấy, preview vẫn nằm trong `frosty-queen-67078672` (project production), nên key tạm thời gắn với project production; script không bao giờ xoá `main` hay nhánh mặc định / protected.
2. **Ruleset (miễn phí khi repo public; nếu repo chuyển lại riêng tư thì cần GitHub Pro).** Settings → Rules → Rulesets → New branch ruleset, một cho `develop`, một cho `production`: bật "Require status checks to pass", thêm đúng các tên sau (như chúng hiện trên GitHub):
   - `develop`: `check`, `e2e-preview` (GitHub Actions), `Vercel` (commit status của Vercel);
   - `production`: `check`, `e2e-preview`, `Vercel`, `release-smoke`.

   GitHub coi một required check bị **skipped** là qua, nên ruleset một mình không chặn được ca #87 / #89 qua `e2e-preview`; `Vercel` = failure thì có. `scripts/pr-gate.sh` vẫn là cổng bắt buộc của Orchestrator, có hay không có ruleset.
