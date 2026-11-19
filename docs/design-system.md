# Design system: next-store (v2, theo brand Gin Pham)

Nguồn: Designer, ticket NS-24 — **chủ dự án duyệt 2026-11-19**. Bản gốc trên Claude Design:
- Design system: https://claude.ai/artifact/GmucdqjNPKDzHFY4FWZCUj
- Màn hình trang chủ (390 / 1280 px, sáng / tối / trống): https://claude.ai/artifact/Tjc6tnwX3q96CPSxDk2c2r

Brand gốc: bộ nhận diện **Gin Pham — Smile G** (Ink #0C0F12, Deep Cyan #08959A, Signal Cyan #2EE6EA, Paper #E8EEF0, Slate; font Lexend). File này là bản chép để code đọc; khi lệch nhau, artifact là bản gốc.

## 0. Nguyên tắc

- Ink / Paper chủ đạo. **Cyan chỉ dùng cho khối con trỏ vuông** (không bao giờ cho chữ). Link dùng `--color-link`.
- Không gradient, không bóng, không hiệu ứng, không thêm màu ngoài bảng (brand §7). Trạng thái hết hàng thể hiện bằng nhãn đảo màu Ink/Paper, không dùng đỏ.
- Tên cửa hàng `next-store` viết bằng chữ (Lexend 700, chữ thường, tracking −0.02em) + khối con trỏ. **Không ghép với logo Smile G.** Footer ghi "một dự án của" + lockup `gin pham` chính thức.
- Chuyển động duy nhất: con trỏ nhấp nháy cuối tiêu đề hero, `1.06s steps(1, end)`, tắt khi `prefers-reduced-motion`.
- Lưới 8 px: chỉ dùng các bước spacing chẵn (ngoại lệ `min-h-11` = 44 px cho vùng chạm).

## 1. Token (Tailwind v4 `@theme`)

### Màu (đổi theo theme)

| Token | Sáng | Tối | Nguồn brand |
|---|---|---|---|
| `--color-background` | #f4f8f9 | #0c0f12 | `--bi-background` (tối = Ink) |
| `--color-surface` | #ffffff | #141d26 | `--bi-surface` |
| `--color-surface-muted` | #eaeeef | #232c35 | `--bi-surface-alt` |
| `--color-foreground` | #0c0f12 | #e8eef0 | Ink / Paper |
| `--color-muted-foreground` | #4d5660 | #9ba2aa | `--bi-text-muted` (Slate) |
| `--color-border` | #d0d8da | #38424c | `--bi-border` |
| `--color-border-strong` | #6b747d | #6b747d | `--bi-neutral-500` |
| `--color-accent` (khối con trỏ, không phải chữ) | #08959a | #2ee6ea | Deep Cyan / Signal Cyan |
| `--color-link` | #097a7e | #08959a | `--bi-link` |
| `--color-ring` | #097a7e | #08959a | `--bi-focus` |
| `--color-danger` (lỗi form, mốc sau) | #b4312b | #fe8477 | `--bi-danger` |

### Màu dải đảo (giống nhau ở cả hai theme — footer)

| Token | Giá trị |
|---|---|
| `--color-inverse` | #0c0f12 |
| `--color-inverse-foreground` | #e8eef0 |
| `--color-inverse-muted` | #9ba2aa |
| `--color-inverse-accent` | #2ee6ea |
| `--color-inverse-border` | #38424c |

### Chữ, bo góc, khác

| Token | Giá trị |
|---|---|
| `--font-sans` | "Lexend", system-ui, sans-serif — file `src/app/fonts/lexend-full-wght.woff2` (đủ 146/146 chữ cái tiếng Việt, SIL OFL), nạp bằng `next/font/local`, weight `100 900` |
| `--font-mono` | ui-monospace, "SF Mono", "JetBrains Mono", Consolas, monospace (Lexend không có chữ số tabular → giá dùng mono) |
| `--tracking-tight` / `--tracking-label` | -0.02em / 0.14em |
| `--text-*` (cỡ / dòng) | xs 12/16 · sm 14/20 · base 16/24 · lg 18/28 · xl 20/28 · 2xl 24/32 · 3xl 32/40 · 4xl 40/48 · 5xl 48/56 · 8xl 96/104 (từ 3xl trở lên: tracking −0.02em) |
| `--radius-sm` / `--radius-md` / `--radius-lg` | 4 / 8 / 16 px (khối con trỏ không bao giờ bo góc) |
| `--shadow-*` | không dùng |
| `--max-width-container-page` | 72rem |
| `--spacing` | 4px (Tailwind mặc định) |

Hai giá trị cần thành class riêng trong `globals.css` (không dùng giá trị tuỳ ý): `.cursor-block` (khối vuông `0.5em`, `bg-accent`) và `.hero-title` (`max-width: 11em`).

### Tương phản đã tính

Chữ thấp nhất 4,68:1 (link trên surface, theme tối). Sáng: foreground trên background 17,98; muted 6,98; link 4,79. Tối: foreground 16,40; muted 7,45; link 5,29. Footer: Paper trên Ink 16,40; muted 7,45. Không phải chữ: khối accent trên background 3,40 (sáng) / 12,47 (tối); ring ≥ 4,68; border-strong ≥ 4,04.

## 2. Component

- **Container:** `mx-auto w-full max-w-container-page px-4 md:px-6 lg:px-8`.
- **Card:** `flex flex-col gap-3 md:gap-4` — không viền, không nền, không bóng; ảnh là bề mặt.
- **Badge:** `inline-flex min-h-6 items-center rounded-sm px-2 text-xs font-semibold uppercase tracking-label`.
  - `neutral`: `bg-surface-muted text-foreground`
  - `sold-out`: `bg-foreground text-background`, nội dung "Hết hàng" (chữ hoa bằng CSS)
- **Price:** `font-mono text-sm md:text-base font-medium text-foreground`, chỉ chứa `formatPrice(amount)`.
- **ProductCard:**
  - Ảnh: `aspect-square overflow-hidden rounded-md bg-surface-muted outline outline-1 -outline-offset-1 outline-border`, `next/image` 800×800, `alt` = tên sản phẩm. Hết hàng **không** làm mờ ảnh.
  - Hàng meta: danh mục `text-xs uppercase tracking-label text-muted-foreground` + Badge `sold-out` khi hết hàng.
  - Tên: `h3`, `text-base md:text-xl font-semibold text-pretty`. Từ chứa `--` (ví dụ "git push --force") bọc trong `<span class="whitespace-nowrap">` để không bị tách dòng trên mobile; giữ nguyên nội dung chữ để h3 bằng với `alt` ảnh (Lexend không có glyph U+2011).
  - Giá: `mt-auto pt-1 md:pt-2`; hết hàng → `text-muted-foreground`.
- **Lưới:** `ul` `aria-label="Sản phẩm nổi bật"`, `grid grid-cols-2 gap-x-4 gap-y-10 md:grid-cols-3 md:gap-x-8 md:gap-y-16`.
- **Header:** `border-b border-border h-16` (không nền riêng), chứa Container; chỉ có link logo chữ: `min-h-11 text-2xl/7 font-bold tracking-tight` + `.cursor-block` tĩnh.
- **Hero:** `pt-14 pb-12 md:pt-28 md:pb-24 gap-6 md:gap-8`; eyebrow "Áo thun · Cốc · Sticker · Sách" (`text-xs uppercase tracking-label text-muted-foreground`); h1 `.hero-title text-5xl md:text-8xl font-bold tracking-tight text-balance` "Đồ dùng cho dân code." + `.cursor-block` nhấp nháy (`motion-reduce` tắt); lead `text-lg md:text-xl text-muted-foreground`.
- **Section nổi bật:** `border-t border-border pt-10 md:pt-16`; h2 "Sản phẩm nổi bật" `text-2xl md:text-3xl font-bold tracking-tight`.
- **Empty state:** `rounded-md bg-surface-muted px-6 py-10 md:p-16`, `.cursor-block` tĩnh 32 px, "Chưa có sản phẩm nổi bật." (`text-xl md:text-2xl font-semibold`) + một dòng phụ.
- **Footer:** luôn trên Ink (`bg-inverse text-inverse-foreground`), hai cột trên desktop: chữ `next-store` (`text-3xl md:text-4xl`, con trỏ `inverse-accent`) + mô tả; dòng "Thanh toán đang chạy ở chế độ thử nghiệm, chưa thu tiền thật." + dòng mono `git commit -m "bán hàng bằng cà phê"`. Hàng cuối, sau đường kẻ `border-inverse-border`: "một dự án của" + lockup `gin-pham-horizontal-dark.svg` rộng 160 px (mobile) / 176 px (desktop). Không có năm hay giá trị đổi theo thời gian. Focus trong footer dùng `inverse-accent`.
- **Focus:** `outline-2 outline-offset-2 outline-ring` trên mọi phần tử tương tác.

## 3. Tài nguyên

| File trong repo | Nguồn |
|---|---|
| `public/images/{ao-thun,coc,sticker,sach}.svg` | Designer v2 (chỉ Ink/Paper + một khối cyan, nền xen kẽ sáng/tối) |
| `src/app/fonts/lexend-full-wght.woff2` | Brand kit `fonts/lexend-full-wght.woff2` (SIL OFL) |
| `public/brand/gin-pham-horizontal-dark.svg` | Brand kit `master/gin-pham-horizontal-dark.svg` (lockup trên nền tối) |
