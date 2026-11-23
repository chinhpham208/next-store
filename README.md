# next-store

Cửa hàng online đồ dùng cho lập trình viên (áo thun, cốc, sticker, sách), viết bằng Next.js 16 App Router, Drizzle ORM và Postgres (Neon), deploy trên Vercel.

- Production: https://next-store-iota-silk.vercel.app
- Dev (nhánh `develop`): https://next-store-dev-ginpham.vercel.app

Tài liệu: [`docs/design.md`](./docs/design.md), [`docs/architecture.md`](./docs/architecture.md), [`docs/conventions.md`](./docs/conventions.md), [`docs/process.md`](./docs/process.md).

## Chạy ở máy

Cần Node.js 22 (`.nvmrc`). Không cần cài Postgres: khi `DATABASE_URL` trống, app dùng PGlite, dữ liệu nằm trong `.data/pglite`.

```bash
npm ci
npm run db:setup   # migrate + seed vào PGlite
npm run dev        # http://localhost:3000
```

PGlite chỉ cho một tiến trình mở thư mục dữ liệu: **không chạy `db:*` (hay `build`, vì `prebuild` gọi `db:setup`) trong lúc `dev` đang chạy**. Dừng `dev` trước, chạy lệnh, rồi bật lại.

Biến môi trường: sao chép `.env.example` thành `.env.local` (mô tả từng biến nằm trong file đó).

## Scripts

| Lệnh | Làm gì |
|---|---|
| `npm run dev` | Server phát triển |
| `npm run build` | `prebuild` (`db:setup`) rồi `next build` |
| `npm run build:vercel` | Lệnh build trên Vercel (`vercel.json`): `db:migrate` → `db:seed` (bỏ qua khi `VERCEL_ENV=production`) → `next build`; không chạy `prebuild` |
| `npm start` | Chạy bản build |
| `npm run smoke` | Smoke test: `GET /` trả 200 và có chữ `next-store`, `GET /khong-ton-tai` trả 404 (xem bên dưới) |
| `npm run typecheck` / `lint` / `check:deps` / `test` | TypeScript, ESLint, dependency-cruiser, Vitest |
| `npm run check` | Cả bốn lệnh trên; phải qua trước khi push |
| `npm run db:generate` | Sinh migration SQL vào `drizzle/` từ `src/db/schema.ts` |
| `npm run db:migrate` | Chạy migration (dùng `DATABASE_URL_UNPOOLED` nếu có, cùng database với `DATABASE_URL`) |
| `npm run db:seed` | Seed dữ liệu mẫu (idempotent; quy tắc production bên dưới) |
| `npm run -s db:seed:sql` | In SQL seed production ra stdout, không kết nối database (xem "Seed production") |
| `npm run db:setup` | `db:migrate` rồi `db:seed` |

Kiểm tra đầy đủ như CI, chịu được giới hạn thời gian của shell: `bash scripts/verify.sh quick` hoặc `bash scripts/verify.sh full`.

## Môi trường

Tóm tắt [`docs/design.md`](./docs/design.md) §7.

| Môi trường | Nhánh git | Ở đâu | Database | Seed |
|---|---|---|---|---|
| Local | bất kỳ | máy dev | PGlite (`.data/pglite`) | có |
| CI | mọi PR; push vào `develop`, `production` | GitHub Actions | PGlite | có |
| Preview | mỗi PR | Vercel preview, một URL cho mỗi PR | Neon branch tự tạo cho nhánh git của PR (tích hợp Neon) | có, mỗi lần build |
| Dev | `develop` | Vercel preview, domain cố định ở trên | Neon branch tự tạo cho nhánh git `develop` (tích hợp Neon) | có, mỗi lần build |
| Production | `production` | Vercel production, domain chính | Neon nhánh chính | chỉ một lần, thủ công |

Trên Vercel, `DATABASE_URL` (pooled) và `DATABASE_URL_UNPOOLED` do tích hợp Neon đặt; thiếu `DATABASE_URL` thì build dừng thay vì lặng lẽ dùng PGlite. Kết nối tới host không phải local luôn dùng TLS đã kiểm chứng chỉ (`verify-full`).

Biến môi trường của database trên Vercel:

| Biến | Ai đặt | Production | Preview / Dev | Local, CI |
|---|---|---|---|---|
| `DATABASE_URL`, `DATABASE_URL_UNPOOLED` | tích hợp Neon | Neon nhánh chính | Neon branch của nhánh git | trống (PGlite) |
| `NEON_PRODUCTION_ENDPOINT` | chủ dự án (Vercel → Environment Variables, **một** mục chọn cả ba environment, không bí mật) | không bắt buộc; có thì phải khớp endpoint của `DATABASE_URL` | **bắt buộc**; phải khác endpoint của `DATABASE_URL` | bỏ trống, không kiểm |
| `DATABASE_APP_USER`, `DATABASE_APP_PASSWORD` | chủ dự án (Vercel → Environment Variables, **Sensitive**; mục [Role app](#role-app)) | role `next_store_app` của resource 1 | role `next_store_app` của resource 2, mật khẩu khác production; **chỉ** phạm vi Preview, không đặt ở Development | bỏ trống (role trong `DATABASE_URL`) |
| `DB_LOG` | người gỡ lỗi | **bị từ chối** (`1` làm kết nối dừng ngay) | code cho bật, nhưng **không bật** cho tới khi M3 Task 5 tách dữ liệu preview khỏi production (xem dưới) | được bật với PGlite / `localhost`; Postgres ở xa ngoài Vercel bị từ chối, kể cả khi tự đặt `VERCEL_ENV` |

Chặn preview chạm database production (NS-36): giá trị là endpoint id của Neon branch production (`ep-…`, **viết thường**, không có `-pooler`, không có tên miền); sai dạng thì mọi environment trên Vercel, kể cả production, đều từ chối kết nối. Khi `VERCEL` có giá trị, mọi kết nối (runtime, `db:migrate` với cả URL unpooled, `db:seed`) đều bị kiểm trước khi mở socket:

- preview / Dev từ chối nếu biến thiếu; nếu host (bỏ `-pooler`, không phân biệt hoa thường) hay tham số `options=endpoint=` trùng endpoint production; hoặc nếu host là của Neon (`….neon.tech`) mà không mang endpoint id `ep-…`;
- production từ chối nếu biến có mặt mà host không phải endpoint đó, hoặc `options=endpoint=` trỏ tới endpoint khác;
- mọi environment từ chối mật khẩu bắt đầu bằng `endpoint=` hoặc `project=` (cách Neon định tuyến client không có SNI, có thể dẫn tới endpoint khác với host đã kiểm).

Biến chỉ nhận **một** endpoint: đặt nó là một mục duy nhất chọn cả Production, Preview, Development (hai mục lệch giá trị thì preview mất bảo vệ mà không có tín hiệu). Thêm read replica cho branch production thì phải mở rộng lớp chặn thành danh sách trước khi bật replica. Ngoài Vercel (local, CI, VPS) lớp này không chạy. Thông báo lỗi chỉ nêu tên biến, không in URL, host hay mật khẩu.

`DB_LOG=1` in mọi câu lệnh kèm tham số (dữ liệu khách hàng) nên chỉ được bật với PGlite, Postgres trên `localhost` / `127.0.0.1` / `::1`, hoặc trên Vercel (`VERCEL` có giá trị) khi `VERCEL_ENV` là `preview` / `development`; mọi trường hợp khác (production, `VERCEL_ENV` thiếu hoặc sai chính tả, VPS, `VERCEL_ENV` tự đặt khi `VERCEL` trống) bị từ chối trước khi dựng client. Preview / Dev được phép chỉ vì database của chúng không phải production; nhưng hôm nay mỗi Neon branch preview là bản sao của `main` lúc fork, nên khi production đã có dữ liệu khách thì **không bật `DB_LOG` trên Preview / Dev** cho tới khi M3 Task 5 chuyển preview sang nhánh cha không có dữ liệu khách.

Biến SEO (`src/lib/site-url.ts`, design.md §7):

| Biến | Ai đặt | Production | Preview / Dev | Local, CI |
|---|---|---|---|---|
| `SITE_URL` | chủ dự án, **tuỳ chọn** (domain riêng, chạy ngoài Vercel) | bỏ trống: `https://` + `VERCEL_PROJECT_PRODUCTION_URL`; có thì phải là `https://<host>[:cổng]` | bỏ trống: `VERCEL_BRANCH_URL`, rồi `VERCEL_URL` | bỏ trống: `http://localhost:3000` |

`robots.txt` chỉ `Allow: /` trên build production của Vercel (`VERCEL` có giá trị và `VERCEL_ENV=production`); mọi nơi khác (Preview, Dev, local, host ngoài Vercel) là `Disallow: /` — Dev không có header `X-Robots-Tag: noindex` của Vercel (kiểm ngày 2026-11-22, NS-65), nên không dựa vào header đó được.

`SITE_URL` được đọc **lúc build** (`sitemap.xml`, `robots.txt` prerender; `metadataBase` ở root layout): đổi giá trị thì phải deploy lại. Sai dạng (có đường dẫn, query, user, `http://` tới host không phải local) thì build dừng; thông báo chỉ nêu tên biến.

## Smoke test và E2E trên URL thật

```bash
npm run smoke                                    # chạy next start cổng 3100 từ bản build hiện có
BASE_URL=https://next-store-dev-ginpham.vercel.app npm run smoke
BASE_URL=https://<url-preview> npm run smoke
```

URL preview của từng deploy có thể bị Vercel Deployment Protection chặn (trang đăng nhập Vercel); khi đó cần `VERCEL_AUTOMATION_BYPASS_SECRET` (script gửi header `x-vercel-protection-bypass`, không in giá trị). Thiếu secret, smoke báo rõ là bị Deployment Protection chặn. `SMOKE_TEXT` đổi chuỗi cần có trên trang chủ. `SMOKE_ROBOTS=disallow` bắt buộc `robots.txt` có `Disallow: /` (workflow `e2e-preview` luôn đặt), `SMOKE_ROBOTS=allow` bắt buộc `Allow: /` (khi kiểm Production); bỏ trống thì chấp nhận một trong hai và in ra. `SMOKE_PRODUCT_FAIL_OPEN=warn` (chỉ workflow `Production E2E` đặt) biến slug sản phẩm lạ đúng dạng trả 200 (lookup DB của proxy fail-open, NS-79) thành `::warning::` kèm thời gian thay vì lỗi; slug sai dạng, slug bài và ảnh OG của bài vẫn phải 404. Header `X-Robots-Tag` của `/`, `/robots.txt`, `/sitemap.xml` luôn được in, không bắt buộc.

E2E Playwright (từ Task 10 của M1) dùng cùng `BASE_URL` và `VERCEL_AUTOMATION_BYPASS_SECRET` (không gửi header bypass khi `BASE_URL` là Production).

Không có `BASE_URL`, `npm run e2e` tự chạy ba `next start` từ cùng bản build: cổng 3100; cổng 3101 với `DATABASE_URL` trỏ vào cổng đóng (trang lỗi của US-05); cổng 3102 với `DATABASE_URL` trỏ vào một listener TCP im lặng ở cổng 3103 và `DB_QUERY_TIMEOUT_MS=1000` (DB treo, NS-55). Log của hai server DB hỏng ghi vào `.verify/e2e-broken-db.log`, `.verify/e2e-hung-db.log`. Các nhóm test này bỏ qua khi có `BASE_URL`. `E2E_PORT=<n>` dời bốn cổng sang `n` … `n+3`. `scripts/verify.sh` đọc `E2E_PORT` và `SMOKE_PORT`; chỉ đặt một biến thì biến kia lấy cùng giá trị. Nó chỉ tắt tiến trình do chính nó khởi động; cổng bận bởi tiến trình khác thì dừng với lỗi.

### Tự chạy sau mỗi deploy: check `e2e-preview`

Workflow `Preview E2E` (`.github/workflows/preview-e2e.yml`) chạy smoke + E2E mỗi khi Vercel báo một deployment **không phải Production** thành công (preview của PR, Dev). Kết quả là check `e2e-preview` trên commit đã deploy:

```bash
gh api repos/chinhpham208/next-store/commits/<sha>/check-runs \
  --jq '.check_runs[] | select(.name == "e2e-preview") | {status, conclusion, html_url}'
```

Đọc kết quả:

- **Qua** khi có ít nhất một check `e2e-preview` với `conclusion == "success"` trên đúng SHA. Các lần `skipped` (trạng thái deployment khác `success`) không tính.
- **Không có check `e2e-preview` nào = chưa qua**, không phải "không áp dụng": có thể Vercel chưa deploy xong, sự kiện không tới, hoặc bước kiểm URL đã chặn.
- **Không** đặt `e2e-preview` làm required check: check này chỉ xuất hiện sau khi Vercel deploy thành công (không có khi deploy lỗi hay khi sự kiện bị tắt), nên required check sẽ treo PR. Orchestrator tự kiểm theo hai quy tắc trên trước khi merge.

- Chạy từ sự kiện `deployment_status`: GitHub đọc workflow từ chính commit được deploy, nên PR sửa workflow này được kiểm bằng bản của chính nó.
- Cần bật Vercel → Project → Settings → Git → **deployment_status Events** (bật ngày 2026-11-20, PR #23). Tắt thì Vercel chỉ gửi commit status `Vercel`, không có sự kiện nào và check `e2e-preview` không xuất hiện.
- Chỉ kiểm URL do Vercel gửi (cả deployment lẫn deployment status đều do `vercel[bot]` tạo), và URL phải là `https://next-store-…-chinhpham208s-projects.vercel.app` hoặc `https://next-store-dev-ginpham.vercel.app`; khác thì job dừng trước khi dùng secret. Production không chạy ở đây.
- E2E chạy với `--trace off`: trace của Playwright ghi cả header bypass, và report được upload khi bước e2e lỗi.
- Chạy tay (gỡ lỗi, hoặc khi không có sự kiện): `gh api -X POST repos/chinhpham208/next-store/actions/workflows/preview-e2e.yml/dispatches -f ref=<nhánh> -f 'inputs[base_url]=<URL trong danh sách trên>'`, hoặc nút "Run workflow" trong tab Actions. Test lấy từ `ref`, nên chọn đúng nhánh của deployment.

### Sau release: workflow `Production E2E`

Workflow `Production E2E` (`.github/workflows/production-e2e.yml`, M3 Task 17) chạy smoke (`SMOKE_ROBOTS=allow`: Production phải `Allow: /`; `SMOKE_PRODUCT_FAIL_OPEN=warn`: slug sản phẩm lạ fail-open chỉ cảnh báo, NS-79) rồi toàn bộ E2E trên `https://next-store-iota-silk.vercel.app`:

- Tự chạy khi Vercel báo một deployment thành công có environment đúng bằng `Production` (deployment và status đều do `vercel[bot]` tạo). Vercel gửi `ref` là SHA của commit, không phải tên nhánh, nên workflow kiểm commit đã deploy nằm trên nhánh `production` (`git merge-base --is-ancestor`, NS-78); test lấy từ commit đó. Bản preview được "Promote to Production" hay `vercel --prod` từ nhánh khác làm job đỏ ở bước kiểm này; khi đó dispatch tay. Sau release không thấy lần chạy nào (ví dụ Vercel đổi tên environment) cũng dispatch tay. Chạy tay: `gh api -X POST repos/chinhpham208/next-store/actions/workflows/production-e2e.yml/dispatches -f ref=production` (test lấy từ nhánh `production`).
- URL ghi cứng trong workflow và `e2e/production.ts`, không lấy từ sự kiện. Không dùng secret nào (Production là domain custom, không có Deployment Protection, nên không gửi header bypass), không `DATABASE_URL`, không `npm run build`, không lệnh `db:*`.
- Chỉ đọc. Khi `BASE_URL` là Production, các fixture của `e2e/test.ts` (`context`, `page`, `request`, `newContext`) làm như sau:
  - **huỷ** mọi request của trình duyệt không phải `GET` / `HEAD` / `OPTIONS` trong các context đó;
  - **ném lỗi** khi gọi `post` / `put` / `patch` / `delete`, hay `fetch` với method ghi, trên `request`, `context.request`, `page.request`;
  - **chỉ ghi nhận, không ngăn được** request ghi đi qua route mà spec tự đăng ký rồi `route.continue()` (route đăng ký sau chạy trước bộ chặn): request đó tới server;
  - mọi request bị huỷ hay ghi nhận làm test **đỏ ở teardown** ("E2E trên Production chỉ được đọc").
- Ngoài phạm vi bộ chặn, ESLint cấm trong `e2e/*.spec.ts`: `browser.newContext` / `request.newContext` (dùng fixture `newContext`), `fetch` (kể cả trong `page.evaluate`), import `test` hay `import *` từ `@playwright/test`. `e2e/production-guard.spec.ts` được tạo context và gọi `fetch`, chỉ với server Node local. Test gắn `@ghi` bị bỏ qua (`grepInvert` trong `playwright.config.ts`); đây là lớp phụ thuộc người viết nhớ gắn tag, còn bộ chặn là lớp bắt khi quên.
- Chạy tại máy: `BASE_URL=https://next-store-iota-silk.vercel.app npm run e2e` có cùng các lớp chặn.

**Rủi ro đã chấp nhận (audit PR #23):**

- Với `deployment_status`, GitHub đọc workflow từ **chính commit được deploy**, và job có quyền đọc `VERCEL_AUTOMATION_BYPASS_SECRET`. Ai push được một nhánh (hoặc có PR từ fork mà Vercel deploy) đều có thể sửa workflow trong nhánh đó để đọc secret. Chấp nhận được khi repo riêng tư và chỉ có một chủ dự án; Vercel "Git Fork Protection" phải giữ bật.
- **Xem lại khi thêm collaborator hoặc repo chuyển public.** Cách sửa: Vercel gửi `repository_dispatch` (sự kiện này chỉ chạy workflow trên nhánh mặc định), nên mã dùng secret luôn là bản đã review trên `develop`.
- Chạy tay có thể trỏ vào URL production dạng hash (không phân biệt được bằng URL); E2E hiện chỉ đọc, và chỉ người có quyền ghi mới dispatch được.

## Seed production

- `db:seed` với Postgres chỉ tự chạy trên Vercel (`VERCEL` có giá trị) khi `VERCEL_ENV=preview`, tức sau khi lớp chặn `NEON_PRODUCTION_ENDPOINT` đã kiểm URL. Mọi trường hợp khác (production, biến thiếu hoặc sai chính tả, VPS, `VERCEL_ENV=preview` tự đặt khi `VERCEL` trống) bị coi là production và bị từ chối trước mọi câu lệnh DB.
- `build:vercel` không gọi seed khi `VERCEL_ENV=production`.
- `db:seed` bị từ chối trên production và không có cờ nào để vượt qua; ngoài Vercel, `VERCEL_ENV` không có tác dụng. Đường **duy nhất** được hỗ trợ để seed production là chạy SQL sinh từ `src/db/seed-data.ts` trong Neon SQL Editor, branch `main`; không ai cầm mật khẩu hay `DATABASE_URL` production trên máy.

```bash
SEED_SQL="$(mktemp -t seed-sql.XXXXXX)"
npm run -s db:seed:sql > "$SEED_SQL"   # chỉ sinh văn bản, không kết nối database nào
npm test src/db/seed-sql.test.ts       # áp SQL vào PGlite đã migrate: cùng dòng với seed(), idempotent, escape an toàn
less "$SEED_SQL"                       # đọc lướt trước khi dán: begin; → 2 câu insert … on conflict (slug) do nothing → commit;
```

1. Mở Neon Console → SQL Editor, chọn **branch `main`**, dán toàn bộ nội dung file `$SEED_SQL`, chạy.
2. Nếu lỗi, sửa nguyên nhân rồi chạy lại: câu lệnh idempotent.
3. Kiểm: `select (select count(*) from public.categories) as categories, (select count(*) from public.products) as products;` phải ra 4 danh mục, 24 sản phẩm.
4. Xoá file: `rm -f "$SEED_SQL"`.

Câu lệnh dùng `on conflict (slug) do nothing`: chỉ thêm dòng còn thiếu theo slug, không bao giờ ghi đè dòng đã có. Dù vậy, **không** chạy lại trên production sau khi admin đã sửa dữ liệu (từ M5), trừ khi chủ dự án yêu cầu: sản phẩm admin đã xoá sẽ bị thêm lại.

## Role app

Runtime, prerender và `db:seed` đăng nhập bằng role `next_store_app`, chỉ có `SELECT / INSERT / UPDATE / DELETE` trên bảng và `USAGE / SELECT` trên sequence của schema `public` ([ADR-0010](./docs/adr/0010-app-role-and-preview-data.md), quyết định A). Host, cổng, database, TLS và `options` vẫn lấy từ `DATABASE_URL` do tích hợp Neon inject, nên mọi lớp chặn ở trên giữ nguyên; chỉ user và mật khẩu lấy từ `DATABASE_APP_USER` / `DATABASE_APP_PASSWORD`. `db:migrate` vẫn dùng role chủ của URL (DDL và default privileges thuộc role chủ). Dòng log cho biết role thật: `db:migrate: … user=neondb_owner`, `db:seed: … user=next_store_app`.

- Hai biến cùng trống: dùng role của `DATABASE_URL` (hành vi trước NS-60). Đây là bước expand; M3 Task 5 đổi `APP_ROLE_REQUIRED_ON_VERCEL` trong `src/db/client.ts` thành `true`, từ đó thiếu biến trên Vercel (mọi `VERCEL_ENV`) là lỗi build.
- Chỉ một biến có giá trị, `DATABASE_APP_USER` khác đúng `next_store_app` (tên mà hai script SQL cấp quyền và kiểm), user trùng user của `DATABASE_URL`, hay mật khẩu có ký tự điều khiển hoặc bắt đầu bằng `endpoint=` / `project=`: từ chối trước khi mở socket, thông báo chỉ nêu tên biến.
- Role này chặn `DROP`, `ALTER`, `TRUNCATE`, tạo bảng / schema / role, `setval`, đọc bảng theo dõi migration và leo quyền; **không** chặn đọc / sửa / xoá hàng loạt bằng DML (ADR-0010, audit M7). Mỗi câu lệnh của role bị cắt sau 6 giây (`statement_timeout`, ngay trên giới hạn 5 giây của `dbQuery`).
- **Role app tự đổi được mật khẩu của chính nó** (`ALTER ROLE next_store_app PASSWORD …` chạy bằng role app; Postgres không cho thu hồi quyền này, audit PR #39 L6). Một lỗ SQL injection chạy được câu lệnh xếp chồng có thể đặt mật khẩu mới rồi kết nối thẳng tới Neon từ ngoài. Phát hiện: ứng dụng bỗng không đăng nhập được (mật khẩu trên Vercel không còn khớp). Xử lý: chủ dự án đặt lại mật khẩu theo mục "Đổi mật khẩu" dưới đây trên mọi nhánh có role, rồi tìm lỗ injection.

### Tạo role và cấp quyền

Thứ tự áp dụng trên Neon / Vercel thuộc M3 Task 5 (ADR-0010, mục "Thứ tự áp dụng"). Trên mỗi nhánh Neon cần role (`main` của resource 1; nhánh mặc định của resource 2, trước khi nối resource 2 vào Preview), **chủ dự án** làm. Không agent nào thấy mật khẩu.

1. **Trên máy mình**, sinh mật khẩu ngẫu nhiên 40 ký tự chữ và số, lưu thẳng vào trình quản lý mật khẩu. Chỉ dùng ký tự ASCII (script dưới không chạy SASLprep và từ chối ký tự khác), không có khoảng trắng ở đầu / cuối (ứng dụng `trim()` mật khẩu, nên script cũng từ chối).
2. **Tính verifier SCRAM**, mật khẩu đi qua stdin (không nằm trong tham số lệnh hay lịch sử shell; script không in mật khẩu):
   ```bash
   pbpaste | node scripts/scram-verifier.mjs   # macOS, mật khẩu đang ở clipboard
   node scripts/scram-verifier.mjs             # hoặc gõ / dán (không hiện), Enter
   ```
   Kết quả là một dòng `SCRAM-SHA-256$4096:<salt>$<StoredKey>:<ServerKey>`. Verifier không phải mật khẩu, nhưng ai có nó thì dò mật khẩu ngoại tuyến được: chỉ dán vào SQL Editor, không dán vào chat, ticket hay PR.
3. **Neon SQL Editor**, đăng nhập bằng role chủ (role mà `db:migrate` dùng): `CREATE ROLE next_store_app LOGIN PASSWORD 'SCRAM-SHA-256$4096:…';`. Server lưu nguyên verifier, nên log câu lệnh, `pg_stat_statements` và lịch sử SQL Editor chỉ có verifier, không có mật khẩu.
   - **Lần đầu, thử trên một nhánh Neon tạm** (tạo từ `main`, xoá ngay sau đó): tạo role bằng verifier, rồi kiểm đăng nhập bằng mật khẩu gốc (ví dụ một bản preview dùng nhánh đó, hoặc nút "Connect" của console với role đó). Chỉ làm trên `main` khi nhánh tạm đăng nhập được.
   - **Nếu Neon từ chối verifier** (lỗi khi tạo role, hoặc nhánh tạm không đăng nhập được): dùng `PASSWORD '<mật khẩu rõ>'` trong SQL Editor, rồi xoá mục đó khỏi lịch sử của editor, không lưu query, và chạy `SELECT pg_stat_statements_reset();` nếu extension `pg_stat_statements` đã cài. Ghi vào ticket là đã dùng đường dự phòng.
   - **Không tạo role ở màn hình Roles của console**: role đó có thể là thành viên `neon_superuser`; `app-role.sql` sẽ từ chối, và role chủ không gỡ hay xoá được nó bằng SQL (thuộc tính `SUPERUSER` chỉ superuser đổi được; `REVOKE` một membership do role khác cấp chỉ báo WARNING). Không dùng `psql \password` (phải chép chuỗi kết nối role chủ của production về máy).
4. Chạy toàn bộ [`scripts/sql/app-role.sql`](./scripts/sql/app-role.sql), cùng role chủ. Trước khi cấp quyền, script kiểm:
   - role tồn tại, không có thuộc tính đặc biệt, không là thành viên role nào, không sở hữu gì;
   - role đang chạy là chủ database và chủ mọi bảng / sequence trong `public` (đối tượng của extension được bỏ qua; đối tượng lạ được nêu tên).

   Sau đó script gỡ mọi quyền cũ của role app (kể cả `WITH GRANT OPTION`, `MAINTAIN`, default privileges toàn cục) rồi cấp lại đúng DML trên bảng hiện có, default privileges cho bảng / sequence migration tạo sau này, và `statement_timeout = '6s'`. Trước khi đặt timeout, script xoá mọi cấu hình riêng của role: cấu hình toàn cục (`ALTER ROLE next_store_app RESET ALL`) và cấu hình theo từng database (`… IN DATABASE <db> RESET ALL`). Role app tự đặt được cả hai cho chính nó, và giá trị theo database được ưu tiên hơn giá trị toàn cục (audit PR #39 L-A). Cuối cùng script dừng nếu role app vẫn còn `CREATE` trên schema / database hay `TRUNCATE` / `MAINTAIN` / … qua `PUBLIC`.

   Script chạy lại được; một kiểm tra hỏng thì cả script rollback. WARNING `no privileges could be revoked / were granted for "pg_stat_statements…"` là bình thường khi extension nằm trong `public`. Trên nhánh chưa có bảng (nhánh cha của resource 2) chỉ default privileges có tác dụng; nhánh `preview/*` fork từ đó tự migrate và bảng mới tự có quyền.
5. Chạy [`scripts/sql/app-role-check.sql`](./scripts/sql/app-role-check.sql), cùng role chủ. Kết quả là một dòng:
   - nhánh **đã migrate** (`main`, `preview/develop` của resource 2): mọi cột `false`, riêng `can_dml` `true`;
   - **nhánh cha** của resource 2 (chưa có bảng): **mọi** cột `false`, kể cả `can_dml`. `missing_default_privileges = false` ở đây cho biết bảng tạo sau sẽ có quyền.
   - `role_settings_not_exact = true`: role app có cấu hình theo một database nào đó, hoặc cấu hình toàn cục khác đúng `{statement_timeout=6s}`, ví dụ do chính role app tự chạy `ALTER ROLE … IN DATABASE … SET statement_timeout = 0`. Chạy lại `app-role.sql` để gỡ, rồi tìm nguyên nhân như với đổi mật khẩu ngoài ý muốn (mục trên).
6. Đặt `DATABASE_APP_USER=next_store_app` và `DATABASE_APP_PASSWORD` (Sensitive, dán từ trình quản lý mật khẩu) trên Vercel ở đúng phạm vi (Production cho resource 1, Preview cho resource 2), rồi redeploy. Nếu mật khẩu không khớp verifier thì đăng nhập hỏng: build dừng ở prerender, bản đang chạy giữ nguyên.

### Đổi mật khẩu

Sinh mật khẩu mới và verifier như bước 1–2, rồi `ALTER ROLE next_store_app PASSWORD 'SCRAM-SHA-256$4096:…';` trên **từng** nhánh có role (cùng một verifier). Sau đó cập nhật `DATABASE_APP_PASSWORD` và redeploy ngay (ADR-0010, Hệ quả: có gián đoạn ngắn).

Mọi thao tác đặt lại trong console (ví dụ "Reset password", hay "Rotate Secrets" của tích hợp) đều có thể đổi role. Sau mỗi lần như vậy, chạy lại `app-role-check.sql` ngay. Chưa xác minh được console có cho reset role tạo bằng SQL hay không.

Rollback trước Task 5: xoá hai biến trên Vercel và redeploy là quay về role chủ.
