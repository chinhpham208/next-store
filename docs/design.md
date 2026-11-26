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
├─ content/blog/*.mdx            # Thân bài; tiêu đề / mô tả / ngày ở src/features/blog/posts.ts (ADR-0012)
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
│  │  │  ├─ blog/                → /blog, /blog/:slug (trong `(shop)`: chung header, footer, trang lỗi — ADR-0012)
│  │  │  ├─ cart/                → /cart
│  │  │  └─ checkout/            → /checkout/success, /checkout/test
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
│  ├─ mdx-components.tsx         # Bắt buộc với @next/mdx; trả PROSE_COMPONENTS của components/ui/prose
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
| `products` | id, slug, name, description, price (số nguyên, VND), image, categoryId, stock, featured, createdAt (M5: thứ tự "Mới nhất" và nổi bật, không đổi khi sửa), updatedAt (admin đặt rõ trong câu `UPDATE`; kiểm chống ghi đè khi lưu) — [ADR-0019](./adr/0019-product-edits-and-cache-tags.md). Khi có tính năng xoá: ẩn bằng `archivedAt` nullable, không xoá cứng |
| `admin_login_failures` | id (uuid do server sinh, không sequence), ipHash (HMAC-SHA256 của IP bằng `SESSION_SECRET`, không lưu IP thô), failedAt; index `(ip_hash, failed_at)` và `(failed_at)`; hàng quá 24 giờ bị xoá dần (M5) — [ADR-0018](./adr/0018-admin-auth.md) |
| `carts` | id (uuid v4 do server sinh, không default; lưu trong cookie httpOnly), createdAt, updatedAt (hết hạn 30 ngày trượt; index `carts_updated_at_idx`) — [ADR-0014](./adr/0014-cart-storage-and-cookie.md) |
| `cart_items` | cartId (FK `carts`, `ON DELETE CASCADE`), productId (FK `products`, `ON DELETE CASCADE`; index `cart_items_product_id_idx`), quantity (`CHECK quantity > 0`; trần 10 nằm ở code), createdAt (thứ tự dòng); khoá chính `(cart_id, product_id)`: một dòng mỗi sản phẩm. Không cột giá: giỏ luôn dùng giá hiện tại. Không sequence |
| `orders` | id (serial — dùng làm mã đơn gửi cổng thanh toán), items (json snapshot), total, status (`pending` \| `paid` \| `needs_refund` \| `cancelled`), provider, paymentRef (unique), createdAt |

Bài blog là file MDX, không nằm trong DB. Schema thay đổi bằng migration của drizzle-kit (file SQL trong `drizzle/`), không sửa DB bằng tay. Quy tắc expand / contract: [conventions.md](./conventions.md) §10.

## 5. Các luồng chính

### Giỏ hàng
Chi tiết và lý do: [ADR-0014](./adr/0014-cart-storage-and-cookie.md); giới hạn tốc độ: [ADR-0015](./adr/0015-edge-rate-limit.md).
- Khách vãng lai, không tài khoản. Giỏ nằm trong DB; trình duyệt chỉ giữ id giỏ (UUID v4 do server sinh bằng `crypto.randomUUID()`) trong cookie `httpOnly`, `SameSite=Lax`, `Path=/`, `Secure` và tên `__Host-ns_cart` khi site chạy HTTPS (`ns_cart` khi không), `Max-Age` 30 ngày, không `Domain`. Cookie sai dạng → coi như không có giỏ, không chạm DB. Server không bao giờ tạo giỏ với id do client gửi.
- Ba Server Action trong `src/features/cart/actions.ts` (`addToCartAction`, `setCartQuantityAction`, `removeFromCartAction`): parse Zod trước mọi thứ khác; mỗi action một `dbQuery({ transaction })` bắt đầu bằng việc khoá hàng `carts`, để mọi ghi của cùng một giỏ đi tuần tự; đặt lại cookie khi thành công (hạn 30 ngày trượt, cùng `carts.updated_at`). Lỗi nghiệp vụ được **trả về** (`CartActionResult`), không ném. Lỗi DB / hết giờ → `refresh()` rồi `unavailable`, không thử lại.
- Lần đầu thêm thành công mới tạo `carts` (bị từ chối thì không ghi gì); lúc đó dọn tối đa 50 giỏ quá hạn. Giỏ quá hạn đọc như giỏ trống. Sửa / xoá khi giỏ đã hết hạn không tạo giỏ mới.
- Tồn kho kiểm trong transaction trên dữ liệu không cache: **đã có trong giỏ + số thêm** không quá tồn kho ("Chỉ còn N sản phẩm"), mỗi dòng tối đa 10 cái, mỗi giỏ tối đa 20 loại (`src/features/cart/limits.ts`). Giảm số lượng luôn được; dòng vượt tồn kho hiện cảnh báo, không tự sửa. M4 không trừ hay giữ chỗ tồn kho.
- Giá là giá hiện tại của sản phẩm; M6 chụp giá vào `orders.items` lúc tạo đơn.
- Giao diện: `CartProvider` trong `(shop)/layout.tsx` giữ độ lệch số lượng bằng `useOptimistic`, số trên biểu tượng tăng ngay rồi khớp với RSC mới của action; action lỗi hoặc reject → số về như cũ, thông báo trong `role="alert"`.
- Proxy không tham gia giỏ hàng; nó chỉ cho Server Action (`POST` có header `next-action`) đi thẳng trước mọi kiểm slug (ADR-0014; NS-103 thu hẹp từ "mọi request không phải `GET` / `HEAD`"). Mọi request khác, kể cả `POST` không có header, `PUT`, `DELETE`, được kiểm slug như `GET` (ADR-0009). Giới hạn tốc độ ở biên: một quy tắc Vercel WAF cho `POST` theo IP, 60 request / 60 s (ADR-0015).

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
Chi tiết và lý do: [ADR-0018](./adr/0018-admin-auth.md) (xác thực), [ADR-0019](./adr/0019-product-edits-and-cache-tags.md) (sửa sản phẩm), [ADR-0020](./adr/0020-content-security-policy-and-hsts.md) (CSP).
- Một admin. Đăng nhập bằng `ADMIN_PASSWORD` (≥ 20 ký tự, khác nhau giữa Production và Preview), so `sha256` bằng `timingSafeEqual` → cookie phiên `v1.<hết hạn>.<HMAC-SHA256>` ký bằng `SESSION_SECRET` (≥ 32 ký tự, Web Crypto). Cookie `__Host-ns_admin` (`ns_admin` khi không HTTPS), `HttpOnly`, `Secure`, `SameSite=Strict`, `Path=/`, không `Domain`, hạn tuyệt đối 8 giờ, không trượt; không chạm DB. Thiếu hoặc yếu cấu hình → khu admin đóng. Thu hồi mọi phiên: đổi `SESSION_SECRET` + redeploy.
- Đăng nhập sai bị đếm trong `admin_login_failures` (IP băm HMAC): 5 lần / 15 phút mỗi IPv4 hay mỗi IPv6 /64 thì khoá (không có khoá toàn cục; quá 1000 hàng / 15 phút thì ngừng ghi, không khoá ai: ADR-0018, NS-132); kiểm khoá trước khi so mật khẩu, lỗi DB khi kiểm khoá thì từ chối đăng nhập. Quy tắc WAF của ADR-0015 vẫn đếm `loginAction`.
- `proxy.ts` chặn `/admin/*` (trừ `/admin/login`) nếu cookie không hợp lệ (M5), **trước** lối tắt Server Action: `GET` / `HEAD` nhận 307 sang `/admin/login` (xoá cookie hỏng), request khác nhận 401. Proxy chỉ kiểm lạc quan; layout admin và **mỗi** Server Action admin kiểm lại phiên trước khi parse input hay chạm DB. CSRF: `SameSite=Strict` + kiểm `Origin` của Next.js. Cùng file này, từ M2, đã trả 404 cho `/products/<slug>` không tồn tại ([ADR-0009](./adr/0009-product-404-in-proxy.md)); từ M3 cả `/blog/<slug>` không tồn tại (đối chiếu registry tĩnh, không chạm DB) và đường dẫn ảnh Open Graph `/products|blog/<slug>/opengraph-image[-<băm>]` của slug lạ ([ADR-0012](./adr/0012-blog-static-registry.md)). `matcher` là `['/products/:slug', '/products/:slug/:image', '/blog/:slug', '/blog/:slug/:image']`; `/blog`, `/products`, `/opengraph-image`, sitemap, robots, `/_next/*` không qua proxy. M5 mở rộng `matcher`.
- Từ M5 proxy trả 404 cho slug sản phẩm lạ bằng registry tĩnh `catalog-slugs.ts`, không chạm DB ([ADR-0017](./adr/0017-product-slug-registry-in-proxy.md)); thêm / bỏ sản phẩm = sửa seed + registry trong một PR và deploy.
- Trang admin (`src/app/admin/`, ngoài `(shop)`: không header giỏ) có `robots: noindex` và CSP nonce riêng (ADR-0020).
- Sửa sản phẩm (M5: chỉ tên, giá, mô tả, tồn kho) → một Server Action trong `features/products`: một câu `UPDATE … WHERE slug AND updated_at = <lúc mở form>` (khác → báo xung đột, không ghi đè), rồi `updateTag('product:<slug>')` + `updateTag('products')`; không bao giờ xoá `product-slugs` khi chỉ sửa trường.

Biến môi trường đầy đủ: [`.env.example`](../.env.example).

## 6. Chiến lược cache

Cache Components (`cacheComponents: true`) bật **từ M1**: mặc định mọi thứ động, muốn cache phải khai báo. Chi tiết: [ADR-0003](./adr/0003-cache-strategy.md).

Lưu ý trên Vercel: cache của `"use cache"` nằm trong bộ nhớ từng instance, không bền giữa các instance. Trang cần nhanh ổn định thì prerender (`generateStaticParams`); nếu sau này cần cache dùng chung giữa instance, cân nhắc `"use cache: remote"` (ADR riêng).

| Dữ liệu | Cách xử lý |
|---|---|
| Danh mục, danh sách sản phẩm | Danh mục; danh sách không có từ khoá: `"use cache"`, `cacheLife('hours')`, `cacheTag('products')`, khoá gồm danh mục / sắp xếp / trang đã chuẩn hoá. Tìm theo `q`: không cache ([ADR-0008](./adr/0008-listing-cache-keys.md)) |
| Chi tiết sản phẩm (gồm tồn kho) | `"use cache"`, `cacheTag('product:<slug>')`; làm mới bằng `updateTag('product:<slug>')` + `updateTag('products')` khi admin sửa (Server Action, danh sách tag do `tagsForProductWrite` quyết, [ADR-0019](./adr/0019-product-edits-and-cache-tags.md)), `revalidateTag` khi webhook trừ kho (Route Handler); `generateStaticParams` để prerender |
| Số lượng trong giỏ, nút thêm vào giỏ | Số trên biểu tượng giỏ ở header của **mọi** trang `(shop)`: đọc cookie + một truy vấn đếm (chỉ khi có cookie hợp lệ) trong `<Suspense>`, vỏ trang vẫn prerender; lỗi DB chỉ làm mất con số. Không bao giờ nằm trong `"use cache"` hay `"use cache: private"`. Nút thêm vào giỏ là client component nhận `stock` từ dữ liệu sản phẩm đã cache (chỉ để vô hiệu khi hết hàng); server kiểm tồn kho lại khi ghi. `app/not-found.tsx` có link "Giỏ hàng" tĩnh không số ([ADR-0014](./adr/0014-cart-storage-and-cookie.md)) |
| Danh sách slug (`getCatalogSlugs`) | `"use cache"`, `cacheLife('hours')`, tag riêng `cacheTag('product-slugs')` (M5, thay cho `products`), để `updateTag('products')` khi sửa trường không render lại mọi trang chi tiết; chỉ xoá khi tập slug đổi (tạo, xoá, ẩn, đổi slug) ([ADR-0019](./adr/0019-product-edits-and-cache-tags.md)). Trang chi tiết, metadata, ảnh OG đối chiếu nó trước khi gọi hàm cache theo slug (NS-109, [ADR-0003](./adr/0003-cache-strategy.md)) |
| Kiểm slug sản phẩm trong `proxy.ts` | Từ M5: đối chiếu registry tĩnh `catalog-slugs.ts`, không chạm DB, nên 404 thật ở mọi region kể cả khi DB chết ([ADR-0017](./adr/0017-product-slug-registry-in-proxy.md), NS-79). Trước đó: truy vấn không cache, quá 400 ms hoặc lỗi → cho đi tiếp ([ADR-0009](./adr/0009-product-404-in-proxy.md)). Áp cho cả ảnh OG của sản phẩm |
| Mọi truy vấn runtime | Qua `dbQuery` của `@/db`: lỗi thay bằng thông điệp cố định (tên truy vấn + SQLSTATE / errno), quá **5 giây** (`DB_QUERY_TIMEOUT_MS`, 100 → 10000) thì ném lỗi để trang lỗi hiện thay vì chờ `connect_timeout` 10 giây ([ADR-0011](./adr/0011-db-query-wrapper.md)); hết giờ thì dựng lại client Postgres để kết nối bị mạng nuốt gói không giữ pool ([ADR-0013](./adr/0013-db-client-recycle.md)) |
| Blog | Tĩnh trừ lỗ biểu tượng giỏ ở header (ADR-0014): nội dung MDX biên dịch lúc build, registry `posts.ts` trong repo; `/blog` và mọi `/blog/<slug>` prerender (`generateStaticParams`), không `"use cache"`, không tag — bài chỉ đổi khi deploy. Slug lạ: `proxy.ts` đối chiếu danh sách slug tĩnh, không chạm DB, nên không tạo entry route cache nào cho slug bịa ra — cả trang lẫn ảnh OG ([ADR-0012](./adr/0012-blog-static-registry.md)) |
| `sitemap.xml`, `robots.txt` | Sitemap: sản phẩm đọc qua `getProductSitemapEntries` (`"use cache"`, `cacheTag('products')`, `cacheLife('hours')`), bài từ registry; route `○ /sitemap.xml  1h  1d`. `robots.txt` tĩnh (`Disallow: /` ngoài production, §7). Cả hai prerender lúc build: URL tuyệt đối lấy từ `getSiteUrl()` với biến môi trường **lúc build** |
| Trang admin, giỏ hàng, checkout | Động hoàn toàn |

## 7. Môi trường

| Môi trường | Nhánh git | Ở đâu | Database | Dữ liệu | Thanh toán |
|---|---|---|---|---|---|
| **Local** | bất kỳ | Máy dev | PGlite (`.data/`) | Seed | Fake |
| **CI** | mọi PR; push vào `develop`, `production` | GitHub Actions | PGlite (`memory://` / thư mục tạm) | Seed | Fake |
| **Preview** | mỗi PR | Vercel preview, một URL cho mỗi PR | Neon branch tự tạo cho nhánh git của PR (tích hợp Neon), dùng lại qua các lần deploy của nhánh | Seed | Fake |
| **Dev** | `develop` | Vercel preview của nhánh `develop`, domain nhánh cố định | Neon branch tự tạo cho nhánh git `develop` (tích hợp Neon) | Seed | Fake |
| **Production** | `production` | Vercel production (production branch = `production`), domain chính | Neon nhánh chính | Seed lần đầu, sau đó admin quản lý | Fake (đến khi mở bán) |

- Code không kiểm tra tên môi trường; mọi khác biệt nằm trong biến môi trường. Dev là bản preview của Vercel (`VERCEL_ENV=preview`), nhận `DATABASE_URL` / `DATABASE_URL_UNPOOLED` do tích hợp Neon inject cho nhánh git `develop` (cùng một Neon branch qua mọi lần deploy `develop`); không có Neon branch `dev` riêng hay biến ghi đè theo nhánh. Vì seed chạy ở mọi lần build Dev / preview trên một branch có thể đã có dữ liệu, seed phải idempotent (`onConflictDoNothing` theo `slug`). Luồng nhánh: [ADR-0006](./adr/0006-branch-strategy.md).
- URL công khai (`metadataBase`, sitemap, robots) lấy từ `getSiteUrl()` (`src/lib/site-url.ts`), không ghi cứng domain trong `src/`: `SITE_URL` nếu có (domain riêng, chạy ngoài Vercel; phải là `https://<host>[:cổng]`, hoặc `http://localhost` ngoài build production) → Production: `VERCEL_PROJECT_PRODUCTION_URL` → Preview / Dev: `VERCEL_BRANCH_URL` → `VERCEL_URL` → `http://localhost:3000`. Đọc lúc build. Dev vì vậy dùng domain nhánh `next-store-git-develop-…`, không phải alias Dev, trừ khi đặt `SITE_URL` cho nhánh `develop`.
- `robots.txt`: `Allow: /` chỉ trên build production của Vercel (`isProductionDeployment`: `VERCEL` có giá trị và `VERCEL_ENV=production`), còn lại `Disallow: /`. Quyết định 15 của plan M3 định dùng một file cho mọi môi trường, dựa vào header `X-Robots-Tag: noindex` của Vercel trên Preview / Dev; NS-65 kiểm Dev (`next-store-dev-ginpham.vercel.app`) thì **không có** header này, nên áp nhánh dự phòng của quyết định. Smoke trong `e2e-preview` bắt buộc `Disallow: /` (`SMOKE_ROBOTS=disallow`) và in header `X-Robots-Tag` mỗi lần chạy. `/admin` (M5) dùng `noindex`, không thêm `Disallow` riêng.
- Sau này thêm `stg` / `demo`: mỗi cái là một nhánh sống lâu có domain nhánh và Neon branch riêng (Hobby), hoặc Vercel Custom Environments (Pro).

- Bước build trên Vercel: `npm run build:vercel` = migrate → seed (bỏ qua khi `VERCEL_ENV=production`) → `next build`. Production được seed trước lần build đầu tiên có trang đọc DB.
- Seed **không bao giờ** chạy trên production sau lần khởi tạo. Script seed dùng danh sách cho phép: PGlite luôn được seed; Postgres chỉ được seed trên Vercel (`VERCEL` có giá trị) khi `VERCEL_ENV=preview`; không có lối tắt cho production — mọi trường hợp khác (không đặt, sai chính tả, VPS) bị coi là production và bị từ chối trước mọi câu lệnh DB. Seed production chỉ bằng `npm run db:seed:sql` chạy trong Neon SQL Editor (README, mục Seed production).
- Region: function của Vercel (trang động, Server Action) chạy ở `sin1` (Singapore) theo `vercel.json` `regions`, cạnh Neon `aws-ap-southeast-1`; mặc định của Vercel là `iad1` làm mỗi truy vấn đi qua Thái Bình Dương. `proxy.ts` **không** theo `regions`: trên Vercel nó là Routing Middleware, chạy ở edge gần người truy cập, và Next.js 16.4.6 bỏ `config.regions` của proxy Node.js lúc build. Tới v0.4.x, khách ở xa Singapore vì vậy thường nhận 200 thay vì 404 cho slug sản phẩm lạ (lookup DB quá 400 ms, fail-open; smoke Production chỉ cảnh báo, `SMOKE_PRODUCT_FAIL_OPEN=warn`, [ADR-0009](./adr/0009-product-404-in-proxy.md)). Từ M5 (NS-79) proxy **không còn tra DB**: slug sản phẩm đối chiếu registry tĩnh trong repo, nên region của proxy không còn quan trọng và cờ `warn` bị bỏ ([ADR-0017](./adr/0017-product-slug-registry-in-proxy.md)); kiểm phiên admin trong proxy cũng không chạm DB ([ADR-0018](./adr/0018-admin-auth.md)). Đổi region của Neon thì đổi cả `vercel.json`.
- Secret chỉ nằm trong biến môi trường của Vercel và GitHub Secrets.
- Trên Vercel, bản preview / Dev từ chối kết nối khi `NEON_PRODUCTION_ENDPOINT` thiếu hoặc trùng endpoint của `DATABASE_URL`; production từ chối khi biến có mặt mà không khớp. Biến là endpoint id (không bí mật) của Neon branch production, không ghi cứng trong repo; kiểm ở `resolveDatabaseTarget`, chung cho runtime, `db:migrate` (cả URL unpooled) và `db:seed`. Mọi environment trên Vercel còn từ chối mật khẩu bắt đầu bằng `endpoint=` / `project=`, và preview / Dev từ chối host `….neon.tech` không mang endpoint id `ep-…` (không so được với production). Biến chỉ nhận một endpoint: thêm read replica cho production thì phải mở rộng lớp chặn trước.
- `DB_LOG=1` bị từ chối trên mọi Postgres không phải local trừ Vercel preview / development, và `VERCEL_ENV` chỉ được tin khi `VERCEL` có giá trị (danh sách cho phép, kiểm trong `createConnection` trước khi dựng client; logger và lớp chặn dùng chung `isDbLogOn`): log của Drizzle có cả tham số truy vấn. Preview chỉ an toàn để bật khi database của nó không chứa dữ liệu khách (M3 Task 5).
- Ngoài Vercel (local, CI, VPS) lớp chặn endpoint không chạy: ở đó không có khái niệm preview; `db:seed` và `DB_LOG` từ chối mọi Postgres không phải local ngoài Vercel dù `VERCEL_ENV` là gì, còn `db:migrate` chạy tay ngoài Vercel là thao tác của người vận hành.
- Kết nối tới DB không phải local luôn dùng TLS `verify-full`: server phải trình chứng chỉ do CA công khai cấp, khớp đúng hostname trong `DATABASE_URL` (Neon đáp ứng). Host là địa chỉ IP hoặc chứng chỉ tự ký (VPS) cần thêm `sslrootcert=<đường dẫn CA>` — hostname vẫn được kiểm.
- Host local (`localhost`, `127.0.0.1`, `::1`): `sslrootcert` **không** bật TLS. Thiếu `sslmode` / `ssl` (hoặc `disable` / `false`) nghĩa là không TLS, kể cả khi có `sslrootcert`; muốn TLS tới DB local thì ghi rõ `sslmode=verify-full` (hoặc `require` / `prefer` / `allow`).
- Hai role DB ([ADR-0010](./adr/0010-app-role-and-preview-data.md)): `db:migrate` dùng role chủ trong `DATABASE_URL` do tích hợp Neon inject (DDL, default privileges); runtime, prerender và `db:seed` dùng `next_store_app` (chỉ DML trên `public`) với user / mật khẩu từ `DATABASE_APP_USER` / `DATABASE_APP_PASSWORD`, host / cổng / database từ URL. Quyền cấp bằng `scripts/sql/app-role.sql`, kiểm bằng `scripts/sql/app-role-check.sql` (README, mục Role app); bảng do migration tạo sau tự có quyền, migration không `GRANT`. Thiếu biến thì dùng role chủ cho tới M3 Task 5, sau đó bắt buộc trên mọi `VERCEL_ENV`.
  - Ghi chú bổ sung (audit PR #39 L6, không sửa ADR-0010): role app tự đổi được mật khẩu của chính nó (Postgres không cho thu hồi quyền này), nên SQL injection chạy được câu lệnh xếp chồng có thể chiếm role từ ngoài. Phạm vi bảo vệ của ADR-0010 vì vậy không gồm "kẻ có SQL injection không giữ được quyền truy cập"; quy trình đổi mật khẩu của Task 5 (README, mục Role app → Đổi mật khẩu) là cách lấy lại. Role app có `statement_timeout = 6s` (NS-73).
- Mật khẩu trống trong URL nghĩa là driver lấy `PGPASSWORD` rồi `.pgpass`; URL trên Vercel/Neon phải chứa mật khẩu.

## 8. Các mốc

Mỗi mốc: thiết kế màn hình (nếu có giao diện mới) → plan (`docs/plans/M<n>.md`) → ticket → code theo PR vào `develop` → QA trên Dev / preview → demo cho chủ dự án → release PR `develop → production` được duyệt, gắn tag `v0.<mốc>.<n>` (quy tắc đánh số ở [`conventions.md`](./conventions.md) §8), deploy production. Chi tiết quy trình: [`process.md`](./process.md).

| Mốc | Nội dung | User stories |
|---|---|---|
| **M1 Nền tảng & đường ống** | Design system + màn hình trang chủ; khởi tạo dự án, cấu trúc, dependency-cruiser, Cache Components; schema + seed; layout, trang chủ; GitHub + CI; Playwright; Vercel + Neon, deploy production đầu tiên | US-01 |
| **M2 Danh mục sản phẩm** | Lọc / sắp xếp / tìm / phân trang qua URL, trang chi tiết, skeleton trong `<Suspense>`, trang lỗi, trang 404 | US-02 → US-05 |
| **M3 Blog & SEO** | Blog MDX, metadata, OG image, sitemap, robots | US-10, US-11 |
| **M4 Giỏ hàng** | Cookie giỏ hàng, Server Actions, `useOptimistic`, kiểm tra tồn kho | US-06 → US-08 |
| **M5 Admin** | Đăng nhập admin, `proxy.ts`, sửa sản phẩm + `updateTag`, header bảo mật | US-12, US-13 |
| **M6 Thanh toán & vận hành** | `PaymentProvider` + `FakeProvider`, webhook, đơn hàng, admin đơn hàng; theo dõi lỗi production, Web Vitals | US-09, US-14 |

## 9. Điều kiện hoàn thành

**Mỗi PR:** CI xanh (typecheck, lint, `check:deps`, Vitest, build, Playwright); review không còn lỗi chặn; preview deploy chạy được.

**Mỗi mốc:** mọi tiêu chí chấp nhận của các story trong mốc có test E2E hoặc test tích hợp tương ứng và đều qua; QA đã thử trên Dev / preview; chủ dự án duyệt demo và release PR `develop → production`; release đã merge bằng merge commit, có tag `v0.<mốc>.<n>` (tag cuối cùng của mốc là release cuối mốc); production deploy thành công.

## 10. Môi trường phát triển

- Bản làm việc của đội agent: workspace cloud `/home/claude/next-store` (dùng chung, một người viết tại một thời điểm). **Chủ dự án không chạy `npm` trong workspace này** — `node_modules` ở đây là bản Linux và PGlite chỉ cho một tiến trình truy cập.
- Chủ dự án chạy thử bằng bản clone riêng trên Mac, kéo nhánh `develop` từ GitHub `chinhpham208/next-store`, ví dụ `~/Projects/next-store-local`, hoặc xem trên preview / Dev / production. `main` đóng băng, không dùng để chạy thử.
- Không cần Docker hay tài khoản thanh toán để chạy local.
