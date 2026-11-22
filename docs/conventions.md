# Quy ước code: next-store

Đọc file này trước khi viết hoặc review code. Những quy tắc có thể kiểm tra tự động đều được kiểm tra bằng `npm run check`.

## 1. Cấu trúc và phụ thuộc

- `src/app/` chỉ chứa file routing của Next.js (`page.tsx`, `layout.tsx`, `loading.tsx`, `error.tsx`, `not-found.tsx`, `route.ts`, `sitemap.ts`, `robots.ts`, `opengraph-image.tsx`). Logic nằm ở `src/features/`.
- `src/mdx-components.tsx` (bắt buộc với `@next/mdx`) chỉ trả `PROSE_COMPONENTS` của `@/components/ui/prose`, không import feature (sẽ thành vòng `content.ts` → `.mdx` → `mdx-components`). Bài blog là `content/blog/<slug>.mdx`, import qua alias `@content/*` và chỉ từ `src/features/blog/content.ts`.
- Chiều phụ thuộc: `app → features → db | lib | components/ui`. Không có chiều ngược lại. *(dependency-cruiser)*
- Ngoài một feature, chỉ import feature đó qua `@/features/<tên>` (file `index.ts`), không import sâu vào bên trong. *(dependency-cruiser)* Ngoại lệ duy nhất: `src/proxy.ts` import `@/features/<tên>/proxy-api` (lối vào hẹp, không kéo component / zod vào bundle của proxy) và không bao giờ import `index.ts` — [ADR-0009](./adr/0009-product-404-in-proxy.md).
- Không có vòng phụ thuộc. *(dependency-cruiser)*
- Luôn dùng alias `@/` thay cho đường dẫn tương đối đi ra khỏi thư mục hiện tại (`../../`).

### Bên trong một feature

| File | Chứa gì |
|---|---|
| `index.ts` | Chỉ re-export public API |
| `queries.ts` | Hàm đọc dữ liệu (server) |
| `actions.ts` | Server Actions (`"use server"`) |
| `schema.ts` | Zod schema cho dữ liệu đầu vào |
| `types.ts` | Kiểu dùng chung trong feature |
| `metadata.ts` | Dựng `Metadata` của trang từ dữ liệu feature (`generateMetadata` của `page.tsx` gọi vào) |
| `slug-guard.ts` | Kiểm slug tồn tại, không cache, cho `src/proxy.ts` trước khi render |
| `posts.ts` | Registry nội dung tĩnh (blog): mảng `as const` và hàm đọc đồng bộ; **không import gì** để `proxy-api.ts` và Vitest dùng được |
| `content.ts` | Ánh xạ slug → nội dung MDX bằng import tĩnh, kiểu `Record<Slug, MDXContent>`; không test bằng Vitest (không biên dịch MDX), proxy không được chạm |
| `components/` | Component của miền |
| `*.test.ts` | Test, đặt cạnh file được test |

## 2. Server và client

- Mặc định là Server Component. Chỉ thêm `"use client"` khi cần state, effect, event handler hoặc API trình duyệt, và đặt nó ở component **nhỏ nhất** có thể.
- File chạm vào DB, secret hoặc cookie phải bắt đầu bằng `import 'server-only'`.
- Ngoài `src/db`, truy vấn chỉ chạy qua `dbQuery` của `@/db`; `name` là hằng `<miền>.<việc>`, không chứa dữ liệu người dùng. `@/db` không export `db` thô; chỉ test được import `@/db/client`. *(dependency-cruiser `db-internals-stay-in-db`)* — [ADR-0011](./adr/0011-db-query-wrapper.md).
- Không fetch phía client (React Query, SWR, `useEffect` + `fetch`) cho dữ liệu lấy được ở server.
- Ghi dữ liệu bằng Server Actions; Route Handler chỉ dùng cho request từ bên ngoài (webhook).
- Mọi dữ liệu từ form, URL, cookie, webhook đều validate bằng Zod trước khi dùng.
- Không dùng: Pages Router, `getServerSideProps`, `middleware.ts`, `unstable_cache`, `revalidateTag` một tham số.

## 3. TypeScript

- `type`, không dùng `interface`.
- Không `any`; dùng `unknown` rồi thu hẹp kiểu.
- Không ép kiểu `as` (trừ `as const`). Cần thu hẹp thì dùng type guard hoặc Zod.
- Bật `strict` và `noUncheckedIndexedAccess`.
- Union của chuỗi thay cho `enum`. `switch` trên union phải đầy đủ, nhánh `default` gọi `assertNever`.
- Kiểu dữ liệu DB lấy từ schema Drizzle (`$inferSelect`, `$inferInsert`), không khai báo lại bằng tay.

## 4. Hàm và component

- Const arrow function: `export const getProduct = async (slug: string) => { … }`.
- Named export. Ngoại lệ: file quy ước của Next.js (`page.tsx`, `layout.tsx`, `next.config.ts`, …) bắt buộc `export default`.
- Hàm làm một việc; dùng guard clause, tránh `if` lồng nhau.
- Hàm có hơn 2 tham số thì nhận một object.
- Props của component khai báo bằng `type <TênComponent>Props`.

## 5. Đặt tên

| Thứ | Quy ước | Ví dụ |
|---|---|---|
| File, thư mục | kebab-case | `product-card.tsx` |
| Component, type | PascalCase | `ProductCard`, `ProductSummary` |
| Hàm, biến | camelCase, động từ cho hàm | `getFeaturedProducts` |
| Hằng số cấp module | SCREAMING_SNAKE_CASE | `PAGE_SIZE` |
| Server Action | động từ + `Action` | `addToCartAction` |
| Cache tag | `<miền>` hoặc `<miền>:<id>` | `products`, `product:ao-git` |
| Bảng, cột DB | snake_case | `cart_items`, `updated_at` |

## 6. Giao diện

- Tailwind utility class; class có điều kiện dùng `cn()`.
- Không dùng giá trị tuỳ ý (`w-[37px]`) khi có token tương ứng.
- Văn bản hiển thị bằng tiếng Việt; tiền tệ luôn qua `formatPrice`.
- Ảnh dùng `next/image`, luôn có `alt`.

## 7. Test

- Vitest cho logic thuần và truy vấn DB (PGlite `memory://`).
- Playwright cho E2E trong `e2e/`, mỗi file một user story (`e2e/us-02-filter.spec.ts`), có kiểm tra a11y bằng axe.
- Test đặt cạnh file được test, tên `*.test.ts`.
- Tên test mô tả hành vi: `it('rejects quantity above stock')`.
- Mỗi tiêu chí chấp nhận trong `requirements.md` có ít nhất một test (E2E hoặc tích hợp); tên test ghi mã story.

## 8. Git và PR

Chi tiết và lý do: [ADR-0006](./adr/0006-branch-strategy.md).

| Nhánh | Vai trò | Thay đổi bằng |
|---|---|---|
| `main` | Nền khởi tạo, **đóng băng** ở `40f402f`; không deploy | Không bao giờ |
| `develop` | Nhánh mặc định, tích hợp hằng ngày; deploy môi trường Dev | PR ticket, **squash** |
| `production` | Deploy Production | Release PR từ `develop` hoặc hotfix PR, **merge commit** |
| `NS-<số>-<mô-tả-ngắn>` | Một ticket, tạo từ `develop` mới nhất, ví dụ `NS-23-db-schema` | Push của Implementer |
| `hotfix/NS-<số>-<mô-tả-ngắn>` | Sửa gấp Production, tạo từ `production` | Push của Implementer |
| `sync/production-to-develop-v0.x.y` | Nhánh tạm để back-merge sau hotfix, tạo từ `production` | Orchestrator tạo |

- Không commit hay push thẳng vào `develop`, `production`, `main`; mọi thay đổi đi qua PR, CI phải xanh. Chỉ Orchestrator merge.
- Thông điệp commit theo Conventional Commits, có mã ticket ở cuối dòng đầu: `feat(db): add schema and seed NS-23`. Các loại: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`, `ci`.
- PR: tiêu đề `NS-23 <tóm tắt>`; mô tả gồm link ticket, thay đổi chính, cách kiểm tra, tiêu chí chấp nhận được đáp ứng; nhỏ (mục tiêu < 400 dòng thay đổi, không tính file sinh tự động).
- **Merge method:** PR ticket vào `develop` → **squash**. Release PR (`develop → production`), hotfix PR (vào `production`) và back-merge PR (vào `develop`) → **merge commit**, không bao giờ squash, để `develop` và `production` giữ lịch sử chung. Rebase bị tắt.
- **Phiên bản:** tag `v0.<mốc>.<n>`; `n` bắt đầu từ 0 cho release đầu tiên của mốc và tăng 1 cho mọi release sau trong cùng mốc (trung gian, cuối mốc hoặc hotfix). Tag không bao giờ bị di chuyển hay tái sử dụng. Release cuối mốc là tag cuối cùng của mốc (M1: `v0.1.0`, rồi `v0.1.1`, `v0.1.2`, …).
- **Release:** release PR `head=develop`, `base=production`, bất cứ lúc nào cần đưa thay đổi lên Production; chủ dự án duyệt; merge commit; tag `v0.<mốc>.<n>` theo quy tắc trên, đặt trên merge commit.
- **Hotfix:** `hotfix/NS-xx-…` từ `production` → PR vào `production` (merge commit) → tag `v0.<mốc>.<n>` với `n` tiếp theo → back-merge: nhánh `sync/production-to-develop-v0.1.1` trỏ vào `production`, PR vào `develop` (merge commit). Không dùng `production` làm head của PR: repo tự xoá nhánh head sau khi merge.
- Nhánh head tự xoá sau khi merge (trừ `develop`, là nhánh mặc định).
- `npm run check` phải qua trước khi push.

## 9. Tài liệu

- Quyết định kiến trúc mới → ADR mới trong `docs/adr/` (đánh số tăng dần, không sửa ADR cũ; thay đổi thì viết ADR mới "thay thế ADR-xxxx").
- Mỗi mốc có `docs/plans/M<n>.md`, viết và được duyệt trước khi code.
- Comment trong code giải thích **vì sao**, không giải thích code làm gì.

## 10. Migration

- `db:migrate` chạy trong bước build của **mọi** deploy, trước khi code mới nhận request. Trong lúc đó và khi rollback, **code cũ vẫn chạy trên schema mới**. Hai build cùng lúc có thể cùng migrate.
- **Expand** (làm cùng release với code dùng nó): thêm bảng, thêm cột nullable hoặc có `DEFAULT`, thêm index, thêm ràng buộc mà dữ liệu hiện có đã thoả.
- **Contract** (chỉ ở release **sau** release cuối cùng còn code đọc / ghi đối tượng đó):
  - `DROP TABLE`, `DROP COLUMN` (kể cả `ALTER TABLE t DROP c` không có từ `COLUMN`), `RENAME`, đổi kiểu cột (`ALTER COLUMN … TYPE`), `TRUNCATE`.
  - `ALTER COLUMN … SET NOT NULL`; `ALTER TABLE … ADD [COLUMN] … NOT NULL` không có `DEFAULT`, `GENERATED` hoặc kiểu serial.
  - `ALTER COLUMN … DROP DEFAULT`, `DROP INDEX`, `DROP CONSTRAINT`, `DROP TYPE / SCHEMA / VIEW / SEQUENCE`, `SET SCHEMA`, `REVOKE`.
  - `DELETE FROM` và `UPDATE` không có `WHERE` của chính câu đó (kể cả trong CTE, khi bảng có alias hoặc `ONLY`). `WHERE` nằm trong subquery không tính.
  - `EXECUTE` SQL động (trừ `EXECUTE FUNCTION` / `PROCEDURE` của trigger): không đọc được lúc kiểm nên coi là contract.
  - File migration phải có dòng `-- contract: NS-<số>` ghi ticket của bước expand tương ứng. Một dòng cho cả file: Auditor kiểm từng câu lệnh contract trong file khớp ticket đó.
- `src/db/migrations.test.ts` chỉ là lưới thứ hai: nó dò bằng regex trên SQL đã bỏ comment và chuỗi, nên không hiểu hết cú pháp (ví dụ chuỗi dollar-quote được đọc như code). Auditor vẫn đọc từng câu của mọi `drizzle/*.sql`, test xanh không thay việc đó.
- `CREATE INDEX` (không `CONCURRENTLY`) và `ADD CONSTRAINT` khoá bảng khi chạy; không nằm trong danh sách trên nhưng Auditor đánh giá riêng với `orders` và `cart_items` trước khi merge.
- Backfill dữ liệu là migration riêng, chạy lại được, không nằm chung file với đổi schema.
- Không sửa hay xoá file `drizzle/*.sql` đã merge; sai thì viết migration mới.
- PR có `drizzle/*.sql`: Auditor bắt buộc; mô tả PR ghi từng câu lệnh thuộc expand hay contract và code nào đang chạy còn dùng đối tượng bị đổi. Migration chỉ lên production qua release PR.
- Bảng mới tự có quyền cho role app nhờ `ALTER DEFAULT PRIVILEGES` (có hiệu lực từ khi M3 Task 4–5 xong); migration không tự `GRANT`.
