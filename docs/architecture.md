# Kiến trúc: next-store

Tài liệu này cho cái nhìn bằng hình. Chi tiết và lý do nằm trong [`design.md`](./design.md) và [`adr/`](./adr). Sơ đồ viết bằng Mermaid, xem được trên GitHub, GitLab, YouTrack và VS Code (cài extension Markdown Preview Mermaid).

## 1. Tổng quan các lớp

Không có backend riêng: server Next.js vừa render giao diện vừa là backend. Mũi tên chỉ đi một chiều từ trên xuống; dependency-cruiser kiểm tra quy tắc này (`npm run check:deps`).

```mermaid
flowchart TB
  browser["Trình duyệt<br/>khách hàng, admin"]
  payment["Cổng thanh toán<br/>Fake (test) / cổng VN khi mở bán"]

  subgraph next["Next.js 16 server"]
    proxy["proxy.ts<br/>chặn /admin khi chưa đăng nhập"]
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
  db --> pglite
  db -.->|có DATABASE_URL| postgres
```

## 2. Các miền nghiệp vụ (`src/features`)

Mỗi miền chỉ lộ ra ngoài qua `index.ts`. Mũi tên là "được phép import".

```mermaid
flowchart LR
  products
  cart --> products
  checkout --> cart
  checkout --> orders
  orders --> products
  admin
  blog
```

| Miền | Trách nhiệm | Mốc |
|---|---|---|
| `products` | Đọc danh mục, danh sách, chi tiết; ghi sản phẩm (kèm `updateTag`) | M1, M2, M5 |
| `blog` | Đọc file MDX, metadata bài viết | M3 |
| `cart` | Cookie giỏ hàng, thêm / sửa / xoá, kiểm tra tồn kho | M4 |
| `admin` | Phiên đăng nhập admin (ký / xác minh cookie) | M5 |
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
  subgraph page["Trang /products/[slug]"]
    shell["Vỏ trang + thông tin sản phẩm<br/>&quot;use cache&quot; · tag product:&lt;slug&gt;"]
    hole["Lỗ động trong Suspense<br/>số lượng giỏ, nút thêm vào giỏ<br/>(đọc cookie)"]
  end
  edit["Admin sửa sản phẩm"] -->|updateTag| shell
  paid["Webhook trừ kho"] -->|revalidateTag| shell
  req["Mỗi request"] --> hole
```

- Phần vỏ và dữ liệu sản phẩm được phục vụ từ cache cho đến khi có sự kiện làm mới.
- Phần phụ thuộc cookie luôn được tính lại cho từng người xem.
- Blog được tạo tĩnh lúc build, không cần làm mới.

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
    timestamp updated_at
  }
  carts {
    uuid id PK "lưu trong cookie httpOnly"
    timestamp created_at
  }
  cart_items {
    uuid cart_id FK
    integer product_id FK
    integer quantity
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

`orders` lưu bản chụp sản phẩm (`items`) thay vì tham chiếu, để đơn cũ không đổi khi giá sản phẩm thay đổi. Bảng `carts`, `cart_items` thêm ở M4; `orders` ở M6.

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
    nbranch[("branch theo PR")]
    ndev[("branch dev")]
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
