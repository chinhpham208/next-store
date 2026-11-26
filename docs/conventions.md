# Quy ước code: next-store

Đọc file này trước khi viết hoặc review code. Những quy tắc có thể kiểm tra tự động đều được kiểm tra bằng `npm run check`.

## 1. Cấu trúc và phụ thuộc

- `src/app/` chỉ chứa file routing của Next.js (`page.tsx`, `layout.tsx`, `loading.tsx`, `error.tsx`, `not-found.tsx`, `route.ts`, `sitemap.ts`, `robots.ts`, `opengraph-image.tsx`). Logic nằm ở `src/features/`.
- `src/mdx-components.tsx` (bắt buộc với `@next/mdx`) chỉ trả `PROSE_COMPONENTS` của `@/components/ui/prose`, không import feature (sẽ thành vòng `content.ts` → `.mdx` → `mdx-components`). Bài blog là `content/blog/<slug>.mdx`, import qua alias `@content/*` và chỉ từ `src/features/blog/content.ts`.
- `opengraph-image.tsx` chỉ chọn nội dung (eyebrow, tiêu đề, footer, hình minh hoạ) và gọi `renderOgImage` của `@/lib/og-image`; bố cục, màu và font nằm ở đó. Không đọc file hay `fetch` trong route ảnh, không `generateImageMetadata` (M3 K7 → K9).
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
| `catalog-slugs.ts` | Registry slug sản phẩm (M5, thay `slug-guard.ts` cũ): mảng `as const` khớp seed và hàm tra đồng bộ; **không import gì**, để `proxy-api.ts` và Vitest dùng được; proxy không bao giờ tra DB (dependency-cruiser `proxy-no-db`) — [ADR-0017](./adr/0017-product-slug-registry-in-proxy.md) |
| `cache-tags.ts` | Mọi tag cache của feature (hằng và hàm dựng tag) và danh sách tag cho mỗi loại ghi (`tagsForProductWrite`); **không import gì**; `cacheTag` / `updateTag` chỉ dùng hằng từ đây — [ADR-0019](./adr/0019-product-edits-and-cache-tags.md) |
| `config.ts` | Đọc và kiểm biến môi trường của feature (ví dụ `readAdminConfig`); thiếu hoặc yếu → cấu hình tắt (fail-closed), không bao giờ log giá trị; `server-only` — [ADR-0018](./adr/0018-admin-auth.md) |
| `session.ts` | Ký / xác minh phiên admin bằng Web Crypto; nơi **duy nhất** ký hay xác minh token; không `server-only`, không `zod`, để proxy dùng qua `proxy-api.ts` — [ADR-0018](./adr/0018-admin-auth.md) |
| `config-rules.ts` | Luật fail-closed của cấu hình (ví dụ `resolveAdminConfig`: trim, độ dài, bằng nhau), dùng chung cho `config.ts` và `proxy-api.ts`; không `server-only`, không `zod`, không log giá trị — [ADR-0018](./adr/0018-admin-auth.md) |
| `cookie-name.ts` | Hàm thuần chọn tên cookie theo scheme của site (`adminCookieNameFor`), dùng chung cho `cookie.ts` và `proxy-api.ts` để hai phía đọc cùng một cookie; **không import gì** — [ADR-0018](./adr/0018-admin-auth.md) |
| `proxy-api.ts` | Lối vào hẹp duy nhất của `src/proxy.ts` vào feature (đường dẫn, kiểm cookie); không `server-only`, không `zod`, không DB; với admin chỉ được import `session.ts`, `config-rules.ts`, `cookie-name.ts`, `types.ts` (dependency-cruiser `admin-proxy-api-narrow`) — [ADR-0009](./adr/0009-product-404-in-proxy.md) |
| `client-ip.ts`, `login-limit.ts` | Admin (M5): đọc IP từ `x-forwarded-for` và băm HMAC (không bao giờ lưu / log IP thô); giới hạn đăng nhập sai theo IP băm và `now` (`store` của miền admin, chạy trên PGlite); `server-only` — [ADR-0018](./adr/0018-admin-auth.md) |
| `posts.ts` | Registry nội dung tĩnh (blog): mảng `as const` và hàm đọc đồng bộ; **không import gì** để `proxy-api.ts` và Vitest dùng được |
| `content.ts` | Ánh xạ slug → nội dung MDX bằng import tĩnh, kiểu `Record<Slug, MDXContent>`; không test bằng Vitest (không biên dịch MDX), proxy không được chạm |
| `store.ts` | Đọc / ghi DB của feature theo tham số (ví dụ `cartId`, `now`), không đọc cookie hay header, để test trên PGlite; `server-only`. Ghi nhiều câu dùng `dbQuery({ transaction })` — [ADR-0014](./adr/0014-cart-storage-and-cookie.md) |
| `cookie.ts` | Nơi **duy nhất** đọc / ghi cookie của feature: tên, thuộc tính, validate giá trị bằng Zod; `server-only` |
| `messages.ts` | Thông điệp hiển thị cho người dùng theo mã lỗi; chỉ import `limits.ts`, `types.ts`, để client component dùng được |
| `limits.ts` | Hằng số giới hạn (số lượng, hạn dùng); **không import gì**, để client component và Zod schema dùng chung |
| `components/` | Component của miền |
| `*.test.ts` | Test, đặt cạnh file được test |

## 2. Server và client

- Mặc định là Server Component. Chỉ thêm `"use client"` khi cần state, effect, event handler hoặc API trình duyệt, và đặt nó ở component **nhỏ nhất** có thể.
- File có `"use client"` (từ M4, [ADR-0014](./adr/0014-cart-storage-and-cookie.md)): chỉ `src/app/(shop)/error.tsx` và `src/features/cart/components/cart-provider.tsx`, `cart-link.tsx`, `add-to-cart-form.tsx`, `cart-line-controls.tsx`. M5 thêm đúng ba file: `src/features/admin/components/login-form.tsx`, `product-edit-form.tsx`, `logout-button.tsx` ([ADR-0018](./adr/0018-admin-auth.md); plan M5 Task 7, 10). File client chỉ import `react`, `next/link`, `@/components/ui/*`, `@/lib/cn`, `@/lib/format-price`, và trong `src/features/cart` chỉ `actions.ts` (tham chiếu action), `messages.ts`, `types.ts`, `limits.ts`; file client của `src/features/admin` cũng vậy với `actions.ts`, `messages.ts`, `types.ts`, `limits.ts` của admin, thêm `next/navigation` (chỉ `unstable_rethrow`: redirect của `loginAction` / `logoutAction` phải tới router khi form bắt reject, Cổng 2 M5 quyết định 6); không `index.ts`, không file có `server-only`. Thêm file client mới → sửa danh sách này cùng PR. *(Vitest `cart-ui.test.ts`, M4 Task 8; M5 Task 10 đổi thành `src/client-files.test.ts`)*
- File chạm vào DB, secret hoặc cookie phải bắt đầu bằng `import 'server-only'`.
- Ngoài `src/db`, truy vấn chỉ chạy qua `dbQuery` của `@/db`; `name` là hằng `<miền>.<việc>`, không chứa dữ liệu người dùng. `run` trả đúng một câu lệnh Drizzle; nhiều câu thì dùng `transaction` *(kiểu `DbStatement`, ADR-0013)*. Ngoài `src/db` chỉ import `@/db` (`src/db/index.ts`); `@/db` không export `db` thô; chỉ test được import `@/db/client`, `migrate`, `seed`, `seed-data`. *(dependency-cruiser `db-public-api-only`)* Chỉ `src/db` import driver (`postgres`, `@electric-sql/pglite`, `drizzle-orm/postgres-js`, `drizzle-orm/pglite`; cả `pg`, `@neondatabase/serverless` và adapter Drizzle của chúng nếu sau này cài), kể cả test. *(dependency-cruiser `db-drivers-stay-in-db`)* — [ADR-0011](./adr/0011-db-query-wrapper.md), [ADR-0013](./adr/0013-db-client-recycle.md).
- Mọi hàm `'use cache'` đều là Server Function: Next cấp action id cho nó dù không export, có `server-only` hay không có client nào import, nên ai cũng gọi được bằng POST `next-action` với đối số tuỳ ý (NS-105). Vì vậy hàm `'use cache'` hoặc **không có tham số** (Next bỏ đối số thừa), hoặc **tự validate đối số ở dòng đầu**, trước `cacheTag` và trước mọi truy vấn: sai dạng → `rejectCacheArguments(name)` (ném lỗi cố định, entry không được lưu); đúng dạng mà không có thật → kết quả rỗng + `cacheLife(SKIP_CACHE_ENTRY)` (`src/lib/cache-args.ts`). Nhánh `SKIP_CACHE_ENTRY` chỉ dành cho lời gọi thẳng: trên đường render, caller trả lời khoá không có thật **trước** khi gọi hàm cache, bằng dữ liệu cache khoá cố định (ví dụ `getCatalogSlugs()`), vì expire 0 trong prerender ISR làm route thành động và route handler trả 500 (NS-109, ADR-0003). Không dùng `notFound()` trong hàm cache để thay: entry vẫn được lưu. Không dùng object làm đối số (thuộc tính thừa là khoá mới). Không đặt `'use cache'` trên hàm mà khoá do người dùng điều khiển không bị chặn. File mới có `'use cache'` → thêm vào danh sách của `src/lib/cache-args.test.ts`. *(Vitest `cache-args.test.ts`, `listing.test.ts` "cache key rules"; E2E `ns-105-cache-functions.spec.ts`)*
- **Khu admin tự kiểm phiên ở từng lối vào** ([ADR-0018](./adr/0018-admin-auth.md) "Sửa theo audit PR #106"). Proxy chỉ là lớp lạc quan, và layout **không** bảo vệ nội dung: App Router render page song song với layout, nên trang con vẫn chạy và nội dung vẫn vào flight payload / `.segments/*.rsc` khi layout `redirect()`. Vì vậy:
  - **Chỉ những file route sau được phục vụ URL `/admin`** (audit lại PR #106, M-A): mọi file của `src/app` có một segment `admin` (bỏ qua route group, kể cả `(.)admin`, không phân biệt hoa thường) phải nằm dưới `src/app/admin/`, nên `src/app/(shop)/admin/…` bị cấm. Ngoài `(protected)` chỉ có `src/app/admin/layout.tsx` (metadata tĩnh, `noindex`), `src/app/admin/page.tsx` (redirect tĩnh) và `src/app/admin/login/page.tsx`. Dưới `(protected)`:
    - `page.{tsx,ts,jsx,js}`: `export default async function`; dòng đầu của nó và của mọi hàm export khác (`generateMetadata`…) là `await requireAdminPage()`, trước khi đọc `params`, dữ liệu hay render. Không `await` cấp module. Export dạng giá trị chỉ có `metadata` / `viewport` là object literal.
    - `layout.tsx` chỉ có một, `(protected)/layout.tsx` (`AdminGate` trong `<Suspense>`); layout lồng bị cấm (nó render song song với page, không ai kiểm).
    - `loading`, `error`, `not-found` (mọi đuôi): chỉ chữ cố định, không `async` / `await`, chỉ import `react`, `next`, `next/link`, `@/components/*`, `@/lib/cn`.
    - Cấm: `route.*` (route handler), `template`, `default`, slot `@…`, intercepting `(.)…`, ảnh metadata (`opengraph-image`, `twitter-image`, `icon`, `apple-icon`) và mọi file khác. Cần một loại mới (ví dụ xuất CSV đơn hàng ở M6) thì quyết định riêng trong ADR, sửa test cùng PR.
  - Hàm đọc dữ liệu admin nằm ở `src/features/<miền>/admin-queries.ts` (test tìm theo tên file; hàm export tên `…ForAdmin` ở file khác bị báo) và bắt đầu bằng `if (!(await hasAdminSession())) throw new Error('admin: no session')`, trước mọi truy vấn.
  - Hàm export trong page, file đọc và file action admin chỉ viết dạng `export async function f` / `export const f = async (…) => { … }`. Hàm bọc (`cache(async …)`, `withX(…)`), `export { f }`, `export default f`, class, destructuring bị báo `unsupported export form` (audit lại PR #106, M-B): hàm bọc chạy trước hàm bên trong, nên kiểm phiên không còn là bước đầu.
  - `requireAdminPage` / `hasAdminSession` được import đúng tên từ `@/features/admin` (action trong miền admin: `@/features/admin/cookie`), không alias, không khai báo lại cùng tên (tham số, biến cục bộ) (audit lại PR #106, L-a).
  - Server Action ID là toàn cục, gọi được qua `/admin/login` nơi proxy cho qua: mọi action admin (`src/features/admin/actions.ts`, `src/features/products/actions.ts`, …) trừ `loginAction` / `logoutAction` bắt đầu bằng `if (!(await hasAdminSession())) return …` (`unauthorized`), trước khi parse hay chạm DB. File `'use server'` mới (mọi đuôi `.ts/.tsx/.js/.jsx`) → xếp vào danh sách admin hay shop của test.
  - Client gọi action admin bắt reject (proxy trả 401 khi phiên hết): `unstable_rethrow(error)` rồi `window.location.assign('/admin/login')`.
  *(Vitest `src/admin-session-checks.test.ts`, đọc AST)*
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
| Cache tag | `<miền>`, `<miền>-<tập>` hoặc `<miền>:<id>`; khai báo trong `cache-tags.ts` của feature | `products`, `product-slugs` (chỉ danh sách slug, [ADR-0019](./adr/0019-product-edits-and-cache-tags.md)), `product:ao-git` |
| Bảng, cột DB | snake_case | `cart_items`, `updated_at` |

## 6. Giao diện

- Tailwind utility class; class có điều kiện dùng `cn()`.
- Không dùng giá trị tuỳ ý (`w-[37px]`) khi có token tương ứng.
- Văn bản hiển thị bằng tiếng Việt; tiền tệ luôn qua `formatPrice`.
- Ảnh dùng `next/image`, luôn có `alt`.

## 7. Test

- Vitest cho logic thuần và truy vấn DB (PGlite `memory://`).
- File test mở PGlite thật (trực tiếp hoặc qua import `@/db/client`) phải nằm trong `DB_TEST_FILES` của `vitest.config.mts` (project `db`, timeout dài hơn vì PGlite khởi động chậm khi máy tải cao). Không tăng timeout chung.
- Playwright cho E2E trong `e2e/`, mỗi file một user story (`e2e/us-02-filter.spec.ts`), có kiểm tra a11y bằng axe.
- Spec import `test` và `expect` từ `./test` (`e2e/test.ts`). Context riêng lấy từ fixture `newContext`, HTTP từ fixture `request` hay `page.request`. ESLint cấm trong spec: import `test` hay `import *` từ `@playwright/test`, `browser.newContext` / `request.newContext`, `fetch`. Trên Production, fixture huỷ request ghi của trình duyệt, ném lỗi ở `post` / `put` / `patch` / `delete` của `request` / `context.request` / `page.request`, và cho test đỏ ở teardown. Request ghi đi qua `route.continue()` của chính spec thì **chỉ bị ghi nhận, vẫn tới server**: không dùng `route.continue()` cho request ghi.
- Header bypass của Vercel (`x-vercel-protection-bypass`) chỉ do fixture của `e2e/test.ts` gắn, chỉ cho request tới đúng origin của `BASE_URL` (https, không phải Production; NS-54, `e2e/bypass.ts`). Không đặt `extraHTTPHeaders` chứa secret trong `playwright.config.ts`, `test.use` hay `newContext`: chúng gửi tới mọi origin và theo mọi redirect. Route của spec cho request tới `BASE_URL` dùng `route.fallback()`; `route.continue()` gửi đi không có header. Bước redirect của trình duyệt không mang header, kể cả cùng origin. Không bật `trace` trong `test.use` của spec (ESLint chỉ cho `'off'`): trace ghi lại secret; khi có bypass, fixture cho test bật trace đỏ.
- Test ghi dữ liệu (thêm vào giỏ, đặt hàng, sửa sản phẩm — từ M4) gắn `{ tag: '@ghi' }`; trên Production chúng bị bỏ qua (`grepInvert`). Domain production của bộ test chỉ ghi ở `e2e/production.ts` và `.github/workflows/production-e2e.yml`.
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
- **Expand** cũng gồm `ALTER COLUMN … DROP NOT NULL` (và `ALTER DOMAIN … DROP NOT NULL`): nới ràng buộc, mọi câu đọc / ghi của code cũ vẫn chạy.
- **Contract** (chỉ ở release **sau** release cuối cùng còn code đọc / ghi đối tượng đó):
  - **Mọi `DROP`**, trừ allowlist ở trên (chỉ `DROP NOT NULL`). Ví dụ: `DROP TABLE / COLUMN / INDEX / CONSTRAINT / TYPE / SCHEMA / VIEW / MATERIALIZED VIEW / SEQUENCE / POLICY / ROLE / FUNCTION / TRIGGER / DOMAIN / EXTENSION`, `ALTER TABLE t DROP c` không có từ `COLUMN`, `DROP OWNED`, `ALTER TYPE … DROP ATTRIBUTE`. Từ khoá mới thêm vào Postgres cũng rơi vào contract, không cần sửa danh sách.
  - `ALTER COLUMN … DROP DEFAULT`, `DROP IDENTITY`, `DROP EXPRESSION` **không** nằm trong allowlist, dù trông như nới ràng buộc: code cũ `INSERT` không truyền cột đó vẫn dựa vào giá trị bị bỏ. Sau khi bỏ, cột nhận `NULL`, hoặc `INSERT` lỗi nếu cột `NOT NULL` (drizzle-kit sinh `DROP IDENTITY` khi bỏ `.generatedAlwaysAsIdentity()`).
  - Allowlist phải hẹp: chỉ thêm một mục khi code release N-1 không thể nhận ra thay đổi, và ghi lý do cạnh mục đó trong `DROP_ALLOWLIST`.
  - `RENAME`, đổi kiểu cột (`ALTER COLUMN … TYPE`), `TRUNCATE`, `SET SCHEMA`, `REVOKE`.
  - `ALTER COLUMN … SET NOT NULL`; `ALTER TABLE … ADD [COLUMN] … NOT NULL` (hoặc `PRIMARY KEY`) khi hàng cũ không nhận được giá trị. Chỉ tính là có giá trị khi có `DEFAULT` khác `NULL` (`ON DELETE / UPDATE SET DEFAULT` là hành động của khoá ngoại, không phải default), `GENERATED ALWAYS / BY DEFAULT`, hoặc kiểu serial đứng ngay sau tên cột. Cột tên `serial` hay `generated` không tính.
  - `DELETE FROM` và `UPDATE` không có `WHERE` của chính câu đó (kể cả trong CTE, khi bảng có alias hoặc `ONLY`, và `CREATE RULE … DO [ALSO | INSTEAD] UPDATE`). `WHERE` nằm trong subquery không tính. `WHERE true` và `WHERE 1 = 1` (không kèm `AND`) coi như không có `WHERE`.
  - `MERGE … THEN DELETE` hoặc `THEN UPDATE`, kể cả `WHEN NOT MATCHED BY SOURCE` (xoá / sửa mọi hàng không có trong nguồn). `MERGE` chỉ `INSERT` là expand.
  - `EXECUTE` SQL động: không đọc được lúc kiểm nên coi là contract. Ngoại lệ duy nhất là `EXECUTE FUNCTION` / `PROCEDURE` trong câu `CREATE [OR REPLACE] [CONSTRAINT | EVENT] TRIGGER`; `EXECUTE function;` (biến plpgsql) vẫn là contract.
  - File migration phải có dòng `-- contract: NS-<số>` ghi ticket của bước expand tương ứng. Một dòng cho cả file: Auditor kiểm từng câu lệnh contract trong file khớp ticket đó.
- `src/db/migrations.test.ts` chỉ là lưới thứ hai: nó dò bằng regex trên SQL đã bỏ comment và chuỗi, nên không hiểu hết cú pháp và có thể lọt câu contract, không chỉ báo nhầm. Thân dollar-quote dừng ở đúng tag đóng của nó. Nếu thân đó đọc được như code thì các câu bên trong được kiểm, nên `$$TRUNCATE$$` bị báo nhầm. Nếu không đọc được thì coi là chuỗi. Chuỗi, tên, comment hay dollar-quote chưa đóng khi hết file thì được báo là contract (`unterminated …`). Báo nhầm đã biết (hướng an toàn): `DROP` trong thân hàm hay `DO` (kể cả bảng tạm), `MERGE … WHEN MATCHED AND … THEN UPDATE`. Auditor vẫn đọc từng câu của mọi `drizzle/*.sql`, test xanh không thay việc đó.
- Gọi hàm hoặc procedure do mình viết (`SELECT purge_carts();`, `CALL …`): test không đọc được thân hàm đã tạo ở migration trước. Auditor đọc thân hàm và xếp loại câu gọi theo những gì hàm làm.
- Transaction của `db:migrate` chạy với `SET LOCAL lock_timeout = '5s'` và `SET LOCAL statement_timeout = '1min'` (`src/db/migrate.ts`, NS-101): câu DDL chờ khoá quá 5 s thì lỗi `55P03`, build fail, deploy cũ vẫn phục vụ, thay vì xếp mọi truy vấn của app trên bảng đó sau nó. Build fail vì khoá: deploy lại khi bảng rảnh. Migration cần lâu hơn (backfill lớn) thì tách file và nêu trong PR; không nới giới hạn chung.
- `CREATE INDEX` (không `CONCURRENTLY`) và `ADD CONSTRAINT` khoá bảng khi chạy; không nằm trong danh sách trên nhưng Auditor đánh giá riêng với `orders` và `cart_items` trước khi merge.
- Backfill dữ liệu là migration riêng, chạy lại được, không nằm chung file với đổi schema.
- Không sửa hay xoá file `drizzle/*.sql` đã merge; sai thì viết migration mới.
- PR có `drizzle/*.sql`: Auditor bắt buộc; mô tả PR ghi từng câu lệnh thuộc expand hay contract và code nào đang chạy còn dùng đối tượng bị đổi. Migration chỉ lên production qua release PR.
- Bảng mới tự có quyền cho role app nhờ `ALTER DEFAULT PRIVILEGES` (có hiệu lực từ khi M3 Task 4–5 xong); migration không tự `GRANT`.
