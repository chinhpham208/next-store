# Quy ước code: next-store

Đọc file này trước khi viết hoặc review code. Những quy tắc có thể kiểm tra tự động đều được kiểm tra bằng `npm run check`.

## 1. Cấu trúc và phụ thuộc

- `src/app/` chỉ chứa file routing của Next.js (`page.tsx`, `layout.tsx`, `loading.tsx`, `error.tsx`, `not-found.tsx`, `route.ts`, `sitemap.ts`, `robots.ts`, `opengraph-image.tsx`). Logic nằm ở `src/features/`.
- Chiều phụ thuộc: `app → features → db | lib | components/ui`. Không có chiều ngược lại. *(dependency-cruiser)*
- Ngoài một feature, chỉ import feature đó qua `@/features/<tên>` (file `index.ts`), không import sâu vào bên trong. *(dependency-cruiser)*
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
| `components/` | Component của miền |
| `*.test.ts` | Test, đặt cạnh file được test |

## 2. Server và client

- Mặc định là Server Component. Chỉ thêm `"use client"` khi cần state, effect, event handler hoặc API trình duyệt, và đặt nó ở component **nhỏ nhất** có thể.
- File chạm vào DB, secret hoặc cookie phải bắt đầu bằng `import 'server-only'`.
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

- `main` luôn deploy được; được bảo vệ: chỉ merge qua PR, CI phải xanh.
- Mỗi ticket một nhánh: `NS-<số>-<mô-tả-ngắn>`, ví dụ `NS-23-db-schema`. Tạo từ `main` mới nhất.
- Thông điệp commit theo Conventional Commits, có mã ticket ở cuối dòng đầu: `feat(db): add schema and seed NS-23`. Các loại: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`, `ci`.
- PR: tiêu đề `NS-23 <tóm tắt>`; mô tả gồm link ticket, thay đổi chính, cách kiểm tra, tiêu chí chấp nhận được đáp ứng; nhỏ (mục tiêu < 400 dòng thay đổi, không tính file sinh tự động).
- Merge bằng **squash**; xoá nhánh sau khi merge.
- `npm run check` phải qua trước khi push.

## 9. Tài liệu

- Quyết định kiến trúc mới → ADR mới trong `docs/adr/` (đánh số tăng dần, không sửa ADR cũ; thay đổi thì viết ADR mới "thay thế ADR-xxxx").
- Mỗi mốc có `docs/plans/M<n>.md`, viết và được duyệt trước khi code.
- Comment trong code giải thích **vì sao**, không giải thích code làm gì.
