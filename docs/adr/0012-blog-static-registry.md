# ADR-0012: Blog: MDX tĩnh, registry TypeScript, 404 bằng danh sách slug trong proxy

- Trạng thái: Đã chấp nhận
- Ngày: 2026-11-22
- Quyết định của chủ dự án: 2026-11-22 (plan M3, Cổng 1, quyết định 5, 6, 7)
- Liên quan: [ADR-0003](./0003-cache-strategy.md), [ADR-0009](./0009-product-404-in-proxy.md), `docs/plans/M3.md` Task 9, 10, 13; ticket NS-63 (Task 9)

## Bối cảnh

US-10 yêu cầu `/blog` liệt kê bài mới nhất trước, `/blog/<slug>` hiện nội dung MDX đã render và slug không tồn tại trả **HTTP 404**. US-01 (M3) thêm 3 bài mới nhất lên trang chủ; US-11 cần tiêu đề, mô tả, ngày của bài cho metadata, ảnh Open Graph và sitemap. `design.md` §2 đã chọn `@next/mdx`, nội dung trong `content/blog`.

Đã kiểm trên next 16.4.6 với Turbopack và `cacheComponents` (plan M3):

- `createMDX({})(nextConfig)` không đổi `pageExtensions` (file `.mdx` không thành route), `src/mdx-components.tsx` có mặt: `import Post from '@content/blog/x.mdx'` build và render đúng, component trong `mdx-components.tsx` được áp (K1).
- Không có `remark-gfm`: bảng GFM không được dựng; khối code rào ra `<pre><code class="language-…">` (K2).
- `/blog/[slug]` có `generateStaticParams`, slug lạ, trang gọi `notFound()`: **lần đầu 200**, lần hai mới 404, mỗi slug bịa ra để lại một entry route cache; `import()` động theo slug cũng vậy (K3, giống K3 của M2).
- Proxy với danh sách slug tĩnh: slug lạ 404 ngay lần đầu cho cả HTML và RSC (K4).
- Vitest không biên dịch được `.mdx` nếu không thêm plugin ngoài plan.

## Các phương án

### Tiêu đề / mô tả / ngày của bài nằm ở đâu

| Phương án | Ưu | Nhược |
|---|---|---|
| A. Frontmatter YAML + thư viện đọc (`gray-matter`, `remark-frontmatter`…) | Mọi thứ của một bài trong một file | Thêm thư viện ngoài plan; dữ liệu đọc bằng IO lúc build, proxy không dùng được |
| B. `export const metadata` trong file MDX, kiểm bằng Zod | Không thêm thư viện | Danh sách / sitemap / proxy phải import mọi file MDX (kéo React, MDX vào proxy); Vitest không biên dịch MDX nên không test được dữ liệu |
| **C. Registry TypeScript `src/features/blog/posts.ts`, không import gì** | Test được bằng Vitest không cần MDX; proxy, sitemap, danh sách dùng chung mà không kéo MDX hay React; kiểu `PostSlug` là union của slug | Dữ liệu của một bài nằm ở hai chỗ (registry + file MDX) |

### 404 cho slug không tồn tại

| Phương án | Ưu | Nhược |
|---|---|---|
| A. `notFound()` trong trang | Không thêm thành phần | Lần đầu 200 và mỗi slug bịa ra để lại một entry cache (K3), trái tiêu chí US-10 |
| **B. `src/proxy.ts` đối chiếu `isPostSlug` (danh sách tĩnh), không chạm DB** | 404 thật ngay lần đầu, cả HTML và RSC; không IO | Mỗi request `/blog/<slug>` chạy qua proxy (một phép tra trong `Set`) |

## Quyết định

Registry C, 404 bằng proxy B, route blog nằm trong `(shop)`.

- **Nội dung:** mỗi bài một file `content/blog/<slug>.mdx`, chỉ CommonMark (không bảng, không gạch ngang, không task list), không `import` / `export`, không frontmatter, không tiêu đề cấp 1, không tài nguyên từ origin khác; mọi khối code rào ghi ngôn ngữ (đó là cách duy nhất `PROSE_COMPONENTS.code` phân biệt khối với code trong dòng). `@next/mdx` biên dịch lúc build, không plugin remark / rehype; không đổi `pageExtensions`.
- **Registry:** `src/features/blog/posts.ts` — `POSTS` `as const satisfies readonly PostMeta[]` (`slug`, `title`, `description`, `publishedAt` dạng `YYYY-MM-DD`), cùng `isPostSlug`, `getAllPosts` (mới nhất trước, cùng ngày thì slug tăng dần), `getLatestPosts`, `getPostMeta`. File **không import gì**, kể cả `import type`, để `proxy-api.ts` và Vitest dùng được.
- **Nội dung theo slug:** `src/features/blog/content.ts` — `Record<PostSlug, MDXContent>` với import tĩnh `@content/blog/<slug>.mdx` (alias `@content/*` trong `tsconfig.json`). Kiểu `Record` làm TypeScript báo lỗi khi registry có slug mà thiếu nội dung; Vitest đối chiếu thư mục `content/blog` với registry và với các import trong `content.ts`.
- **Giao diện:** `src/mdx-components.tsx` trả `PROSE_COMPONENTS` của `@/components/ui/prose` và không import feature (sẽ thành vòng `content.ts` → `.mdx` → `mdx-components` → feature).
- **404:** proxy đối chiếu `isPostSlug` (Task 13). **Khác ADR-0009** ở chỗ danh sách tĩnh là đủ: bài chỉ đổi khi build và deploy, không có bài tạo lúc chạy, nên không cần truy vấn DB, không có fail-open và không có cache slug dương. Phương án C mà ADR-0009 loại cho sản phẩm (sản phẩm admin tạo ở M5 sẽ 404 tới lần build sau) không áp dụng cho blog.
- **Route trong `(shop)`:** `src/app/(shop)/blog/` để dùng chung header, footer, trang lỗi với cửa hàng (lệch cây thư mục cũ của `design.md` §3, đã cập nhật).
- **Cache:** `/blog` và mọi `/blog/<slug>` prerender lúc build (`generateStaticParams`), không `"use cache"`, không tag (`design.md` §6). Ngày định dạng bằng `formatDate` với `timeZone: 'UTC'`; không giá trị nào đổi theo thời điểm build.
- **Thư viện:** `@next/mdx` 16.4.6, `@mdx-js/loader` 3.1.1, `@mdx-js/react` 3.1.1 (hai peer dependency bắt buộc của `@next/mdx`), `@types/mdx` 2.0.14 (dev), ghim chính xác. Không có gói nào chạy ở trình duyệt: bài là Server Component.

## Hệ quả

- **Thêm một bài = 3 chỗ:** một file `content/blog/<slug>.mdx`, một mục trong `POSTS`, một dòng import trong `content.ts`. Quên một trong ba thì Vitest `every post has exactly one .mdx file and the other way round` / `content.ts imports every post file once, by its own slug` hoặc `tsc` (`Record<PostSlug, …>`) báo lỗi, không đợi tới lúc bài không hiện trên production.
- **Chưa có** bảng GFM, ảnh trong bài, tô màu cú pháp, mục lục / anchor tiêu đề, bài nháp hay hẹn giờ đăng, thời gian đọc: mỗi thứ cần thư viện hoặc thiết kế mới → quyết định của chủ dự án.
- `content.ts` không chạy trong Vitest; phần render của MDX được kiểm bằng `next build` và E2E (Task 10, 14).
- Proxy chỉ được chạm `posts.ts` qua `proxy-api.ts`: dependency-cruiser `proxy-narrow-entry` cấm (bắc cầu) `content.ts`, `@mdx-js/*`, `@next/mdx` cùng các mục cũ.
- Đổi slug của một bài làm link cũ thành 404 (không có redirect): cần thì thêm `redirects` trong `next.config.ts`, quyết định riêng.
