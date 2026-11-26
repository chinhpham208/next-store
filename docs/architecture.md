# Kiến trúc: next-store

Tài liệu này cho cái nhìn bằng hình. Chi tiết và lý do nằm trong [`design.md`](./design.md) và [`adr/`](./adr). Sơ đồ viết bằng Mermaid, xem được trên GitHub, GitLab, YouTrack và VS Code (cài extension Markdown Preview Mermaid).

## 1. Tổng quan các lớp

Không có backend riêng: server Next.js vừa render giao diện vừa là backend. Mũi tên chỉ đi một chiều từ trên xuống; dependency-cruiser kiểm tra quy tắc này (`npm run check:deps`).

```mermaid
flowchart TB
  browser["Trình duyệt<br/>khách hàng, admin"]
  payment["Cổng thanh toán<br/>Fake (test) / cổng VN khi mở bán"]

  subgraph next["Next.js 16 server"]
    proxy["proxy.ts — không chạm DB (M5)<br/>chặn /admin khi chưa đăng nhập: cookie ký HMAC, chạy trước mọi nhánh khác (M5)<br/>Server Action (POST + next-action) đi thẳng (M4)<br/>404 cho /products/:slug không tồn tại: đối chiếu registry slug sản phẩm (M2, registry từ M5)<br/>404 cho /blog/:slug không tồn tại: đối chiếu registry bài (M3)"]
    subgraph app["src/app — chỉ routing"]
      pages["Pages<br/>Server Components"]
      actions["Server Actions<br/>giỏ hàng, sửa sản phẩm"]
      route["Route Handler<br/>/api/webhooks/payment"]
    end
    features["src/features — logic nghiệp vụ<br/>products · cart · checkout · orders · blog · admin<br/>(nơi đặt &quot;use cache&quot;)"]
    db["src/db — Drizzle ORM"]
  end

  pglite[("PGlite<br/>khi phát triển")]
  postgres[("Postgres<br/>khi triển khai")]

  browser --> proxy --> pages & actions
  payment --> route
  pages & actions & route --> features --> db
  proxy -->|registry slug, kiểm phiên admin<br/>qua proxy-api, không DB| features
  db --> pglite
  db -.->|có DATABASE_URL| postgres
```

## 2. Các miền nghiệp vụ (`src/features`)

Mỗi miền chỉ lộ ra ngoài qua `index.ts`; riêng phần admin của `products` lộ qua `admin.ts`, chỉ `src/app/admin/**` import (audit PR #108 M-1). Mũi tên là "được phép import".

```mermaid
flowchart LR
  products
  cart --> products
  checkout --> cart
  checkout --> orders
  orders --> products
  products --> admin
  blog
```

| Miền | Trách nhiệm | Mốc |
|---|---|---|
| `products` | Đọc danh mục, danh sách, chi tiết; registry slug cho proxy (`catalog-slugs.ts`, M5); ghi sản phẩm (kèm `updateTag` theo `tagsForProductWrite`, [ADR-0019](./adr/0019-product-edits-and-cache-tags.md)); đọc admin (`admin-queries.ts`), bảng `/admin/products` và form sửa sản phẩm (`components/product-edit-form.tsx`, client), cả ba qua lối vào `admin.ts`, không qua `index.ts` — kiểm phiên bằng `hasAdminSession` của `admin`, nên chiều là `products → admin`, không ngược lại (audit PR #107 M-2) | M1, M2, M5 |
| `blog` | Registry bài viết (`posts.ts`, không import gì), nội dung MDX (`content.ts`), metadata bài viết | M3 |
| `cart` | Cookie giỏ hàng, thêm / sửa / xoá, kiểm tra tồn kho | M4 |
| `admin` | Cấu hình và mật khẩu admin, phiên đăng nhập (ký / xác minh cookie HMAC), giới hạn đăng nhập sai, thanh admin; không import miền nào khác. CSP nonce cho `/admin` ([ADR-0018](./adr/0018-admin-auth.md), [ADR-0020](./adr/0020-content-security-policy-and-hsts.md)) | M5 |
| `checkout` | `PaymentProvider`, tạo phiên thanh toán | M6 |
| `orders` | Tạo đơn, xử lý webhook, trừ kho, danh sách đơn | M6 |

## 3. Luồng thanh toán

```mermaid
sequenceDiagram
  actor K as Khách hàng
  participant A as Server Action<br/>(checkout)
  participant DB as Database
  participant P as PaymentProvider<br/>(Fake / cổng VN)
  participant W as Route Handler<br/>/api/webhooks/payment

  K->>A: Bấm "Thanh toán"
  A->>DB: Kiểm tra tồn kho, tạo order (pending)
  A->>P: createCheckout(order)
  P-->>K: Chuyển tới trang thanh toán
  K->>P: Trả tiền
  P->>W: Gửi webhook (có chữ ký)
  W->>W: verifyWebhook — sai chữ ký thì 400
  W->>DB: Transaction: order → paid,<br/>trừ kho (stock >= qty), xoá giỏ
  alt kho không đủ
    W->>DB: order → needs_refund
  end
  W->>W: revalidateTag('product:<slug>', 'max')
  W-->>P: 200 OK
  P-->>K: Chuyển về /checkout/success
```

`paymentRef` là unique: webhook gửi lặp lại chỉ được xử lý một lần.

## 4. Luồng cache

```mermaid
flowchart LR
  subgraph layout["Header của mọi trang (shop): /, /products, /products/[slug], /blog, /blog/[slug], /cart"]
    hole["Lỗ động trong Suspense<br/>số trên biểu tượng giỏ<br/>(đọc cookie + một truy vấn đếm)"]
  end
  subgraph page["Trang /products/[slug]"]
    shell["Vỏ trang + thông tin sản phẩm<br/>&quot;use cache&quot; · tag product:&lt;slug&gt;<br/>nút thêm vào giỏ (client, stock từ cache)"]
  end
  action["Server Action giỏ hàng<br/>đặt lại cookie"]
  edit["Admin sửa sản phẩm"] -->|"updateTag product:&lt;slug&gt; + products<br/>(không product-slugs)"| shell
  paid["Webhook trừ kho"] -->|revalidateTag| shell
  req["Mỗi request"] --> hole
  action -->|render lại route trong cùng response| hole
```

- Phần vỏ và dữ liệu sản phẩm được phục vụ từ cache cho đến khi có sự kiện làm mới.
- Danh sách slug (`getCatalogSlugs`) mà mọi trang chi tiết đọc mang tag riêng `product-slugs` (M5). Admin sửa một sản phẩm chỉ xoá `product:<slug>` và `products` (danh sách), nên trang của các sản phẩm khác không bị render lại; `product-slugs` chỉ bị xoá khi tập slug đổi ([ADR-0019](./adr/0019-product-edits-and-cache-tags.md)).
- Phần phụ thuộc cookie luôn được tính lại cho từng người xem. Từ M4 đó là số trên biểu tượng giỏ ở header của **mọi** trang `(shop)`; vỏ trang vẫn prerender, lỗi DB chỉ làm mất con số. Dữ liệu giỏ không bao giờ nằm trong `"use cache"` ([ADR-0014](./adr/0014-cart-storage-and-cookie.md)).
- Server Action của giỏ không gọi `updateTag`: M4 không sửa tồn kho. Đặt lại cookie làm Next.js render lại route hiện tại, nên biểu tượng giỏ cập nhật trong cùng response.
- Blog được tạo tĩnh lúc build, không cần làm mới; chỉ lỗ biểu tượng giỏ ở header là động.

## 5. Mô hình dữ liệu

```mermaid
erDiagram
  categories ||--o{ products : "chứa"
  carts ||--o{ cart_items : "gồm"
  products ||--o{ cart_items : "nằm trong"

  categories {
    serial id PK
    text slug UK
    text name
  }
  products {
    serial id PK
    text slug UK
    text name
    text description
    integer price "VND"
    text image
    integer category_id FK
    integer stock
    boolean featured
    timestamp created_at "M5: thứ tự Mới nhất"
    timestamp updated_at "kiểm chống ghi đè khi admin lưu"
  }
  admin_login_failures {
    uuid id PK "do server sinh"
    text ip_hash "HMAC của IP, không lưu IP thô"
    timestamp failed_at
  }
  carts {
    uuid id PK "UUID v4 do server sinh, lưu trong cookie httpOnly"
    timestamp created_at
    timestamp updated_at "hết hạn 30 ngày trượt"
  }
  cart_items {
    uuid cart_id PK, FK "ON DELETE CASCADE"
    integer product_id PK, FK "ON DELETE CASCADE"
    integer quantity "CHECK > 0"
    timestamp created_at
  }
  orders {
    serial id PK
    json items "snapshot lúc đặt"
    integer total
    text status "pending | paid | needs_refund | cancelled"
    text provider "fake | payos | ..."
    text payment_ref UK
    timestamp created_at
  }
```

`orders` lưu bản chụp sản phẩm (`items`) thay vì tham chiếu, để đơn cũ không đổi khi giá sản phẩm thay đổi. Bảng `carts`, `cart_items` thêm ở M4; `products.created_at` và `admin_login_failures` (không quan hệ với bảng khác) ở M5 ([ADR-0018](./adr/0018-admin-auth.md), [ADR-0019](./adr/0019-product-edits-and-cache-tags.md)); `orders` ở M6. Khi có tính năng xoá sản phẩm: ẩn bằng `products.archived_at`, không xoá cứng (ADR-0019). Giỏ không lưu giá: luôn dùng giá hiện tại, M6 chụp giá vào `orders.items` lúc tạo đơn ([ADR-0014](./adr/0014-cart-storage-and-cookie.md)).

## 6. Môi trường và luồng deploy

```mermaid
flowchart LR
  subgraph dev["Phát triển"]
    agents["Đội agent<br/>/home/claude/next-store"]
    owner["Chủ dự án<br/>bản clone riêng"]
  end
  gh["GitHub<br/>PR + review"]
  ci["GitHub Actions<br/>check · test · build · E2E<br/>(PGlite)"]
  subgraph vercel["Vercel"]
    preview["Preview<br/>mỗi PR một URL"]
    devenv["Dev<br/>nhánh develop, domain cố định"]
    prod["Production<br/>nhánh production, domain chính"]
  end
  subgraph neon["Neon Postgres"]
    nbranch[("branch theo nhánh git<br/>(tích hợp Neon tự tạo)")]
    ndev[("branch tự tạo cho<br/>nhánh git develop")]
    nmain[("nhánh chính")]
  end
  yt["YouTrack NS"]

  agents -->|push nhánh NS-xx| gh
  owner -->|duyệt release PR| gh
  gh --> ci
  gh -->|PR NS-xx → develop| preview --> nbranch
  gh -->|squash-merge vào develop| devenv --> ndev
  gh -->|release PR develop → production<br/>merge commit + tag v0.x.y| prod --> nmain
  agents -.->|trạng thái ticket| yt
```

- `main` đóng băng, không deploy. Ticket PR vào `develop`; cuối mốc, release PR `develop → production`. Hotfix: `hotfix/NS-xx-…` từ `production`, sau đó back-merge vào `develop`. Chi tiết: [ADR-0006](./adr/0006-branch-strategy.md).
- Local và CI dùng PGlite; preview, Dev và production dùng Neon. Chi tiết: [ADR-0005](./adr/0005-hosting.md).
- Đội agent làm việc trong `/home/claude/next-store` (máy ảo Linux); chủ dự án không chạy `npm` ở thư mục đó mà dùng bản clone riêng.
