# Design system: next-store (M1)

Nguồn: Designer, ticket NS-24. Bản gốc trên Claude Design:
- Design system: https://claude.ai/artifact/GmucdqjNPKDzHFY4FWZCUj
- Màn hình trang chủ (390 / 1280 px, sáng / tối / trống): https://claude.ai/artifact/Tjc6tnwX3q96CPSxDk2c2r

File này là bản chép để code đọc; khi lệch nhau, artifact là bản gốc và file này phải được cập nhật.

## 1. Token

Font hệ thống, không web font. Tên theo namespace Tailwind v4 (`color-*` → biến `--color-*`).

### Màu và bóng (đổi theo theme)

| Token | Sáng | Tối |
|---|---|---|
| `color-background` | #f5f6f3 | #12161a |
| `color-surface` | #ffffff | #1b2127 |
| `color-surface-muted` | #e8ece7 | #262e35 |
| `color-foreground` | #14201f | #eaf0ee |
| `color-muted-foreground` | #4a5856 | #a9b6b3 |
| `color-border` (trang trí) | #d3d9d4 | #2f3a42 |
| `color-border-strong` (control) | #6f7c78 | #6b7a82 |
| `color-accent` | #0a6b66 | #4dd0c4 |
| `color-accent-foreground` | #ffffff | #0b1a19 |
| `color-accent-soft` | #d6ece8 | #16302e |
| `color-danger` | #b3261e | #ff9e94 |
| `color-danger-soft` | #fde8e6 | #3d211f |
| `color-ring` | `var(--color-accent)` | `var(--color-accent)` |
| `shadow-sm` | 0 1px 2px rgba(20,32,31,.10) | 0 1px 2px rgba(0,0,0,.45) |
| `shadow-md` | 0 6px 16px rgba(20,32,31,.12) | 0 6px 16px rgba(0,0,0,.55) |

### Không đổi theo theme

| Token | Giá trị |
|---|---|
| `font-sans` | system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif |
| `font-mono` | ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace |
| `radius-sm` / `radius-md` / `radius-lg` / `radius-full` | 6 / 10 / 16 / 9999 px |
| `spacing` | 4px (bước dùng: 1, 2, 3, 4, 6, 8, 10, 12, 16) |
| `container-page` | 72rem |

### Type scale (`--text-*` + `--text-*--line-height`)

| Token | Cỡ / dòng | Dùng cho |
|---|---|---|
| `text-xs` | 12/16 | badge, chú thích, nhãn danh mục (mono, 500) |
| `text-sm` | 14/20 | chữ phụ, footer |
| `text-base` | 16/24 | thân bài, tên sản phẩm (mobile) |
| `text-lg` | 18/28 | tên sản phẩm (desktop), giá |
| `text-xl` | 20/28 | logo |
| `text-2xl` | 24/32 | h2 của section |
| `text-3xl` | 30/36 | h1 hero (mobile) |
| `text-4xl` | 36/40 | tiêu đề lớn |
| `text-5xl` | 48/48 | h1 hero (desktop) |

Độ đậm do component quyết định (giá và tên sản phẩm: 600; h1/h2: 700; logo: 700).

Tương phản đã tính: chữ ≥ 4,5:1 ở cả hai theme (thấp nhất 5,56:1); `border-strong` và vòng focus ≥ 3:1. `color-border` trang trí cố ý dưới 3:1 — không được là viền duy nhất của control.

## 2. Component

- **Container:** `mx-auto w-full max-w-container-page px-4 md:px-6 lg:px-8`; nhận `className` chỉ cho padding dọc.
- **Card:** `overflow-hidden rounded-lg border border-border bg-surface shadow-sm`, không padding. Từ M2 khi thành link: hover `shadow-md`, focus ring.
- **Badge:** chung `inline-flex min-h-6 items-center rounded-full px-2.5 text-xs whitespace-nowrap`.
  - `neutral`: `bg-surface-muted text-foreground font-medium`
  - `sold-out`: `bg-danger-soft text-danger font-semibold`, nhãn "Hết hàng"
- **Price:** một `span`, `text-lg font-semibold text-foreground tabular-nums`, chỉ chứa giá dạng `199.000 ₫`.
- **ProductCard:** Card trong `li`.
  - Ảnh: `aspect-square bg-surface-muted`, ảnh 800×800 `object-cover`, `alt` = tên sản phẩm; hết hàng thêm `opacity-70`.
  - Thân: `flex flex-1 flex-col gap-2 p-3 md:p-4`.
  - Hàng meta: `flex flex-wrap items-center gap-2` — danh mục (`font-mono text-xs font-medium text-muted-foreground`) + Badge "Hết hàng" khi cần.
  - Tên: `h3`, `text-base md:text-lg font-semibold`, xuống dòng tối đa 3 dòng, không cắt.
  - Giá: `mt-auto` để thẳng hàng giữa các thẻ.
- **Lưới:** `ul` `grid grid-cols-2 gap-4 md:grid-cols-3`, `aria-label="Sản phẩm nổi bật"`.
- **Header:** `bg-surface border-b h-16`, chứa Container; chỉ có logo link (mono `text-xl font-bold` "next-store", tiền tố `~/` màu accent, `aria-hidden`), vùng chạm ≥ 44×44. M1 chưa có link điều hướng.
- **Hero:** dải `bg-accent-soft`, `py-8` (mobile) / `py-16` (desktop): eyebrow mono, h1 "Đồ dùng cho dân code." (`text-3xl` / `text-5xl`), đoạn mở đầu; desktop thêm thẻ terminal trang trí (`aria-hidden`, rộng 380 px).
- **Section nổi bật:** h2 "Sản phẩm nổi bật" + lưới. Trống: thay `ul` bằng `<p>Chưa có sản phẩm nổi bật.</p>` trong khối `bg-surface-muted`, viền đứt `border-border-strong`.
- **Footer:** `bg-surface-muted border-t`: dòng thương hiệu, rồi ba dòng `text-sm text-muted-foreground`: mô tả cửa hàng; "Thanh toán đang chạy ở chế độ thử nghiệm, chưa thu tiền thật."; dòng mono `git commit -m "bán hàng bằng cà phê"`. Không có năm hay giá trị đổi theo thời gian.
- **Focus:** `outline 2px solid` màu `ring`, offset 2px, trên mọi phần tử tương tác.

## 3. Ảnh sản phẩm (M1)

Bốn SVG 800×800 không chứa chữ, theo danh mục: `public/images/{ao-thun,coc,sticker,sach}.svg` (bản vẽ của Designer, nằm trong asset group "Product-tiles" của design system).
