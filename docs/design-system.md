# Design system: next-store (v2, theo brand Gin Pham)

Nguồn: Designer, ticket NS-24 — **chủ dự án duyệt 2026-11-19**. Bản gốc trên Claude Design:
- Design system: https://claude.ai/artifact/GmucdqjNPKDzHFY4FWZCUj
- Màn hình trang chủ (390 / 1280 px, sáng / tối / trống): https://claude.ai/artifact/Tjc6tnwX3q96CPSxDk2c2r
- Màn hình M2 (danh sách, chi tiết, 404, lỗi; 390 / 1280 px, sáng / tối) và đặc tả component M2: https://claude.ai/artifact/MzW3An6ebYKxUjEMT7tuEU — **chủ dự án duyệt 2026-11-20** (Cổng 2, NS-46)

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

Bổ sung M2, cặp mới (sáng / tối): chữ background trên muted-foreground (primary hover) 6,98 / 7,45; foreground trên surface-muted (hover) 16,45 / 12,08; muted trên surface-muted (dòng phụ empty state) 6,38 / 5,49; muted trên surface (placeholder) 7,46 / 6,60; link trên background (breadcrumb) 4,79 / 5,29. Không phải chữ: border-strong trên background 4,44 / 4,04, trên surface 4,75 / 3,58; ring trên surface-muted 4,39 / 3,89. Không dùng: link trên surface-muted 4,39 / 3,89 (dưới 4,5).

## 2. Component

- **Container:** `mx-auto w-full max-w-container-page px-4 md:px-6 lg:px-8`.
- **Card:** `flex flex-col gap-3 md:gap-4` — không viền, không nền, không bóng; ảnh là bề mặt.
- **Badge:** `inline-flex min-h-6 items-center rounded-sm px-2 text-xs font-semibold uppercase tracking-label`.
  - `neutral`: `bg-surface-muted text-foreground`
  - `sold-out`: `bg-foreground text-background`, nội dung "Hết hàng" (chữ hoa bằng CSS)
- **Price:** `font-mono text-sm md:text-base font-medium text-foreground`, chỉ chứa `formatPrice(amount)`. Trang chi tiết: `className="text-2xl md:text-2xl"`.
- **ProductCard** (M2: là link):
  - Gốc: Card + `relative`.
  - Ảnh: `aspect-square overflow-hidden rounded-md bg-surface-muted outline outline-1 -outline-offset-1 outline-border`, `next/image` 800×800, `alt` = tên sản phẩm. Hết hàng **không** làm mờ ảnh. Ảnh không nằm trong link.
  - Hàng meta: danh mục `text-xs uppercase tracking-label text-muted-foreground` + Badge `sold-out` khi hết hàng.
  - Tên: `h3`, `text-base md:text-xl font-semibold text-pretty break-words` (`break-words` để "Cốc NullPointerException" không tràn sang thẻ bên cạnh ở 390 px). Từ chứa `--` bọc trong `<span class="whitespace-nowrap">`; text của h3 bằng đúng tên.
  - Link trong h3 → `/products/<slug>`: `after:absolute after:inset-0 after:rounded-md underline-offset-4 hover:underline focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:outline-offset-4 focus-visible:after:outline-ring`. Vùng bấm = cả thẻ; focus ring bao cả thẻ. Hết hàng vẫn là link.
  - Giá: `mt-auto pt-1 md:pt-2`; hết hàng → `text-muted-foreground`.
- **Lưới:** `ul` có `aria-label` (trang chủ "Sản phẩm nổi bật", danh sách "Danh sách sản phẩm"), `grid grid-cols-2 gap-x-4 gap-y-10 md:grid-cols-3 md:gap-x-8 md:gap-y-16`.
- **Header:** `border-b border-border h-16` (không nền riêng), chứa Container `flex h-full items-center justify-between gap-4`. Bên trái link logo chữ: `min-h-11 text-2xl/7 font-bold tracking-tight` + `.cursor-block` tĩnh. Bên phải (M2) `nav aria-label="Chính"` với link "Sản phẩm" → `/products`: `inline-flex min-h-11 items-center -mr-2 px-2 font-medium underline-offset-8 hover:underline`; khi đang ở `/products`: `aria-current="page"` + `underline decoration-2`.
- **Hero:** `pt-14 pb-12 md:pt-28 md:pb-24 gap-6 md:gap-8`; eyebrow "Áo thun · Cốc · Sticker · Sách" (`text-xs uppercase tracking-label text-muted-foreground`); h1 `.hero-title text-5xl md:text-8xl font-bold tracking-tight text-balance` "Đồ dùng cho dân code." + `.cursor-block` nhấp nháy (`motion-reduce` tắt); lead `text-lg md:text-xl text-muted-foreground`.
- **Section nổi bật:** `border-t border-border pt-10 md:pt-16`; h2 "Sản phẩm nổi bật" `text-2xl md:text-3xl font-bold tracking-tight`. (M2) Dưới lưới: link "Xem tất cả sản phẩm" → `/products`, `buttonVariants({ variant: 'secondary', className: 'w-full md:w-auto' })`.
- **Empty state:** `rounded-md bg-surface-muted px-6 py-10 md:p-16`, `.cursor-block` tĩnh 32 px, tiêu đề `text-xl md:text-2xl font-semibold` + một dòng phụ `text-muted-foreground`. Không dùng link chữ bên trong (`text-link` trên `surface-muted` chỉ 4,39 / 3,89:1); hành động nếu có là Button.
  - Trang chủ: "Chưa có sản phẩm nổi bật." + "Hàng mới đang được đóng gói, quay lại sau nhé."
  - Danh sách (M2): "Không tìm thấy sản phẩm phù hợp." + "Thử từ khoá khác hoặc bỏ bớt bộ lọc." + link "Xoá bộ lọc" → `/products` dạng `buttonVariants({ variant: 'primary' })`.
- **Footer:** luôn trên Ink (`bg-inverse text-inverse-foreground`), hai cột trên desktop: chữ `next-store` (`text-3xl md:text-4xl`, con trỏ `inverse-accent`) + mô tả; dòng "Thanh toán đang chạy ở chế độ thử nghiệm, chưa thu tiền thật." + dòng mono `git commit -m "bán hàng bằng cà phê"`. Hàng cuối, sau đường kẻ `border-inverse-border`: "một dự án của" + lockup `gin-pham-horizontal-dark.svg` rộng 160 px (mobile) / 176 px (desktop). Không có năm hay giá trị đổi theo thời gian. Focus trong footer dùng `inverse-accent`.
- **Focus:** `outline-2 outline-offset-2 outline-ring` trên mọi phần tử tương tác (global `:focus-visible` trong `globals.css`). Ngoại lệ duy nhất: link của ProductCard vẽ ring trên `::after` (xem trên).

### Component M2

- **Button** (`@/components/ui/button`): `<button>` (`Button`, `type` mặc định `"button"`) và link trông như nút (`buttonVariants()` cho `<Link>`).
  - Chung: `inline-flex min-h-11 items-center justify-center rounded-md border px-6 text-base font-semibold whitespace-nowrap disabled:cursor-not-allowed disabled:border-surface-muted disabled:bg-surface-muted disabled:text-muted-foreground`.
  - `primary`: `border-foreground bg-foreground text-background hover:border-muted-foreground hover:bg-muted-foreground` (đảo Ink/Paper; hover vẫn 6,98 / 7,45:1).
  - `secondary`: `border-border-strong bg-transparent text-foreground hover:bg-surface-muted`.
  - Không cyan, không bóng, không transition. Một vùng hành động có tối đa một nút primary.
- **Input** (`@/components/ui/input`): `min-h-11 w-full rounded-md border border-border-strong bg-surface px-4 text-base text-foreground placeholder:text-muted-foreground`. Chữ 16 px (iOS không phóng to). Luôn có nhãn hiện: `<label htmlFor>` `text-sm font-medium text-foreground` phía trên, cách 8 px. Placeholder chỉ là ví dụ, không thay nhãn.
- **Skeleton** (`@/components/ui/skeleton`): `<div aria-hidden="true">` `rounded-sm bg-border`, không animation. Kích thước qua `className` (`h-5 w-26`, `h-11 rounded-md`, `aspect-square rounded-md`…), cao bằng line-height của nội dung thật để không nhảy layout. Vùng skeleton có `aria-busy="true"` và một `<p className="sr-only">Đang tải sản phẩm…</p>`. (`bg-surface-muted` chỉ 1,09:1 với nền sáng nên không dùng cho skeleton.)
- **StatusMessage** (`@/components/layout/status-message`, trang 404 và lỗi): Container → `flex flex-col items-start gap-6 pt-16 pb-20 md:gap-8 md:pt-32 md:pb-40`; `.cursor-block` tĩnh `size-8`; h1 `text-4xl md:text-5xl font-bold tracking-tight text-balance`; mô tả `max-w-xl text-lg md:text-xl text-muted-foreground`; vùng hành động `flex w-full flex-col gap-4 md:w-auto md:flex-row`, nút `w-full md:w-auto`.
  - 404: "Không tìm thấy trang" / "Trang này không tồn tại hoặc đã bị gỡ." / primary "Xem tất cả sản phẩm" → `/products` + secondary "Về trang chủ" → `/`.
  - Lỗi: "Đã có lỗi xảy ra" / "Không tải được dữ liệu lúc này. Thử lại sau vài giây, hoặc quay về trang chủ." / `Button` primary "Thử lại" + secondary link "Về trang chủ" → `/`.
- **Trang danh sách** `/products`:
  - Vỏ: Container `flex flex-col gap-6 pt-10 pb-16 md:gap-8 md:pt-16 md:pb-24`; h1 "Sản phẩm" `text-4xl md:text-5xl font-bold tracking-tight` (ngoài Suspense).
  - `ProductCatalogView`: `flex flex-col gap-6 md:gap-8` gồm, theo thứ tự DOM:
    1. Hàng điều khiển `flex flex-col gap-6 md:flex-row md:items-end md:justify-between md:gap-8`: form tìm (`next/form` `role="search"`, `flex flex-col gap-2 md:w-96 md:flex-none`; hàng ô + nút `flex gap-2`; nút "Tìm" là Button primary `type="submit"`), rồi nav danh mục.
    2. Thanh kết quả `flex flex-wrap items-center justify-between gap-x-6 border-t border-border pt-4`: `<p role="status" className="font-semibold">{total} sản phẩm</p>` + nav sắp xếp.
    3. Lưới, hoặc empty state.
    4. Phân trang.
- **Link bộ lọc danh mục:** `nav aria-label="Danh mục"` `flex flex-col gap-2`; nhãn hiện "Danh mục" (`text-sm font-medium`, `aria-hidden="true"`); `ul` `flex flex-wrap gap-2`.
  - Link: `inline-flex min-h-11 items-center gap-2 rounded-md border border-border-strong px-4 text-sm font-medium text-foreground hover:bg-surface-muted`.
  - Đang chọn (`aria-current="true"`): `aria-[current=true]:border-foreground aria-[current=true]:bg-foreground aria-[current=true]:font-semibold aria-[current=true]:text-background aria-[current=true]:before:size-2 aria-[current=true]:before:bg-background` — nền đảo + đậm + ô vuông 8 px: không phân biệt chỉ bằng màu.
- **Sắp xếp (nhóm link):** `nav aria-label="Sắp xếp"` `flex flex-wrap items-center gap-x-4`; nhãn "Sắp xếp" `text-sm font-medium text-muted-foreground` (`aria-hidden="true"`); `ul` `flex flex-wrap gap-x-4`.
  - Link: `inline-flex min-h-11 items-center text-sm text-muted-foreground underline-offset-6 hover:text-foreground hover:underline`.
  - Đang chọn: `aria-[current=true]:font-semibold aria-[current=true]:text-foreground aria-[current=true]:underline aria-[current=true]:decoration-2`.
- **Phân trang:** `nav aria-label="Phân trang"` `pt-4 md:pt-8`, chỉ khi `pageCount > 1`; `ul` `flex flex-wrap items-center justify-center gap-2`.
  - Mục: `inline-flex min-h-11 min-w-11 items-center justify-center rounded-md border border-border-strong px-4 text-sm font-medium text-foreground`; link thêm `hover:bg-surface-muted`.
  - Trang hiện tại (link `aria-current="page"`): `aria-[current=page]:border-foreground aria-[current=page]:bg-foreground aria-[current=page]:font-semibold aria-[current=page]:text-background`.
  - Vô hiệu (`<span aria-disabled="true">`, không phải link): `border-dashed border-border text-muted-foreground cursor-not-allowed`.
  - Text của link chỉ là "Trang trước" / "Trang sau" / số trang — không icon bên trong.
- **Trang chi tiết** `/products/<slug>`: Container `flex flex-col gap-4 pt-4 pb-16 md:gap-6 md:pt-6 md:pb-24`.
  - Breadcrumb: `nav aria-label="Đường dẫn"` > `ol` `flex flex-wrap items-center gap-x-2 text-sm`: "Trang chủ" → `/`, "Sản phẩm" → `/products`, tên danh mục → `/products?category=<slug>` (link danh mục duy nhất của trang). Link `inline-flex min-h-11 items-center text-link underline underline-offset-4 hover:decoration-2`; dấu "/" `text-muted-foreground` `aria-hidden`. Không lặp tên sản phẩm.
  - Thân: `grid gap-8 md:grid-cols-2 md:items-start md:gap-16`. Ảnh: như ảnh ProductCard, `priority`. Cột thông tin `flex flex-col gap-6`: h1 `text-3xl md:text-4xl font-bold tracking-tight text-balance break-words`; hàng mua `flex flex-wrap items-center gap-4` = Price `text-2xl` (hết hàng thêm `text-muted-foreground`) + tồn kho; mô tả `border-t border-border pt-6 text-muted-foreground md:text-lg`.
  - Tồn kho: `<p className="font-medium">Còn {stock} sản phẩm</p>`, hoặc `<p><Badge variant="sold-out">Hết hàng</Badge></p>` khi `stock === 0`. Không màu cảnh báo khi còn ít.
  - Chỗ cho M4: nút "Thêm vào giỏ" đặt dưới mô tả trong cột thông tin (`w-full md:w-auto`, Button primary; hết hàng → `disabled`). M2 không render gì ở đó.
  - Skeleton: thay toàn bộ (breadcrumb `h-5 w-52` trong hàng `min-h-11`, ảnh, 2 dòng tiêu đề `h-9`, giá `h-8 w-32`, tồn kho `h-6 w-36`, 3 dòng mô tả `h-4`).

## 3. Tài nguyên

| File trong repo | Nguồn |
|---|---|
| `public/images/{ao-thun,coc,sticker,sach}.svg` | Designer v2 (chỉ Ink/Paper + một khối cyan, nền xen kẽ sáng/tối) |
| `src/app/fonts/lexend-full-wght.woff2` | Brand kit `fonts/lexend-full-wght.woff2` (SIL OFL) |
| `public/brand/gin-pham-horizontal-dark.svg` | Brand kit `master/gin-pham-horizontal-dark.svg` (lockup trên nền tối) |
