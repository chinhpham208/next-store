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
| `NEON_PRODUCTION_ENDPOINT` | chủ dự án (Vercel → Environment Variables, cả ba environment, không bí mật) | không bắt buộc; có thì phải khớp endpoint của `DATABASE_URL` | **bắt buộc**; phải khác endpoint của `DATABASE_URL` | bỏ trống, không kiểm |

Chặn preview chạm database production (NS-36): giá trị là endpoint id của Neon branch production (`ep-…`, không có `-pooler`, không có tên miền). Khi `VERCEL` có giá trị, mọi kết nối (runtime, `db:migrate` với cả URL unpooled, `db:seed`) đều bị kiểm trước khi mở socket: preview / Dev từ chối nếu biến thiếu hoặc nếu host (bỏ `-pooler`, không phân biệt hoa thường) hay tham số `options=endpoint=` trùng endpoint production; production từ chối nếu biến có mặt mà host không phải endpoint đó. Thông báo lỗi chỉ nêu tên biến, không in URL, host hay mật khẩu.

## Smoke test và E2E trên URL thật

```bash
npm run smoke                                    # chạy next start cổng 3100 từ bản build hiện có
BASE_URL=https://next-store-dev-ginpham.vercel.app npm run smoke
BASE_URL=https://<url-preview> npm run smoke
```

URL preview của từng deploy có thể bị Vercel Deployment Protection chặn (trang đăng nhập Vercel); khi đó cần `VERCEL_AUTOMATION_BYPASS_SECRET` (script gửi header `x-vercel-protection-bypass`, không in giá trị). Thiếu secret, smoke báo rõ là bị Deployment Protection chặn. `SMOKE_TEXT` đổi chuỗi cần có trên trang chủ.

E2E Playwright (từ Task 10 của M1) dùng cùng `BASE_URL` và `VERCEL_AUTOMATION_BYPASS_SECRET`.

### Tự chạy sau mỗi deploy: check `e2e-preview`

Workflow `Preview E2E` (`.github/workflows/preview-e2e.yml`) chạy smoke + E2E mỗi khi Vercel báo một deployment **không phải Production** thành công (preview của PR, Dev). Kết quả là check `e2e-preview` trên commit đã deploy:

```bash
gh api repos/chinhpham208/next-store/commits/<sha>/check-runs \
  --jq '.check_runs[] | select(.name == "e2e-preview") | {status, conclusion, html_url}'
```

Mỗi deployment có thể sinh vài check `e2e-preview` ở trạng thái `skipped` (Vercel gửi cả trạng thái `pending`); chỉ lần chạy có `conclusion` khác `skipped` là kết quả thật.

- Chạy từ sự kiện `deployment_status`: GitHub đọc workflow từ chính commit được deploy, nên PR sửa workflow này được kiểm bằng bản của chính nó.
- Chỉ kiểm URL do Vercel gửi (deployment tạo bởi `vercel[bot]`), và URL phải là `https://next-store-…-chinhpham208s-projects.vercel.app` hoặc `https://next-store-dev-ginpham.vercel.app`; khác thì job dừng trước khi dùng secret. Production không chạy ở đây.
- E2E chạy với `--trace off`: trace của Playwright ghi cả header bypass, và report được upload khi lỗi.
- Chạy tay (gỡ lỗi, hoặc khi không có sự kiện): `gh api -X POST repos/chinhpham208/next-store/actions/workflows/preview-e2e.yml/dispatches -f ref=<nhánh> -f 'inputs[base_url]=<URL trong danh sách trên>'`, hoặc nút "Run workflow" trong tab Actions. Test lấy từ `ref`, nên chọn đúng nhánh của deployment.

## Seed production

- `db:seed` với Postgres chỉ tự chạy khi `VERCEL_ENV=preview`. Mọi trường hợp khác (production, biến thiếu hoặc sai chính tả, VPS) bị coi là production và bị từ chối trước mọi câu lệnh DB.
- `build:vercel` không gọi seed khi `VERCEL_ENV=production`.
- `db:seed` bị từ chối trên production. Đường **duy nhất** được hỗ trợ để seed production là chạy SQL sinh từ `src/db/seed-data.ts` trong Neon SQL Editor, branch `main`; không ai cầm mật khẩu hay `DATABASE_URL` production trên máy.

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
