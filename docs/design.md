# Design: next-store

Tài liệu này mô tả **cách xây dựng** next-store. Yêu cầu (làm gì, vì sao) nằm ở [`requirements.md`](./requirements.md). Sơ đồ ở [`architecture.md`](./architecture.md). Các quyết định lớn được ghi trong [`adr/`](./adr). Quy trình làm việc của đội ở [`process.md`](./process.md).

## 1. Nguyên tắc kỹ thuật

- Dùng API hiện hành của Next.js 16: App Router, Server Components, Server Actions, Cache Components (`"use cache"`, `cacheLife`, `cacheTag`, `updateTag`), `proxy.ts`, Route Handlers.
- Dữ liệu đọc ở server; client chỉ giữ state giao diện.
- Mọi dữ liệu đi vào hệ thống (form, URL, cookie, webhook) được validate bằng Zod.
- Mọi thứ có thể kiểm tra tự động thì kiểm tra trong CI; không merge khi CI đỏ.
- Phụ thuộc bên ngoài (thanh toán, hosting, database) nằm sau interface hoặc biến môi trường, để thay được mà không sửa nghiệp vụ.

**Không dùng:** Pages Router, `getServerSideProps`, `middleware.ts`, `unstable_cache`, `revalidateTag` một tham số; React Query/SWR cho dữ liệu lấy được ở server.

## 2. Công nghệ

| Lớp | Lựa chọn |
|---|---|
| Framework | Next.js 16.4, React 19.3, TypeScript strict |
| Giao diện | Tailwind CSS v4, token lấy từ design system |
| Thiết kế | Claude Design System (token, component) + Claude Design (màn hình) |
| Dữ liệu | Drizzle ORM 0.45; PGlite ở local / CI, Postgres (Neon) ở preview / production — [ADR-0001](./adr/0001-database-pglite.md), [ADR-0005](./adr/0005-hosting.md) |
| Validate | Zod |
| Blog | `@next/mdx`, file MDX trong `content/blog` |
| Thanh toán | Interface `PaymentProvider`; hiện dùng `FakeProvider` (chế độ test); cổng Việt Nam khi mở bán — [ADR-0004](./adr/0004-payment-vietnam.md) |
| Hosting | Vercel (app) + Neon (Postgres) — [ADR-0005](./adr/0005-hosting.md) |
| Mã nguồn & CI | GitHub (repo riêng tư, PR) + GitHub Actions |
| Kiểm tra | Vitest (logic, truy vấn DB), Playwright (E2E theo tiêu chí chấp nhận, kèm kiểm tra a11y), dependency-cruiser (ranh giới module) |
| Quản lý công việc | YouTrack, project `NS` |

Quy ước code chi tiết: [`conventions.md`](./conventions.md).

## 3. Cấu trúc thư mục

```
next-store/
├─ .github/workflows/            # CI
├─ docs/
│  ├─ requirements.md · design.md · architecture.md · conventions.md · process.md
│  ├─ agents/                    # Định nghĩa vai của các agent (process.md)
│  ├─ adr/                       # Quyết định kiến trúc
│  └─ plans/                     # Plan chi tiết từng mốc
├─ content/blog/*.mdx
├─ e2e/                          # Test Playwright, đặt tên theo user story
├─ public/images/
├─ scripts/
│  ├─ verify.sh                  # Check + build + smoke, chịu được giới hạn thời gian của shell agent
│  └─ youtrack/                  # Tạo ticket, chuyển trạng thái
├─ src/
│  ├─ app/                       # CHỈ routing
│  │  ├─ (shop)/
│  │  │  ├─ layout.tsx
│  │  │  ├─ page.tsx             → /
│  │  │  ├─ products/page.tsx    → /products
│  │  │  ├─ products/[slug]/     → /products/:slug
│  │  │  ├─ cart/                → /cart
│  │  │  └─ checkout/            → /checkout/success, /checkout/test
│  │  ├─ blog/                   → /blog, /blog/:slug
│  │  ├─ admin/                  → /admin/login, /admin/products, /admin/orders
│  │  ├─ api/webhooks/payment/route.ts
│  │  ├─ layout.tsx
│  │  ├─ sitemap.ts
│  │  └─ robots.ts
│  ├─ features/                  # Logic nghiệp vụ, mỗi thư mục một miền
│  │  ├─ products/ · cart/ · checkout/ · orders/ · blog/ · admin/
│  ├─ db/                        # schema.ts, client.ts, migrate.ts, seed.ts
│  ├─ components/ui/             # Component giao diện dùng chung (theo design system)
│  ├─ lib/                       # Tiện ích không gắn nghiệp vụ
│  └─ proxy.ts
├─ drizzle/                      # Migration SQL sinh bởi drizzle-kit
├─ .dependency-cruiser.cjs
├─ .env.example
├─ next.config.ts · drizzle.config.ts · playwright.config.ts · vitest.config.ts
└─ package.json
```

### Bên trong một feature
```
features/cart/
├─ index.ts          # Cổng public: chỉ export những gì nơi khác được dùng
├─ queries.ts        # Đọc dữ liệu (server)
├─ actions.ts        # Server Actions
├─ schema.ts         # Zod schema
├─ components/       # Component của miền này
└─ *.test.ts
```

### Quy tắc phụ thuộc
1. **`app/` chỉ lo routing.** `page.tsx` mỏng: gọi hàm từ `features/`, rồi render.
2. **Chiều phụ thuộc:** `app → features → db / lib / components/ui`. Không có chiều ngược lại.
3. **Chỉ import qua `index.ts`:** nơi khác import `@/features/cart`, không import `@/features/cart/actions`.
4. **Feature được dùng feature khác qua `index.ts`**, nhưng không được tạo vòng phụ thuộc.

Quy tắc 2–4 được kiểm tra bằng dependency-cruiser (`npm run check:deps`), chạy trong CI.

Lý do chọn cấu trúc này thay vì đặt component cạnh route: dễ mở rộng khi thêm miền nghiệp vụ, logic của một miền nằm ở một chỗ, và có thể tách `features/` + `db/` thành backend riêng nếu sau này cần (ví dụ có app mobile). Đánh đổi: đọc một trang phải mở cả `app/` lẫn `features/`.

## 4. Mô hình dữ liệu

| Bảng | Cột chính |
|---|---|
| `categories` | id, slug, name |
| `products` | id, slug, name, description, price (số nguyên, VND), image, categoryId, stock, featured, updatedAt |
| `carts` | id (uuid, lưu trong cookie httpOnly), createdAt |
| `cart_items` | cartId, productId, quantity |
| `orders` | id (serial — dùng làm mã đơn gửi cổng thanh toán), items (json snapshot), total, status (`pending` \| `paid` \| `needs_refund` \| `cancelled`), provider, paymentRef (unique), createdAt |

Bài blog là file MDX, không nằm trong DB. Schema thay đổi bằng migration của drizzle-kit (file SQL trong `drizzle/`), không sửa DB bằng tay.

## 5. Các luồng chính

### Giỏ hàng
- Lần đầu thêm sản phẩm: tạo `carts`, lưu id vào cookie httpOnly, `SameSite=Lax`, `Secure` trên production.
- Thêm / sửa / xoá bằng Server Actions; validate bằng Zod; kiểm tra tồn kho.
- Giao diện dùng `useOptimistic` để cập nhật ngay, rồi đồng bộ với kết quả từ server.

### Thanh toán
1. Khách bấm thanh toán → Server Action kiểm tra tồn kho, tạo `orders` trạng thái `pending`, gọi `PaymentProvider.createCheckout()`.
2. Khách được chuyển tới trang thanh toán của provider (hiện tại: `/checkout/test` của `FakeProvider`, có nhãn rõ "Môi trường thử nghiệm — không thu tiền").
3. Provider gọi `/api/webhooks/payment`. Route Handler xác minh chữ ký, rồi trong một transaction: đổi đơn sang `paid`, trừ kho bằng câu lệnh có điều kiện `stock >= quantity`, xoá giỏ.
4. Kho không đủ (hai người cùng mua món cuối): đơn chuyển `needs_refund`.
5. `paymentRef` unique → webhook gửi lặp chỉ được xử lý một lần.
6. Sau khi trừ kho: `revalidateTag('product:<slug>', 'max')` cho các sản phẩm liên quan (Route Handler không gọi được `updateTag`; `updateTag` chỉ dùng trong Server Action).
7. Khách huỷ ở trang thanh toán → đơn `cancelled`, giỏ giữ nguyên.

Luồng này không phụ thuộc provider cụ thể; xem ADR-0004.

### Admin
- Đăng nhập bằng `ADMIN_PASSWORD` → cookie phiên ký HMAC (Web Crypto) bằng `SESSION_SECRET`.
- `proxy.ts` chặn `/admin/*` (trừ `/admin/login`) nếu cookie không hợp lệ; mọi Server Action của admin kiểm tra lại phiên (không dựa riêng vào proxy).
- Trang admin có `robots: noindex`.
- Sửa sản phẩm → Server Action cập nhật DB, gọi `updateTag`.

Biến môi trường đầy đủ: [`.env.example`](../.env.example).

## 6. Chiến lược cache

Cache Components (`cacheComponents: true`) bật **từ M1**: mặc định mọi thứ động, muốn cache phải khai báo. Chi tiết: [ADR-0003](./adr/0003-cache-strategy.md).

Lưu ý trên Vercel: cache của `"use cache"` nằm trong bộ nhớ từng instance, không bền giữa các instance. Trang cần nhanh ổn định thì prerender (`generateStaticParams`); nếu sau này cần cache dùng chung giữa instance, cân nhắc `"use cache: remote"` (ADR riêng).

| Dữ liệu | Cách xử lý |
|---|---|
| Danh mục, danh sách sản phẩm | `"use cache"`, `cacheLife('hours')`, `cacheTag('products')` |
| Chi tiết sản phẩm (gồm tồn kho) | `"use cache"`, `cacheTag('product:<slug>')`; làm mới bằng `updateTag` khi admin sửa (Server Action), `revalidateTag` khi webhook trừ kho (Route Handler); `generateStaticParams` để prerender |
| Số lượng trong giỏ, nút thêm vào giỏ | Đọc cookie → động, bọc `<Suspense>`; vỏ trang vẫn tĩnh |
| Blog | Tĩnh |
| Trang admin, giỏ hàng, checkout | Động hoàn toàn |

## 7. Môi trường

| Môi trường | Ở đâu | Database | Dữ liệu | Thanh toán |
|---|---|---|---|---|
| **Local** | Máy dev | PGlite (`.data/`) | Seed | Fake |
| **CI** | GitHub Actions | PGlite (`memory://` / thư mục tạm) | Seed | Fake |
| **Preview** | Vercel, một URL cho mỗi PR | Neon branch riêng cho mỗi PR | Seed | Fake |
| **Production** | Vercel, domain chính | Neon nhánh chính | Seed lần đầu, sau đó admin quản lý | Fake (đến khi mở bán) |

- Bước build trên Vercel: `npm run build:vercel` = migrate → seed (bỏ qua khi production đã có dữ liệu) → `next build`. Production được seed trước lần build đầu tiên có trang đọc DB.
- Seed **không bao giờ** chạy trên production sau lần khởi tạo. Script seed dùng danh sách cho phép: PGlite luôn được seed; Postgres chỉ được seed khi `VERCEL_ENV=preview` hoặc có cờ `--allow-production` — mọi trường hợp khác (không đặt, sai chính tả, VPS) bị coi là production và bị từ chối trước mọi câu lệnh DB.
- Secret chỉ nằm trong biến môi trường của Vercel và GitHub Secrets.
- Kết nối tới DB không phải local luôn dùng TLS `verify-full`: server phải trình chứng chỉ do CA công khai cấp, khớp đúng hostname trong `DATABASE_URL` (Neon đáp ứng). Host là địa chỉ IP hoặc chứng chỉ tự ký (VPS) cần thêm `sslrootcert=<đường dẫn CA>` — hostname vẫn được kiểm.
- Host local (`localhost`, `127.0.0.1`, `::1`): `sslrootcert` **không** bật TLS. Thiếu `sslmode` / `ssl` (hoặc `disable` / `false`) nghĩa là không TLS, kể cả khi có `sslrootcert`; muốn TLS tới DB local thì ghi rõ `sslmode=verify-full` (hoặc `require` / `prefer` / `allow`).
- Mật khẩu trống trong URL nghĩa là driver lấy `PGPASSWORD` rồi `.pgpass`; URL trên Vercel/Neon phải chứa mật khẩu.

## 8. Các mốc

Mỗi mốc: thiết kế màn hình (nếu có giao diện mới) → plan (`docs/plans/M<n>.md`) → ticket → code theo PR → QA → deploy preview → demo cho chủ dự án → merge và deploy production. Chi tiết quy trình: [`process.md`](./process.md).

| Mốc | Nội dung | User stories |
|---|---|---|
| **M1 Nền tảng & đường ống** | Design system + màn hình trang chủ; khởi tạo dự án, cấu trúc, dependency-cruiser, Cache Components; schema + seed; layout, trang chủ; GitHub + CI; Playwright; Vercel + Neon, deploy production đầu tiên | US-01 |
| **M2 Danh mục sản phẩm** | Lọc / sắp xếp / tìm / phân trang qua URL, trang chi tiết, loading / error / not-found | US-02 → US-05 |
| **M3 Blog & SEO** | Blog MDX, metadata, OG image, sitemap, robots | US-10, US-11 |
| **M4 Giỏ hàng** | Cookie giỏ hàng, Server Actions, `useOptimistic`, kiểm tra tồn kho | US-06 → US-08 |
| **M5 Admin** | Đăng nhập admin, `proxy.ts`, sửa sản phẩm + `updateTag`, header bảo mật | US-12, US-13 |
| **M6 Thanh toán & vận hành** | `PaymentProvider` + `FakeProvider`, webhook, đơn hàng, admin đơn hàng; theo dõi lỗi production, Web Vitals | US-09, US-14 |

## 9. Điều kiện hoàn thành

**Mỗi PR:** CI xanh (typecheck, lint, `check:deps`, Vitest, build, Playwright); review không còn lỗi chặn; preview deploy chạy được.

**Mỗi mốc:** mọi tiêu chí chấp nhận của các story trong mốc có test E2E hoặc test tích hợp tương ứng và đều qua; QA đã thử trên preview; chủ dự án duyệt demo; production deploy thành công.

## 10. Môi trường phát triển

- Bản làm việc của đội agent: workspace cloud `/home/claude/next-store` (dùng chung, một người viết tại một thời điểm). **Chủ dự án không chạy `npm` trong workspace này** — `node_modules` ở đây là bản Linux và PGlite chỉ cho một tiến trình truy cập.
- Chủ dự án chạy thử bằng bản clone riêng trên Mac, kéo từ GitHub `chinhpham208/next-store`, ví dụ `~/Projects/next-store-local`, hoặc xem trên preview / production.
- Không cần Docker hay tài khoản thanh toán để chạy local.
