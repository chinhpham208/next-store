# Design system: next-store (v2, theo brand Gin Pham)

Nguồn: Designer, ticket NS-24 — **chủ dự án duyệt 2026-11-19**. Bản gốc trên Claude Design:
- Design system: https://claude.ai/artifact/GmucdqjNPKDzHFY4FWZCUj
- Màn hình trang chủ (390 / 1280 px, sáng / tối / trống): https://claude.ai/artifact/Tjc6tnwX3q96CPSxDk2c2r
- Màn hình M2 (danh sách, chi tiết, 404, lỗi; 390 / 1280 px, sáng / tối) và đặc tả component M2: https://claude.ai/artifact/MzW3An6ebYKxUjEMT7tuEU — **chủ dự án duyệt 2026-11-20** (Cổng 2, NS-46)
- Màn hình M3 (blog, bài viết, "Bài viết mới" trên trang chủ, header có "Blog"; 390 / 1280 px, sáng / tối), ảnh Open Graph và nội dung 4 bài: https://claude.ai/artifact/N5Gkua8mA1whwo5PxeHfcX — **chủ dự án duyệt 2026-11-22** (Cổng 2, Task 6 M3)
- Màn hình M4 (biểu tượng giỏ trên header, nút "Thêm vào giỏ", trang `/cart`; 390 / 1280 px, sáng / tối) và đặc tả component M4: https://claude.ai/artifact/XUBrrWUoY6vpLG1mSaVXMk — **chủ dự án duyệt 2026-11-23** (Cổng 2, Task 2 M4)
- Màn hình M5 (đăng nhập quản trị, khung admin, /admin/products, /admin/products/<slug>; 390 / 1280 px, sáng / tối) và đặc tả component M5: https://claude.ai/artifact/HtAXc5E24aKcr1DkHM7J8K — **chủ dự án duyệt 2026-11-25** (Cổng 2, Task 2 M5, NS-117)
- Màn hình M6 (giỏ có nút "Thanh toán" và trạng thái đóng, /checkout/test, /checkout/success, /admin/orders, /admin/errors, thanh admin; 390 / 1280 px, sáng / tối) và đặc tả component M6: https://claude.ai/artifact/VTgtqidTkfm3t1nLduQZMG — **chủ dự án duyệt 2026-11-26** (Cổng 2, Task 3 M6, NS-137)

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

Bổ sung M3, cặp mới (sáng / tối): chữ trong code trong dòng (foreground trên surface-muted) 16,45 / 12,08; chữ trong khối code (foreground trên surface) 19,22 / 14,53; ngày, mô tả, trích dẫn (muted trên background) 6,98 / 7,45; link trong bài (link trên background) 4,79 / 5,29. Không phải chữ: vạch trích dẫn border-strong trên background 4,44 / 4,04; vòng focus của khối code (ring trên background) 4,79 / 5,29. Ảnh Open Graph (một theme, dải đảo): inverse-foreground trên inverse 16,40; inverse-muted trên inverse 7,45; khối con trỏ inverse-accent trên inverse 12,47.
Link trong bài **chỉ** đặt trên `background` (thân bài không có nền riêng). Không đặt link trong khối code hay trong trích dẫn có nền.

Bổ sung M4, cặp mới (sáng / tối), đo bằng công thức WCAG 2.2: thông báo lỗi (danger trên background) 5,75 / 8,04; số trên biểu tượng giỏ và Badge (background trên foreground) 17,98 / 16,40; số khi đang chờ (foreground trên background) 17,98 / 16,40; số trong ô số lượng (foreground trên surface) 19,22 / 14,53; "Đơn giá", "Đang cập nhật…" (muted trên background) 6,98 / 7,45; link "Xem giỏ hàng" (link trên background) 4,79 / 5,29; nút vô hiệu (muted trên surface-muted) 6,38 / 5,49. Không phải chữ: viền ô số lượng (border-strong) trên background 4,44 / 4,04, trên surface 4,75 / 3,58; focus ring vẽ vào trong ô số (ring trên surface) 5,13 / 4,68; ring trên surface-muted (nút "Xem sản phẩm" trong giỏ trống, nút − / + khi hover) 4,39 / 3,89; khối con trỏ trên surface-muted 3,11 / 9,19.
`danger` chỉ dùng cho chữ lỗi vừa xảy ra (`role="alert"`) và ô vuông 8 px đi kèm; không dùng cho tồn kho thấp hay hết hàng.

Bổ sung M5, cặp mới (sáng / tối), đo bằng công thức WCAG 2.2 (`design-work/m5/scripts/contrast_m5.py`): lỗi cạnh ô và lỗi chung (danger trên background) 5,75 / 8,04; gợi ý dưới nhãn, slug, tiêu đề cột, "Đang lưu…" (muted trên background) 6,98 / 7,45; link "Sửa"-breadcrumb "Sản phẩm", "Xem trên cửa hàng" (link trên background) 4,79 / 5,29; chữ gõ trong ô (foreground trên surface) 19,22 / 14,53; nút primary đang gửi (muted trên surface-muted) 6,38 / 5,49. Thanh admin (một theme, dải đảo): inverse-foreground trên inverse 16,40; trên inverse-border (hover "Đăng xuất") 8,73. Không phải chữ: viền ô `aria-invalid` (danger) trên surface 6,15 / 7,12, trên background 5,75 / 8,04; viền ô (border-strong) trên surface 4,75 / 3,58; viền nút "Đăng xuất" (inverse-muted trên inverse) 7,45; focus trên thanh admin (inverse-accent) trên inverse 12,47, trên inverse-border 6,64; ring trên surface 5,13 / 4,68.
Link nằm trong câu lỗi ("Tải lại trang", "Đăng nhập lại", "Về danh sách sản phẩm") giữ màu `danger` + gạch chân, không dùng `text-link` (không thêm màu thứ ba trong một câu).

Bổ sung M6, cặp mới (sáng / tối), đo bằng công thức WCAG 2.2 trên đúng giá trị `globals.css` (`design-work/m6/scripts/contrast_m6.py`): dải "Môi trường thử nghiệm — không thu tiền", Badge "Cần hoàn tiền" (đảo), bộ lọc đang chọn (background trên foreground) 17,98 / 16,40; Badge trung tính và chữ trong hàng `needs_refund` (foreground trên surface-muted) 16,45 / 12,08; thời gian và "Thử nghiệm" trong thẻ `needs_refund` (muted trên surface-muted) 6,38 / 5,49; câu dẫn, "Thanh toán chưa mở.", thông điệp lỗi trong bảng, digest (muted trên background) 6,98 / 7,45; link "N đơn cần hoàn tiền" (link trên background) 4,79 / 5,29; lỗi cạnh nút "Thanh toán" và cổng thử nghiệm (danger trên background) 5,75 / 8,04. Thanh admin (một theme, dải đảo): chữ số trong chip lỗi (inverse trên inverse-foreground) 16,40; link và nút (inverse-foreground trên inverse) 16,40. Không phải chữ: vạch trái 4 px và viền dải hoàn tiền (foreground) trên background 17,98 / 16,40, trên surface-muted 16,45 / 12,08; viền chip bộ lọc, viền nút "Huỷ thanh toán" (border-strong) trên background 4,44 / 4,04; focus ring trên background 4,79 / 5,29, trên surface-muted 4,39 / 3,89; focus trên thanh admin (inverse-accent trên inverse) 12,47; viền chip lỗi (inverse-foreground trên inverse) 16,40.
**Không dùng:** link trên `surface-muted` (4,39 / 3,89, dưới 4,5): hàng và thẻ `needs_refund` không chứa link; mọi link của trang đơn nằm trên nền trang. Viền chip bộ lọc khi hover, cạnh trong (border-strong trên surface-muted) 4,07 / 2,98: cạnh ngoài của chip (trên background, 4,44 / 4,04) mới xác định hình, chữ trong chip 16,45 / 12,08; cùng hình với bộ lọc danh mục M2.
`danger` vẫn chỉ dùng cho chữ lỗi vừa xảy ra (`role="alert"`) và ô vuông 8 px đi kèm. Trạng thái `needs_refund` **không** dùng `danger`: nó là việc cần làm của admin và thông báo bình thường cho khách, không phải lỗi.

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
- **Header:** `border-b border-border h-16` (không nền riêng), chứa Container `flex h-full items-center justify-between gap-4`. Bên trái link logo chữ: `min-h-11 text-2xl/7 font-bold tracking-tight` + `.cursor-block` tĩnh. Bên phải `nav aria-label="Chính"` `-mr-2 flex` gồm, theo thứ tự: "Sản phẩm" → `/products`, "Blog" → `/blog`, rồi slot `cart` (M4, link giỏ, xem Component M4). Hai link chữ: `inline-flex min-h-11 items-center px-2 font-medium underline-offset-8 hover:underline`. `-mr-2` của nav giữ biểu tượng giỏ thẳng mép container. Ở 390 px (đo trên khung thật): khoảng trống giữa logo và nav còn 40 px khi không có số, 20 px với số một chữ số, 16 px với "99+"; không xuống dòng. **Chỉnh ở M4 Task 8 (Orchestrator quyết, 2026-11-23), dưới `sm`:** logo `text-lg/7` (từ `sm:` trở lên `text-2xl/7` như cũ), Container header `gap-2 sm:gap-4`, nav `-mr-1 sm:-mr-2`, hai link chữ `min-w-11 justify-center px-1 sm:px-2`, link giỏ `px-1 sm:px-2`. Lý do: đo trên build thật (Chrome, Lexend đã tải) ở 390 px, bản hand-off chỉ còn 34 px trống khi không có số và **xuống dòng** khi có "1" hay "99+" (logo 140,4 px, "Sản phẩm" 80, "Blog" 35,6, badge "1" 20, "99+" 31,7). Sau khi chỉnh: một dòng ở mọi trường hợp từ 360 px trở lên (khoảng trống logo–nav ở 360 px: 49 / 37 / 25 px với không số / "1" / "99+"); ở 320 px chỉ vừa khít khi không có số (dư khoảng 1 px, Chromium của CI đã xuống dòng) và xuống dòng khi có số, nhưng không cuộn ngang và vùng chạm vẫn ≥ 44 px (320 px là mức tối thiểu; "99+" ở 320 px không thể vừa một dòng nếu giữ vùng chạm 44 px và logo ≥ `text-lg`). Không token mới. Không đánh dấu trang hiện tại (`aria-current`): header là Server Component dùng chung, không biết đường dẫn nếu không thêm Client Component, mà M2 chỉ cho `"use client"` ở `error.tsx` — Orchestrator bỏ yêu cầu này (quyết định ghi trên NS-50); trang `/products` đã có h1 "Sản phẩm".
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
- **Skeleton** (`@/components/ui/skeleton`): `<div aria-hidden="true">` `rounded-sm bg-border`, không animation. Kích thước qua `className` (`h-5 w-26`, `h-11 rounded-md`, `aspect-square rounded-md`…), cao bằng line-height của nội dung thật để không nhảy layout. Vùng skeleton có `aria-busy="true"` và một `<p className="sr-only">Đang tải…</p>`. (`bg-surface-muted` chỉ 1,09:1 với nền sáng nên không dùng cho skeleton.)
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
  - Breadcrumb (`@/components/layout/breadcrumb`, dùng chung với trang bài viết từ M3): `nav aria-label="Đường dẫn"` > `ol` `flex flex-wrap items-center gap-x-2 text-sm`: "Trang chủ" → `/`, "Sản phẩm" → `/products`, tên danh mục → `/products?category=<slug>` (link danh mục duy nhất của trang). Link `inline-flex min-h-11 items-center text-link underline underline-offset-4 hover:decoration-2`; dấu "/" `text-muted-foreground` `aria-hidden`. Không lặp tên sản phẩm.
  - Thân: `grid gap-8 md:grid-cols-2 md:items-start md:gap-16`. Ảnh: như ảnh ProductCard, `loading="eager"` + `fetchPriority="high"` (ảnh LCP; `priority` đã bị bỏ ở Next.js 16). Cột thông tin `flex flex-col gap-6`: h1 `text-3xl md:text-4xl font-bold tracking-tight text-balance break-words`; hàng mua `flex flex-wrap items-center gap-4` = Price `text-2xl` (hết hàng thêm `text-muted-foreground`) + tồn kho; mô tả `border-t border-border pt-6 text-muted-foreground md:text-lg`.
  - Tồn kho: `<p className="font-medium">Còn {stock} sản phẩm</p>`, hoặc `<p><Badge variant="sold-out">Hết hàng</Badge></p>` khi `stock === 0`. Không màu cảnh báo khi còn ít.
  - Chỗ cho M4: nút "Thêm vào giỏ" đặt dưới mô tả trong cột thông tin (`w-full md:w-auto`, Button primary; hết hàng → `disabled`). M2 không render gì ở đó.
  - Skeleton: thay toàn bộ (breadcrumb `h-5 w-52` trong hàng `min-h-11`, ảnh, 2 dòng tiêu đề `h-9`, giá `h-8 w-32`, tồn kho `h-6 w-36`, 3 dòng mô tả `h-4`).

### Component M3

- **Thời gian bài viết** (`<time>`): `<time dateTime="YYYY-MM-DD">{formatDate(publishedAt)}</time>` (ví dụ `16 tháng 11, 2026`), `text-sm text-muted-foreground`; ở trang bài `text-sm md:text-base`. Không icon, không chữ "Đăng ngày". Giá trị không đổi theo thời điểm build (chỉ đọc chuỗi trong registry, `timeZone: 'UTC'`).

- **PostList** (`@/features/blog`, dùng ở `/blog` với `headingLevel={2}` và ở trang chủ với `headingLevel={3}`; một bố cục cho cả hai):
  - `ul` có `aria-label` (`"Danh sách bài viết"` / `"Bài viết mới"`): `flex flex-col border-b border-border`. `posts` rỗng → không render gì.
  - `li` (mục bài viết): `relative grid gap-2 border-t border-border py-6 md:grid-cols-4 md:gap-x-8 md:py-8`. Thứ tự DOM: tiêu đề, `<time>`, mô tả.
  - Tiêu đề `h2`/`h3`: `text-xl font-semibold text-balance break-words md:col-span-3 md:col-start-2 md:text-2xl`; text đúng bằng tiêu đề.
  - Link trong tiêu đề → `/blog/<slug>`: `after:absolute after:inset-0 after:rounded-md underline-offset-4 hover:underline focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:outline-offset-2 focus-visible:after:outline-ring` (cùng cách của ProductCard: cả hàng là vùng bấm, cao ≥ 100 px; ring bao cả hàng).
  - `<time>`: `text-sm text-muted-foreground md:col-start-1 md:row-start-1 md:pt-1 md:text-base` (desktop: cột ngày bên trái, thẳng dòng đầu tiêu đề).
  - Mô tả `<p>`: `text-muted-foreground text-pretty md:col-span-3 md:col-start-2`.

- **Trang `/blog`** (`BlogIndex`): Container `flex flex-col gap-6 pt-10 pb-16 md:gap-8 md:pt-16 md:pb-24` (như `/products`); h1 "Blog" `text-4xl md:text-5xl font-bold tracking-tight`; câu dẫn `max-w-xl text-lg text-muted-foreground md:text-xl` "Ghi chép của next-store về đồ dùng và chuyện nghề của dân code."; rồi PostList (`headingLevel={2}`, `label="Danh sách bài viết"`).
  - Trống: empty state chuẩn (`flex flex-col items-start gap-4 rounded-md bg-surface-muted px-6 py-10 md:p-16`, `.cursor-block size-8`) với `<p className="text-xl font-semibold md:text-2xl">Chưa có bài viết.</p>` + `<p className="text-muted-foreground">Bài đầu tiên đang được viết, quay lại sau nhé.</p>`. Không link chữ bên trong.

- **Trang chủ, section "Bài viết mới"** (`LatestPosts`, dưới "Sản phẩm nổi bật", chỉ render khi có bài): `<section aria-labelledby="latest-posts-heading">` → Container `pb-16 md:pb-24` → `flex flex-col gap-8 border-t border-border pt-10 md:gap-12 md:pt-16` (giống section nổi bật); h2 `id="latest-posts-heading"` "Bài viết mới" `text-2xl md:text-3xl font-bold tracking-tight`; PostList 3 bài (`headingLevel={3}`, `label="Bài viết mới"`); `<p>` link "Xem tất cả bài viết" → `/blog`, `buttonVariants({ variant: 'secondary', className: 'w-full md:w-auto' })`. Không có bài → không có section (không empty state).

- **Trang bài `/blog/<slug>` (PostView):** Container `flex flex-col gap-6 pt-4 pb-16 md:gap-8 md:pt-6 md:pb-24`.
  - Breadcrumb dùng chung `@/components/layout/breadcrumb` (như trang chi tiết sản phẩm, `nav aria-label="Đường dẫn"` > `ol`): "Trang chủ" → `/`, "Blog" → `/blog`. Không lặp tiêu đề bài.
  - `<article className="flex flex-col gap-8 md:gap-12">`: `<header className="flex flex-col gap-4">` gồm h1 `max-w-3xl text-3xl font-bold tracking-tight text-balance break-words md:text-5xl` + `<time>` `text-sm text-muted-foreground md:text-base`; rồi `<Prose>{children}</Prose>`.
  - Sau `article`: `<p className="max-w-xl border-t border-border pt-8 md:pt-12">` chứa link "Tất cả bài viết" → `/blog`, `buttonVariants({ variant: 'secondary', className: 'w-full md:w-auto' })`.
  - Cột đọc căn trái, thẳng mép logo và breadcrumb (như trang sản phẩm).

- **Prose** (`@/components/ui/prose`): `Prose` = `<div className="flex max-w-xl flex-col gap-6 text-base md:gap-8 md:text-lg">`. `max-w-xl` (576 px) giữ dòng ở ~67 ký tự tiếng Việt với chữ 18 px (đo bằng metric của Lexend: trung bình 0,476 em / ký tự), ~47 ký tự ở 390 px. Khoảng cách dọc chỉ do `gap` của khối bọc, phần tử con không có margin (trừ `hr`). `PROSE_COMPONENTS`:

  | Phần tử | Lớp | Ghi chú |
  |---|---|---|
  | `h2` (và `h1` → `h2`) | `pt-6 text-2xl font-bold tracking-tight text-balance md:pt-4 md:text-3xl` | Trên h2 luôn 48 px (24 + 24 / 32 + 16) |
  | `h3` | `pt-2 text-xl font-semibold text-balance md:pt-0 md:text-2xl` | Trên h3 luôn 32 px |
  | `p` | `text-pretty` | |
  | `a` | `text-link underline underline-offset-4 hover:decoration-2` | `href` bắt đầu bằng `/` → `next/link`; còn lại `<a rel="noopener noreferrer">`, không `target="_blank"`. Link trong dòng được miễn vùng chạm 24 px (WCAG 2.5.8 ngoại lệ inline) |
  | `strong` | `font-semibold text-foreground` | `text-foreground` để vẫn đậm màu khi nằm trong trích dẫn muted |
  | `em` | `italic` | Lexend không có bản nghiêng: trình duyệt tự nghiêng, đã kiểm dấu tiếng Việt vẫn đúng |
  | `ul` | `flex list-disc flex-col gap-2 pl-6 marker:text-muted-foreground` | Bài chỉ dùng danh sách "chặt" (không dòng trống giữa các mục) để `li` không bọc `<p>` |
  | `ol` | `flex list-decimal flex-col gap-2 pl-6 marker:text-muted-foreground` | |
  | `li` | (không lớp) | |
  | `blockquote` | `flex flex-col gap-4 border-l-4 border-border-strong pl-4 text-muted-foreground md:pl-6` | Không nền (link trên surface-muted không đạt 4,5:1), không nghiêng |
  | `code` trong dòng (không có `className`) | `rounded-sm bg-surface-muted px-1 font-mono text-sm break-words md:text-base` | `break-words` để `--force-with-lease` không tràn ở 390 px |
  | `code` trong khối (`className="language-…"`) | chỉ giữ `className`, không thêm lớp | Kế thừa từ `pre`. **Mọi khối code rào trong bài phải ghi ngôn ngữ** (```` ```bash ````) — đó là cách duy nhất `code` phân biệt khối với trong dòng |
  | `pre` | `overflow-x-auto rounded-md border border-border bg-surface p-4 font-mono text-sm md:p-6` + `tabIndex={0}` | Vùng cuộn ngang focus được bằng bàn phím; focus ring là `:focus-visible` toàn cục (2 px `ring`, offset 2). Không `aria-label` (vai trò generic không được đặt tên). Không tô màu cú pháp |
  | `hr` | `my-4 border-border` | |

  Tiêu đề trong bài không có `id` / anchor (không có mục lục — ngoài phạm vi M3).

  Quy tắc "mọi khối code rào ghi ngôn ngữ" được kiểm tự động: Vitest `every fenced code block in a post names its language` (`src/features/blog/posts.test.ts`).

### Component M4

- **CartIcon** (`@/components/ui/cart-icon`, mới, không hook): props `{ className?: string }`; `<svg viewBox="0 0 24 24" className={cn('size-6', className)}` fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">` với
  `<path d="M2 3h3l2.6 11.2a1 1 0 0 0 1 .8h9.2a1 1 0 0 0 1-.8L21 7H6"/><circle cx="9.5" cy="19.5" r="1.5"/><circle cx="17.5" cy="19.5" r="1.5"/>`.
  Là biểu tượng duy nhất của site. Chỉ dùng trong link giỏ.

- **CartLink** (`src/features/cart/components/cart-link.tsx`) và **StaticCartLink** (`cart-badge.tsx`, cùng class, không số):
  - Link `href="/cart"`: `inline-flex min-h-11 min-w-11 items-center justify-center gap-1 rounded-md px-2 hover:bg-surface-muted`. Bên trong là `<CartIcon className="shrink-0" />` rồi badge nếu có. Badge đứng **cạnh** biểu tượng (`gap-1`), không đè lên: bản đè đã thử, "99+" che gần hết hình giỏ. Link rộng 44 px khi không có số, 64 px với "1", 68 px với "99+". **[Cổng 2 #1]** Không có chữ hiện ra; tên truy cập nằm ở `aria-label`.
  - `aria-label`: `n > 0` → `` `Giỏ hàng, ${n} sản phẩm` `` (số thật, kể cả khi trên 99); còn lại → `"Giỏ hàng"`. Với `n = count + pendingDelta` (count `null` coi là 0).
  - Badge chỉ render khi `n > 0`: `<span aria-hidden="true" data-pending={pendingDelta > 0 || undefined} className="inline-flex h-5 min-w-5 items-center justify-center rounded-sm border border-foreground bg-foreground px-1 font-mono text-xs font-semibold text-background data-pending:bg-background data-pending:text-foreground">`. Nội dung: `n > 99 ? '99+' : String(n)` **[Cổng 2 #2]**.
  - Đang chờ server (`pendingDelta > 0`): badge rỗng ruột (nền background, viền và chữ foreground). Server xác nhận thì về dạng đặc **[Cổng 2 #3]**. Hai dạng khác nhau về hình, không chỉ về màu. Không chuyển động.
  - Không có số trong ba trường hợp, cùng một hình: chưa có giỏ hoặc giỏ có 0 sản phẩm, đang tải (Suspense fallback `<CartLink count={null} />`), và đọc số lỗi (`CartBadge` bắt lỗi).
  - **Không** đặt `aria-live` trên link hay badge. Link nằm trong vùng live sẽ bị đọc lại mỗi lần render, và lúc đó người dùng đang ở nút "Thêm vào giỏ" chứ không ở header. Kết quả được báo qua vùng status / alert cạnh nút (AddToCartForm) và vùng status ẩn của trang giỏ (CartView).

- **QuantityStepper** (`@/components/ui/quantity-stepper`, mới; component trình bày, **không hook, không `"use client"`**, chỉ được import từ các file client của `src/features/cart`):
  - Props: `{ inputId: string; name?: string; value: string; min: number; max: number; onValueChange: (value: string) => void; onStep: (next: number) => void; decreaseLabel: string; increaseLabel: string; canIncrease?: boolean; inputLabel?: string; describedBy?: string }`. `value` là chuỗi để ô có thể trống trong lúc gõ. `inputLabel` set thì thành `aria-label` của ô; không set thì caller phải có `<label htmlFor={inputId}>`.
  - Gốc: `inline-flex w-fit items-stretch rounded-md border border-border-strong bg-surface` (44 + 48 + 44 px, cao 46 px kể cả viền).
  - Nút "−" (U+2212) và "+": `<button type="button" aria-label={…}>` `inline-flex size-11 items-center justify-center text-xl font-medium text-foreground hover:bg-surface-muted focus-visible:-outline-offset-2 disabled:cursor-not-allowed disabled:bg-transparent disabled:text-muted-foreground`, thêm `rounded-l-md` (−) / `rounded-r-md` (+). "−" có `disabled` khi `Number(value) <= min`. "+" có `disabled` khi `Number(value) >= max || canIncrease === false`. Dùng thuộc tính `disabled` thật.
  - Ô số: `<input type="number" inputMode="numeric" step={1} min max id={inputId} name={name} aria-describedby={describedBy}>` `quantity-field w-12 border-x border-border bg-transparent text-center font-mono text-base text-foreground focus-visible:-outline-offset-2`. Vai trò `spinbutton` có sẵn; phím mũi tên dùng được.
  - `globals.css`, `@layer components` (cạnh `.hero-title`):
    ```css
    .quantity-field { appearance: textfield; -moz-appearance: textfield; }
    .quantity-field::-webkit-inner-spin-button,
    .quantity-field::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }
    ```
  - Focus ring vẽ vào trong (`-outline-offset-2`) để nút kế bên không che nó.

- **Thông báo** (không toast **[Cổng 2 #4]**: thông báo đặt ngay dưới điều khiển gây ra nó, không tự biến mất):
  - Đang gửi: `<p className="flex min-h-11 items-center text-muted-foreground">Đang thêm vào giỏ…</p>`.
  - Thành công: `<div className="flex flex-wrap items-center gap-x-4">` gồm `<p className="flex min-h-11 items-center gap-2 font-medium before:size-2 before:shrink-0 before:bg-foreground">Đã thêm vào giỏ hàng</p>` và `<Link href="/cart" className="inline-flex min-h-11 items-center text-link underline underline-offset-4 hover:decoration-2">Xem giỏ hàng</Link>`.
  - Lỗi: `<p className="flex min-h-11 items-center gap-2 font-medium text-danger before:size-2 before:shrink-0 before:bg-danger">{message}</p>`. Trong dòng giỏ thay `min-h-11` bằng `min-h-5 text-sm`.
  - Cảnh báo tồn kho trên dòng giỏ. Đây là trạng thái của dòng, không phải lỗi, nên không dùng đỏ: `<p id={`cart-warning-${slug}`} className="flex items-center gap-2 text-sm font-medium before:size-2 before:shrink-0 before:bg-foreground">{`Chỉ còn ${stock} sản phẩm`}</p>`.
  - Mọi chuỗi có giá trị thay vào là **một** template string (như "Còn N sản phẩm" ở M2), để phần tử chứa đúng chuỗi đó.

- **AddToCartForm** (trang chi tiết, slot `purchase` đặt **sau** đoạn mô tả trong cột thông tin `flex flex-col gap-6`):
  - Gốc: `<section aria-label="Mua hàng" className="flex flex-col gap-4">`.
  - `stock === 0`: chỉ có `<Button type="button" disabled className="w-full md:w-auto md:self-start">Thêm vào giỏ</Button>`. Không có ô số, không có vùng thông báo. Badge "Hết hàng" của M2 ở hàng giá đã giải thích lý do.
  - Còn hàng: `<form noValidate className="flex flex-wrap items-end gap-4">`:
    - `<div className="flex flex-col gap-2"><label htmlFor="quantity" className="text-sm font-medium">Số lượng</label><QuantityStepper inputId="quantity" name="quantity" min={1} max={MAX_LINE_QUANTITY} decreaseLabel="Giảm số lượng" increaseLabel="Tăng số lượng" … /></div>`. `max` là 10, **không** theo tồn kho.
    - `<Button type="submit" aria-busy={pending || undefined} className="flex-1 md:flex-none">Thêm vào giỏ</Button>`.
    - `flex-wrap` (M4 Task 8, Orchestrator quyết 2026-11-23): ô số 136 px + 16 + nút ~148 px không vừa 288 px ở 320 px nên trang cuộn ngang 10 px; dưới ~336 px nút xuống hàng riêng và giãn hết bề rộng, từ đó trở lên giữ đúng hàng của hand-off. E2E `US-04: trang chi tiết còn hàng ở 320 px không cuộn ngang…`. Ở 390 px nút giãn hết phần còn lại của hàng (≈ 204 px). Ở desktop nút rộng theo chữ. Chữ nút **không** đổi khi chờ (giữ tên truy cập), nút **không** vô hiệu khi chờ.
  - Sau form: `<div className="flex flex-col">` gồm `<div role="status">` rồi `<div role="alert">`. Cả hai luôn có trong DOM ngay từ đầu (rỗng). Mỗi lần submit thì xoá nội dung cũ của cả hai.
    - Đang chờ → status "Đang thêm vào giỏ…". `ok: true` → status thành công. `ok: false` → alert `cartErrorMessage(r)`. Action reject → alert `CART_NETWORK_ERROR`.
  - Kiểm ở client trước khi gửi **[Cổng 2 #6]**: giá trị không phải số nguyên, trống hoặc < 1 → alert `QUANTITY_RANGE_MESSAGE` ("Nhập số lượng từ 1 đến 10"); > 10 → alert `cartErrorMessage({ error: 'line-limit' })`. Cả hai trường hợp không gọi action và không tăng số lạc quan.
  - Lỗi thì ô số giữ số khách đã chọn. Số trên biểu tượng tự về giá trị server (`useOptimistic`).
- **Trang `/cart`** (Task 9):
  - `page.tsx`: Container `flex flex-col gap-6 pt-10 pb-16 md:gap-8 md:pt-16 md:pb-24` (như `/products`). `<h1 id="cart-heading" tabIndex={-1} className="text-4xl font-bold tracking-tight md:text-5xl">Giỏ hàng</h1>` nằm **ngoài** Suspense, rồi `<Suspense fallback={<CartSkeleton />}><CartSection /></Suspense>`.
  - `CartView` có hàng: `<div className="flex flex-col gap-6 md:gap-8">` gồm, theo thứ tự:
    1. `<p role="status" className="sr-only">{`Giỏ hàng có ${count} sản phẩm, tổng cộng ${formatPrice(total)}`}</p>`. Đây là vùng live báo tổng tiền mới sau mỗi lần sửa / xoá (US-07). Nó phải ở **cùng vị trí trong cây** ở cả nhánh có hàng và nhánh trống, để React giữ nguyên phần tử khi giỏ về trống.
    2. `<p className="text-muted-foreground">{`${count} sản phẩm`}</p>` (count = tổng số lượng).
    3. `<ul aria-label="Sản phẩm trong giỏ" className="flex flex-col border-b border-border">` chứa các dòng.
    4. Khối tổng (dưới).
  - Dòng `li`: `<li data-cart-line={slug} className="flex flex-wrap gap-4 border-t border-border py-6 md:flex-nowrap md:gap-x-6">`. Có 3 con:
    - Ảnh: `<div className="size-20 shrink-0 overflow-hidden rounded-md bg-surface-muted outline outline-1 -outline-offset-1 outline-border md:size-24">` + `next/image` 96 × 96, `alt=""` (tên sản phẩm đã là link ngay cạnh; ảnh không phải link). Với file `.svg` thì `unoptimized`.
    - Thông tin: `<div className="flex min-w-0 flex-1 flex-col gap-2">`:
      - `<h2 className="text-base font-semibold text-pretty break-words md:text-lg"><Link href={`/products/${slug}`} className="inline-flex min-h-11 items-center underline-offset-4 hover:underline">{renderProductName(name)}</Link></h2>`.
      - `<p className="text-sm text-muted-foreground">Đơn giá <span className="font-mono">{formatPrice(price)}</span></p>`.
      - Nếu `stock === 0`: `<p id={`cart-warning-${slug}`}><Badge variant="sold-out">Hết hàng</Badge></p>`. Nếu `quantity > stock > 0`: cảnh báo "Chỉ còn N sản phẩm" (Thông báo, ở trên).
    - Điều khiển: `<CartLineControls slug name quantity stock lineTotal />` (client), render `<div aria-busy={pending || undefined} className="group/line flex w-full flex-col gap-2 md:w-auto md:items-end">`:
      - Hàng `<div className="flex items-center justify-between gap-4 md:justify-end md:gap-6">` gồm:
        - `<form noValidate className="flex items-center gap-2">` chứa QuantityStepper (`inputId={`quantity-${slug}`}`, `inputLabel={`Số lượng ${name}`}`, `min={0}`, `max={MAX_LINE_QUANTITY}`, `canIncrease={quantity < Math.min(stock, MAX_LINE_QUANTITY)}`, `decreaseLabel={`Giảm số lượng ${name}`}`, `increaseLabel={`Tăng số lượng ${name}`}`, `describedBy` = id cảnh báo và id alert của dòng nếu có) và nút xoá `<button type="button" className="inline-flex min-h-11 min-w-11 items-center justify-center px-2 text-sm font-medium text-foreground underline underline-offset-4 hover:decoration-2">Xoá<span className="sr-only"> {name}</span></button>`.
        - `<p className="font-mono text-base font-medium text-right whitespace-nowrap group-aria-busy/line:text-muted-foreground md:w-32"><span className="sr-only">Thành tiền </span>{formatPrice(lineTotal)}</p>`.
        - **Chỉnh ở M4 Task 9 (NS-94), màn hẹp:** hàng trên thêm `flex-wrap`, thành tiền thêm `ml-auto`. Lý do: đo trên build thật ở 320 px (Chrome, Lexend đã tải), ô số 138 px + 8 + "Xoá" 47 + 16 = 209 px, chỉ còn 79 px trong 288 px của Container, không vừa thành tiền nào ("179.000 ₫" ≈ 86 px, "1.045.000 ₫" ≈ 114 px; lớn nhất có thể 4.500.000 ₫); bản hand-off làm trang cuộn ngang 8 px với thành tiền 7 chữ số và tràn vào lề với 6 chữ số. Khi không vừa, thành tiền xuống hàng riêng ngay dưới, vẫn căn phải: ở 320 px là mọi dòng. Ở 390 px trở lên (khung của hand-off) thành tiền tới 7 chữ số vẫn chung hàng, bố cục giữ đúng hand-off. Không token mới. Cùng cách đã dùng cho form "Thêm vào giỏ" ở Task 8.
      - `<div role="alert" id={`cart-error-${slug}`}>` (lỗi của dòng), rồi khi chờ `<p className="text-sm text-muted-foreground">Đang cập nhật…</p>`.
    - 390 px: ảnh và thông tin ở hàng trên. Điều khiển xuống hàng dưới, rộng hết dòng (`w-full`), vì cột thông tin chỉ còn 262 px, không đủ cho 190 px điều khiển + thành tiền. 1280 px: một hàng, thành tiền là cột 128 px căn phải.
  - Hành vi `CartLineControls`:
    - "−" / "+": đặt state cục bộ của ô ngay, rồi gọi `setCartQuantityAction({ slug, quantity: next })` trong transition. "−" ở 1 → 0 nghĩa là xoá (US-07).
    - Gõ tay: gửi khi Enter (submit form) hoặc blur, và chỉ khi giá trị khác số của server. Trống hoặc không phải số nguyên → trả ô về số server, không gửi. > 10 → alert line-limit, không gửi. < 0 → trả ô về số server, không gửi, không thông báo.
    - Lỗi (`ok: false` hoặc reject): ô về số server, alert của dòng hiện `cartErrorMessage(r)` / `CART_NETWORK_ERROR`.
    - Không vô hiệu điều khiển khi chờ. Tổng tiền và số trên header không lạc quan: chúng đổi khi route render lại (D2).
  - **Focus sau khi xoá** (nút "Xoá", hoặc đặt về 0): trước khi gọi action, ghi lại slug của dòng kế (`li.nextElementSibling`), không có thì dòng trước. Sau khi action resolve `ok: true` (route đã render lại), focus `[data-cart-line="<slug đó>"] h2 a`. Không còn dòng nào → focus `#cart-heading`. Lỗi → giữ focus tại chỗ. Vùng status ẩn đọc tổng mới.
  - Khối tổng: `<div className="flex flex-col gap-4 md:items-end">`:
    - `<dl className="flex w-full items-baseline justify-between gap-4 md:w-auto md:gap-8"><dt className="text-lg font-semibold">Tổng cộng</dt><dd data-testid="cart-total" className="font-mono text-2xl font-medium">{formatPrice(total)}</dd></dl>`.
    - Khi có dòng `quantity > stock` **[Cổng 2 #9]**: `<p className="max-w-xl text-sm font-medium">Có sản phẩm không đủ hàng. Giảm số lượng hoặc xoá dòng có cảnh báo.</p>`.
    - `CheckoutSlot` (xem "Component M6") thay dòng "Thanh toán sẽ mở trong bản cập nhật tới." ở đúng chỗ này: khi mở là nút primary "Thanh toán", khi đóng là dòng "Thanh toán chưa mở.". M4 **không** có nút thanh toán, kể cả nút vô hiệu.
    - `<Link href="/products" className={buttonVariants({ variant: 'secondary', className: 'w-full md:w-auto' })}>Tiếp tục mua sắm</Link>`.
  - Trống (không cookie, giỏ hết hạn, hoặc vừa xoá dòng cuối): `<div className="flex flex-col gap-6 md:gap-8">`:
    - `<p role="status" className="sr-only">Không còn sản phẩm nào trong giỏ</p>`. Chữ khác "Giỏ hàng trống." để `getByText` không khớp hai phần tử.
    - Rồi empty state chuẩn `flex flex-col items-start gap-4 rounded-md bg-surface-muted px-6 py-10 md:p-16`: `.cursor-block size-8`, `<p className="text-xl font-semibold md:text-2xl">Giỏ hàng trống.</p>`, `<p className="text-muted-foreground">Sản phẩm bạn thêm được giữ trong giỏ 30 ngày.</p>` **[Cổng 2 #10]**, `<Link href="/products" className={buttonVariants({ variant: 'primary', className: 'w-full md:w-auto' })}>Xem sản phẩm</Link>`.
  - `CartSkeleton`: `<div aria-busy="true" className="flex flex-col gap-6 md:gap-8"><p className="sr-only">Đang tải…</p>` + `Skeleton h-6 w-24` (dòng đếm). Tiếp theo là `ul aria-hidden="true"` cùng class danh sách, chứa 2 dòng cùng class `li`, mỗi dòng: ảnh `size-20 rounded-md md:size-24`, tên `h-6 w-2/3` (trong hàng `min-h-11 flex items-center`), đơn giá `h-5 w-32`, điều khiển `h-11 w-48 rounded-md`, thành tiền `h-6 w-24`. Cuối cùng là tổng `h-8 w-60` (`md:self-end`).
  - Lỗi tải: `getCart()` ném → `(shop)/error.tsx` M2, không đổi chữ. Header vẫn còn; biểu tượng giỏ không có số.

### Component M5

Khu admin (`src/app/admin/`) nằm ngoài `(shop)`: không header giỏ, không footer cửa hàng, không `CartProvider`. Trang admin dùng `Container`, `Button` / `buttonVariants`, `Input`, `Badge`, `Skeleton`, `StatusMessage` có sẵn; không component UI mới trong `@/components/ui`.

- **AdminShell / thanh admin** (`src/features/admin/components/admin-shell.tsx`, server; nút trong `logout-button.tsx`, `"use client"`) **[Cổng 2 #1]**:
  - `<header className="border-b border-inverse-border bg-inverse text-inverse-foreground">`: dải đảo Ink giống footer, cùng giá trị ở hai theme; theme tối có viền dưới để tách khỏi nền trang (cũng là Ink). Focus trong thanh dùng `inverse-accent`, cùng cách của footer.
  - Container + `flex flex-wrap items-center gap-x-2 sm:gap-x-8 py-2 sm:h-16 sm:flex-nowrap sm:py-0`, gồm theo thứ tự DOM:
    1. Tiêu đề: `<p className="flex min-h-11 w-full items-center text-lg/7 font-bold tracking-tight whitespace-nowrap sm:w-auto">Quản trị next-store<CursorBlock className="bg-inverse-accent" /></p>`. Không phải link, không phải heading (mỗi trang có h1 riêng).
    2. `<nav aria-label="Quản trị" className="-ml-2 flex sm:ml-0">`: link "Sản phẩm" → `/admin/products`, `inline-flex min-h-11 items-center px-2 font-medium underline-offset-8 hover:underline` (như link header cửa hàng). M6 thêm "Đơn hàng" → `/admin/orders` và "Lỗi" → `/admin/errors` (kèm chip số lỗi, xem "Component M6"); ba link cùng lớp `inline-flex min-h-11 min-w-11 items-center justify-center gap-1 px-2 font-medium underline-offset-8 hover:underline`. Không `aria-current` (Server Component không biết đường dẫn; cùng quyết định với header cửa hàng, NS-50).
    3. `<form action={logoutAction} className="ml-auto">` + `<button type="submit" className="inline-flex min-h-11 items-center justify-center rounded-md border border-inverse-muted px-3 sm:px-4 text-sm font-semibold whitespace-nowrap hover:bg-inverse-border">Đăng xuất</button>`.
  - Dưới `sm` (390 px): hai hàng, cao 105 px kể cả viền: tiêu đề một hàng (`w-full`); hàng dưới "Sản phẩm" trái, "Đăng xuất" phải. Thứ tự DOM = thứ tự nhìn = thứ tự Tab. Từ `sm`: một hàng cao 64 px.
  - Trang `/admin/login` dùng cùng header nhưng chỉ có tiêu đề và `<nav aria-label="Quản trị" className="-mr-2 ml-auto flex">` với một link "Về cửa hàng" → `/` (một hàng ở mọi bề rộng, cao 61 px). Không link nào khác về cửa hàng trên trang đăng nhập.
  - `AdminShellSkeleton` (fallback của `<Suspense>` trong `(protected)/layout.tsx`): header chỉ có tiêu đề, không nav, không nút; `main` trống. Không lộ gì của khu admin trước khi kiểm phiên xong.

- **Trang `/admin/login`** (`login/page.tsx`, `login-form.tsx`):
  - Container `flex flex-col gap-6 pt-10 pb-16 md:gap-8 md:pt-16 md:pb-24` (như `/products`). h1 `text-4xl md:text-5xl font-bold tracking-tight` "Đăng nhập quản trị"; `<p className="max-w-xl text-muted-foreground md:text-lg">Khu quản lý sản phẩm của next-store. Chỉ chủ cửa hàng có mật khẩu.</p>`.
  - `<form noValidate className="flex max-w-sm flex-col gap-6">` **[Cổng 2 #2]**:
    - `<div className="flex flex-col gap-2">` gồm `<label htmlFor="admin-password" className="text-sm font-medium">Mật khẩu</label>`, `<Input id="admin-password" name="password" type="password" autoComplete="current-password" required aria-describedby="admin-password-error" aria-invalid={fieldError || undefined} className="aria-invalid:border-danger" />`, rồi `<div role="alert" id="admin-password-error">` (luôn có trong DOM, rỗng khi không lỗi).
    - `<Button type="submit" aria-disabled={pending || undefined} className="w-full md:w-auto md:self-start">Đăng nhập</Button>`.
  - Sau form: `<div role="status">`; khi chờ `<p className="flex min-h-11 items-center text-muted-foreground">Đang đăng nhập…</p>`.
  - Lỗi trong alert: `<p className="flex items-center gap-2 text-sm font-medium text-danger before:size-2 before:shrink-0 before:bg-danger">{loginErrorMessage(error)}</p>`.
  - `aria-invalid="true"` và focus về ô chỉ với `invalid` và `wrong-password`. `locked`, `not-configured`, `unavailable` không đánh dấu ô (lỗi không nằm ở chữ đã gõ). Ô và nút không bao giờ vô hiệu vì khoá.
  - Ô giữ chữ đã gõ sau lỗi (không reset form).

- **Nút đang gửi** (đăng nhập, lưu): chữ giữ nguyên; `aria-disabled="true"` khi `pending`, `onSubmit` gọi `preventDefault()` khi đang chờ (không gửi lần hai: đăng nhập lần hai bị đếm, lưu lần hai thành xung đột). Thêm vào Button: `aria-disabled:cursor-not-allowed aria-disabled:border-surface-muted aria-disabled:bg-surface-muted aria-disabled:text-muted-foreground` (cùng hình `disabled` M2). Chỉ form admin dùng; nút "Thêm vào giỏ" M4 giữ quy tắc không vô hiệu khi chờ.

- **Code (Task 7):** dải Ink dùng chung là `AdminHeader` (`src/features/admin/components/admin-header.tsx`, server) với `layout: 'login'` (một hàng, tiêu đề `w-auto`) hoặc `'shell'` (tiêu đề `w-full sm:w-auto`, hai hàng dưới `sm`); `AdminShell` của Task 8 đặt nav "Sản phẩm" và `LogoutButton` vào slot của nó.
- **Form bắt reject của action** **[Cổng 2 #6]**: `LoginForm` gọi `loginAction` qua một hàm bọc `try/catch`; lỗi chung (mất mạng, 500, id action cũ sau deploy) hiện trong alert dưới ô bằng `LOGIN_NETWORK_ERROR` = "Không kết nối được. Vui lòng tải lại trang và thử lại." (đúng chuỗi `CART_NETWORK_ERROR` M4), không rơi vào error boundary nên ô giữ chữ đã gõ. Redirect của Next.js (đăng nhập đúng) cũng là một reject: `unstable_rethrow` cho nó đi tiếp tới router.
- Chuỗi của trang đăng nhập (bảng "Văn bản chính xác" của mock, `src/features/admin/messages.ts`): `invalid` "Vui lòng nhập mật khẩu."; `wrong-password` "Mật khẩu không đúng." (US-12, không đổi được); `locked` "Đăng nhập sai quá nhiều lần. Vui lòng thử lại sau 15 phút." (chỉ khi IPv4 hay IPv6 /64 của người gửi có 5 lần sai trong 15 phút; không còn khoá toàn cục, NS-132); `not-configured` "Khu quản trị chưa được cấu hình."; `unavailable` "Không đăng nhập được lúc này. Vui lòng thử lại."; chờ "Đang đăng nhập…"; title "Đăng nhập · Quản trị".
- **Trang `/admin/products`** (`(protected)/products/page.tsx`, `admin-product-table.tsx`):
  - Container `flex flex-col gap-6 pt-10 pb-16 md:gap-8 md:pt-16 md:pb-24`. `<h1 id="admin-products-heading" className="text-4xl font-bold tracking-tight md:text-5xl">Sản phẩm</h1>` ngoài Suspense; trong Suspense: `<p className="max-w-xl text-muted-foreground md:text-lg">{`${rows.length} sản phẩm. Sửa được tên, giá, mô tả, tồn kho; ảnh, danh mục và slug đổi qua mã nguồn.`}</p>`, rồi bảng và danh sách thẻ.
  - **Bảng** (từ `md`) **[Cổng 2 #7]**: `<table aria-labelledby="admin-products-heading" className="hidden w-full border-collapse text-left md:table">`.
    - `thead`: `th scope="col"` "Sản phẩm" (`w-full`), "Giá", "Tồn kho", `<span className="sr-only">Thao tác</span>`; lớp `border-b border-border-strong pb-3 text-sm font-medium text-muted-foreground`, cột 2–4 thêm `pl-8 text-right`.
    - `td`: `border-b border-border py-3 align-middle`, cột 2–4 `pl-8 text-right`.
    - Ô sản phẩm: `<p className="font-semibold text-pretty break-words">{renderProductName(name)}</p><p className="font-mono text-sm text-muted-foreground break-all">{slug}</p>`.
    - Giá: `<span className="font-mono font-medium whitespace-nowrap">{formatPrice(price)}</span>`. Tồn kho: `stock > 0` → `<span className="font-mono font-medium">{stock}</span>`, `0` → `<Badge variant="sold-out">Hết hàng</Badge>`. Không màu cho tồn kho thấp.
    - Cột cuối: `<Link href={`/admin/products/${slug}`} aria-label={`Sửa ${name}`} className={buttonVariants({ variant: 'secondary', className: 'px-4' })}>Sửa</Link>`. Tên sản phẩm **không** là link (một link mỗi hàng).
  - **Thẻ** (dưới `md`): `<ul aria-labelledby="admin-products-heading" className="flex flex-col border-b border-border md:hidden">`; `li` `flex items-start justify-between gap-4 border-t border-border py-4` gồm `<div className="flex min-w-0 flex-col gap-1">` (tên, slug như bảng, rồi `<p className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">` giá `font-mono font-medium` + `` `Tồn kho ${stock}` `` với số `font-mono font-medium`, hoặc Badge) và cùng link "Sửa".
  - Bảng và thẻ là hai khối DOM; khối bị ẩn có `display:none` nên không có trong cây truy cập, E2E thấy đúng một link "Sửa {tên}" mỗi sản phẩm.
  - Skeleton (fallback): `<div aria-busy="true" className="flex flex-col gap-6 md:gap-8"><p className="sr-only">Đang tải…</p>` + `Skeleton h-6 w-80 md:h-7 md:w-140` (dòng dẫn), rồi 5 hàng bảng (`md`, cùng `thead`, `aria-hidden`; mỗi hàng `h-6 w-3/5` + `h-5 w-1/3`, `h-6 w-24`, `h-6 w-8`, `h-11 w-16 rounded-md`) / 4 thẻ (dưới `md`, `h-6 w-4/5`, `h-5 w-1/2`, `h-5 w-3/5`, nút `h-11 w-16 rounded-md`).

- **Trang `/admin/products/<slug>`** (`(protected)/products/[slug]/page.tsx`, `product-edit-form.tsx`):
  - Container `flex flex-col gap-6 pt-4 pb-16 md:gap-8 md:pt-6 md:pb-24` (như trang chi tiết).
  - Breadcrumb dùng chung `@/components/layout/breadcrumb`, một mục: "Sản phẩm" → `/admin/products`.
  - Đầu trang `<div className="flex flex-col gap-2">`: `<p className="text-xs font-medium uppercase tracking-label text-muted-foreground">Sửa sản phẩm</p>`; `<h1 className="text-3xl font-bold tracking-tight text-balance break-words md:text-4xl">{renderProductName(name)}</h1>` (tên đã lưu; render lại sau khi lưu); `<p className="text-sm text-muted-foreground">Slug (không đổi được): <code className="font-mono text-foreground">{slug}</code></p>`. Slug là chữ, không phải ô vô hiệu.
  - `<form noValidate className="flex max-w-xl flex-col gap-6">`, thứ tự DOM: input ẩn `slug`, `expectedUpdatedAt`; Field Tên; `<div className="grid gap-6 md:grid-cols-2">` Field Giá + Field Tồn kho; Field Mô tả; `<Button type="submit" aria-disabled={pending || undefined} className="w-full md:w-auto md:self-start">Lưu</Button>`; `<div className="-mt-2 flex flex-col"><div role="status">…</div><div role="alert">…</div></div>`.
  - **Field** (nội bộ của form, không phải component UI chung): `<div className="flex flex-col gap-2">` = nhãn → gợi ý → ô → lỗi **[Cổng 2 #3]**:
    - `<label htmlFor={id} className="text-sm font-medium">`; `<p id={`${id}-hint`} className="text-sm text-muted-foreground">`; ô; nếu có lỗi `<p id={`${id}-error`} className="flex items-center gap-2 text-sm font-medium text-danger before:size-2 before:shrink-0 before:bg-danger">{productEditErrorMessage(field, error)}</p>`.
    - Ô: `Input` + `aria-invalid:border-danger`; `aria-invalid="true"` khi có lỗi; `aria-describedby` = `` `${id}-hint ${id}-error` `` khi có lỗi, `` `${id}-hint` `` khi không.

    | Ô | id / name | Nhãn | Gợi ý | Ô nhập |
    |---|---|---|---|---|
    | Tên | `product-name` / `name` | Tên | Tối đa 120 ký tự. | `Input` |
    | Giá | `product-price` / `price` | Giá (₫) | Chỉ gõ chữ số, đơn vị đồng. Ví dụ: 199000. | `Input type="text" inputMode="numeric" autoComplete="off" className="font-mono …"` |
    | Tồn kho | `product-stock` / `stock` | Tồn kho | 0 là hết hàng: cửa hàng hiện "Hết hàng" và khoá nút "Thêm vào giỏ". | như Giá |
    | Mô tả | `product-description` / `description` | Mô tả | Tối đa 2.000 ký tự. | `<textarea rows={4}>` cùng lớp `Input` + `min-h-32 py-3 resize-y` |

    Không `type="number"` (nuốt "-" và "e", không nhận dấu chấm hàng nghìn), không `maxLength` (cắt chữ âm thầm): server trả lỗi có chữ.
  - Lỗi ô: focus về ô lỗi đầu tiên theo thứ tự DOM (Tên, Giá, Tồn kho, Mô tả). Không thêm câu tóm tắt vào `role="alert"` (focus + mô tả của ô đã đọc lỗi). Ô giữ chữ đã gõ.
  - Thông báo (mẫu M4, không toast, không tự biến mất; gửi lần mới thì xoá nội dung cũ):
    - Chờ: status `<p className="flex min-h-11 items-center text-muted-foreground">Đang lưu…</p>`.
    - `saved`: status `<div className="flex flex-wrap items-center gap-x-4"><p className="flex min-h-11 items-center gap-2 font-medium before:size-2 before:shrink-0 before:bg-foreground">Đã lưu.</p><Link href={`/products/${slug}`} className="inline-flex min-h-11 items-center text-link underline underline-offset-4 hover:decoration-2">Xem trên cửa hàng</Link></div>`. Sau đó `expectedUpdatedAt` = `updatedAt` mới.
    - Lỗi chung: alert `<p className="flex min-h-11 items-center gap-2 font-medium text-danger before:size-2 before:shrink-0 before:bg-danger"><span>…</span></p>`; link trong câu `underline underline-offset-4 hover:decoration-2` (màu kế thừa `danger`; được miễn kích thước tối thiểu theo ngoại lệ "inline" của WCAG 2.5.8). Text của `p` đúng bằng chuỗi trong bảng dưới **[Cổng 2 #4]**:

    | State | Chuỗi (phần in đậm là link) | Link tới |
    |---|---|---|
    | `error: 'conflict'` | Sản phẩm vừa được sửa ở nơi khác. **Tải lại trang** để xem bản mới nhất. | chính trang (`/admin/products/<slug>`) |
    | `error: 'unauthorized'` | Phiên đăng nhập đã hết. **Đăng nhập lại**. | `/admin/login` (chỉ khi action tự từ chối, ví dụ gọi qua `/admin/login`) |
    | `error: 'unavailable'` | Không chắc thay đổi đã được lưu. **Tải lại trang** để xem dữ liệu hiện tại rồi thử lại. | chính trang |
    | `error: 'not-found'` | Sản phẩm này không còn trong cửa hàng. **Về danh sách sản phẩm**. | `/admin/products` |
    | `formError: 'invalid'` | Biểu mẫu đã cũ. **Tải lại trang** rồi sửa lại. | chính trang |
    | action reject còn phiên (mất mạng, 500, id action cũ) **[Cổng 2 #6]** | Không kết nối được. Vui lòng tải lại trang và thử lại. (`PRODUCT_EDIT_NETWORK_ERROR` = `CART_NETWORK_ERROR`) | — |
    | action reject khi hết phiên (proxy 401) **[Cổng 2 #6]** | không hiện gì: cả tab tải `/admin/login` (`HEAD /admin/_session-probe` nhận 307) | `/admin/login` |

- **Lỗi và 404 trong khu admin** **[Cổng 2 #5]**: `StatusMessage` M2 bên trong khung admin (thanh trên vẫn còn).
  - `src/app/admin/(protected)/error.tsx` (`"use client"`): "Đã có lỗi xảy ra" / "Không tải được dữ liệu lúc này. Thử lại sau vài giây." / `Button` primary "Thử lại". Không "Về trang chủ".
  - `src/app/admin/(protected)/products/[slug]/not-found.tsx`: "Không tìm thấy sản phẩm" / "Không có sản phẩm nào với đường dẫn này." / link primary "Về danh sách sản phẩm" → `/admin/products`.

#### Chuỗi mới của M5 (Designer, duyệt ở Cổng 2)

| Chỗ | Chuỗi | File đề xuất |
|---|---|---|
| Đăng nhập, dòng dẫn | Khu quản lý sản phẩm của next-store. Chỉ chủ cửa hàng có mật khẩu. | `login/page.tsx` |
| Đăng nhập, chờ | Đang đăng nhập… | `admin/messages.ts` |
| Danh sách, dòng dẫn | `${n} sản phẩm. Sửa được tên, giá, mô tả, tồn kho; ảnh, danh mục và slug đổi qua mã nguồn.` | `products/page.tsx` |
| Thẻ 390 | `Tồn kho ${stock}` | `admin-product-table.tsx` |
| Bảng, cột cuối (sr-only) | Thao tác | `admin-product-table.tsx` |
| Form, nhãn trên h1 | Sửa sản phẩm | `[slug]/page.tsx` |
| Form, slug | Slug (không đổi được): | `[slug]/page.tsx` |
| Gợi ý 4 ô | xem bảng Field | `edit-messages.ts` (`PRODUCT_EDIT_HINTS`) |
| Lưu, chờ | Đang lưu… | `edit-messages.ts` |
| Lỗi chung `unavailable`, `not-found`, `formError` | xem bảng thông báo | `edit-messages.ts` (`productEditStateMessage`) |
| Lỗi / 404 khu admin | xem trên | `error.tsx`, `not-found.tsx` |

Chuỗi không đổi được: "Mật khẩu không đúng." (US-12), "Giá không được âm", "Tên không được để trống" (US-13).
- **Code (Task 10, NS-125):** bảng / thẻ / skeleton là `AdminProductTable`, `AdminProductTableView`, `AdminProductTableSkeleton` (`src/features/products/components/admin-product-table.tsx`, server). Form là `ProductEditForm` (`src/features/products/components/product-edit-form.tsx`, `"use client"`), nằm ở `features/products` cạnh action (audit PR #107 M-2), `ProductEditFormView` là phần không hook để test. Gợi ý và chuỗi mất mạng: `PRODUCT_EDIT_HINTS`, `PRODUCT_EDIT_NETWORK_ERROR` (`edit-messages.ts`). Mô tả dùng `INPUT_CLASS` của `@/components/ui/input` trên `<textarea>`. `error.tsx` admin có `<title>` "Đã có lỗi xảy ra · Quản trị"; trang sửa slug lạ có title "Không tìm thấy sản phẩm · Quản trị" (status vẫn 200 vì trang đã stream, `noindex`).

### Component M6

Cửa hàng (`(shop)`): nút "Thanh toán" trong giỏ, cổng thanh toán thử nghiệm `/checkout/test`, trang xác nhận `/checkout/success`. Khu admin (`src/app/admin/(protected)/`): `/admin/orders`, `/admin/errors`, thanh admin có thêm hai link. Dùng `Container`, `Button` / `buttonVariants`, `Badge`, `Skeleton`, `StatusMessage`, `CursorBlock`, bộ lọc danh mục M2, phân trang M2 có sẵn.

- **CheckoutSlot và CheckoutButton** (`src/features/checkout/components/checkout-slot.tsx` server; `checkout-button.tsx` `"use client"`) — thay dòng "Thanh toán sẽ mở…" của M4, đúng chỗ đó trong khối tổng của `/cart` (dưới "Tổng cộng" và câu "Có sản phẩm không đủ hàng…", trên link "Tiếp tục mua sắm"):
  - `CheckoutSlot` đặt trong `<Suspense fallback={<CheckoutSlotFallback />}>`, trả một trong ba **[Cổng 2 #6, #7]**:
    - `open` → `<CheckoutButton />`.
    - `not-open` (khách trên Production, quyết định 14A) → `<p className="flex min-h-11 items-center text-sm text-muted-foreground">Thanh toán chưa mở.</p>`: cùng kiểu chữ và cùng chỗ với dòng M4 (muted 6,98 / 7,45:1); khung `min-h-11` căn giữa dọc để vùng không đổi chiều cao khi Suspense xong (nút cao 44 px, dòng chữ 20 px). Không nút, kể cả nút vô hiệu; không gợi ý cách mở.
    - `not-configured` → cùng lớp, chữ "Thanh toán chưa được cấu hình.".
  - `CheckoutSlotFallback`: `<Skeleton className="h-11 w-37 rounded-md md:self-end" />` (148 px, đúng cỡ nút "Thanh toán" ở md; ở 390 nút thật giãn hết hàng, chiều cao không đổi nên không nhảy).
  - `CheckoutButton`: `<form action={formAction} noValidate className="flex w-full flex-col md:w-auto md:items-end">`, rồi `<Button type="submit" aria-disabled={pending || undefined} className="w-full md:w-auto">Thanh toán</Button>` (Button primary M2; `aria-disabled` dùng lớp `aria-disabled:*` đã thêm ở M5, không đổi `Button`). Khi chờ `onSubmit` gọi `preventDefault()` (bấm lần hai không tạo thêm đơn `pending`). Chữ nút không đổi khi chờ. Nút **luôn hiện** khi `open`, kể cả giỏ có dòng vượt tồn kho (server quyết).
  - Dưới nút, hai vùng luôn có trong DOM, xoá nội dung cũ mỗi lần gửi (mẫu M4): `<div role="status">` (chờ: `<p className="flex min-h-11 items-center text-muted-foreground">Đang chuyển tới thanh toán…</p>`) và `<div role="alert">` (lỗi: `<p className="flex min-h-11 items-center gap-2 font-medium text-danger before:size-2 before:shrink-0 before:bg-danger">{checkoutErrorMessage(error)}</p>`, dòng dài `md:max-w-xl`).
  - Khối tổng của giỏ không đổi class: `<div className="flex flex-col gap-4 md:items-end">`; slot là một con trực tiếp của khối đó.

- **TestBanner** — dải "Môi trường thử nghiệm — không thu tiền" ở `/checkout/test` **[Cổng 2 #1]**:
  - Đặt ngay dưới header, trước Container của trang, chỉ khi cổng thật sự được dựng (có quyền và có đơn; không hiện ở "Thanh toán chưa mở.", "Không tìm thấy đơn hàng.").
  - `<div className="bg-foreground text-background"><Container className="flex min-h-12 items-center py-3 text-base font-semibold md:text-lg"><p>Môi trường thử nghiệm — không thu tiền</p></Container></div>`. Cặp đảo Ink/Paper như nút primary (17,98 / 16,40:1), rộng hết bề ngang, tối đa hai dòng ở 390. Không `role`, không nút đóng: luôn thấy theo plan.

- **OrderSummary** (`src/features/checkout/components/order-summary.tsx`, server; dùng ở `/checkout/test` và `/checkout/success`):
  - `<section aria-labelledby="order-code" className="flex w-full flex-col gap-4 md:max-w-2xl">`:
    1. `<h2 id="order-code" className="text-xl font-semibold md:text-2xl">{`Mã đơn #${id}`}</h2>` (một template string).
    2. `<ul aria-label="Sản phẩm trong đơn" className="flex flex-col border-b border-border">`; `li` `flex items-start justify-between gap-4 border-t border-border py-4` gồm `<p className="font-semibold text-pretty break-words">{`${name} × ${quantity}`}</p>` và `<p className="font-mono font-medium whitespace-nowrap"><span className="sr-only">Thành tiền </span>{formatPrice(lineTotal)}</p>`. Không ảnh (đơn là bản chụp: tên, số lượng, giá).
    3. `<dl className="flex w-full items-baseline justify-between gap-4"><dt className="text-lg font-semibold">Tổng cộng</dt><dd className="font-mono text-2xl font-medium">{formatPrice(total)}</dd></dl>`.

- **Trang `/checkout/test`** (`test/page.tsx`, `test-gateway-view.tsx`, `fake-gateway.tsx` `"use client"`):
  - Dưới header: `TestBanner`; rồi Container `flex flex-col items-start gap-6 pt-10 pb-16 md:gap-8 md:pt-16 md:pb-24` gồm: `<h1 className="text-4xl font-bold tracking-tight text-balance md:text-5xl">Cổng thanh toán thử nghiệm</h1>`; `<p className="max-w-xl text-lg text-muted-foreground md:text-xl">Chọn kết quả thanh toán để thử luồng đặt hàng. Không có khoản tiền nào được chuyển.</p>`; `OrderSummary`; (nếu đơn không còn `pending`) khối "đã xử lý"; `FakeGateway`.
  - **FakeGateway** (`"use client"`): `<div className="flex w-full flex-col gap-2">`; hàng nút `flex w-full flex-col gap-4 md:w-auto md:flex-row`: `<Button type="button" aria-disabled={pending || undefined} className="w-full md:w-auto">Thanh toán thành công</Button>` (primary, đứng trước theo DOM và Tab) và `<Button type="button" variant="secondary" aria-disabled={pending || undefined} className="w-full md:w-auto">Huỷ thanh toán</Button>`. Hai vùng `role="status"` / `role="alert"` dưới hàng nút như `CheckoutButton`: chờ "Đang gửi kết quả thanh toán…"; lỗi "Không gửi được kết quả thanh toán. Vui lòng thử lại." (kiểu lỗi M4); hai nút bấm lại được sau lỗi. Khi chờ cả hai `aria-disabled`, chữ giữ nguyên.
  - Đơn đã xử lý (`paid`, `needs_refund`, `cancelled`): trên `FakeGateway` thêm `<div className="flex flex-col gap-2"><p className="flex flex-wrap items-center gap-2 font-medium">Trạng thái đơn: <Badge …>{nhãn}</Badge></p><p className="max-w-xl text-sm text-muted-foreground">Đơn này đã được xử lý. Bấm lại sẽ gửi lại cùng một kết quả thanh toán, để thử webhook gửi lặp.</p></div>`. Nhãn và biến thể Badge như bảng đơn (xem dưới). **Hai nút vẫn có và bấm được** (công cụ thử idempotency).
  - Không mở (`not-open`) **[Cổng 2 #7]**: `StatusMessage` M2 (không `TestBanner`, không đọc đơn): title `Thanh toán chưa mở.`, description "Sản phẩm trong giỏ vẫn được giữ.", một nút `buttonVariants({ variant: 'primary', className: 'w-full md:w-auto' })` "Về giỏ hàng" → `/cart`. `not-configured`: cùng khung, title "Thanh toán chưa được cấu hình.". Không tìm thấy (status 200): title "Không tìm thấy đơn hàng.", description "Đường dẫn không đúng hoặc đã cũ.", nút "Về giỏ hàng".
  - Lỗi trả từ `fakeGatewayAction` (không phải lỗi gửi): `not-open` → "Thanh toán chưa mở."; `not-found` → "Không tìm thấy đơn hàng."; `not-configured` → "Thanh toán chưa được cấu hình."; `invalid`, `unavailable` → "Không gửi được kết quả thanh toán. Vui lòng thử lại.".

- **Trang `/checkout/success`** (`success/page.tsx`, `checkout-result.tsx`, server) **[Cổng 2 #8]**:
  - `CheckoutResult` theo `status` (và `refundReason`): Container `flex flex-col items-start gap-6 pt-10 pb-16 md:gap-8 md:pt-16 md:pb-24` gồm `<CursorBlock className="size-8" />`, h1 (`text-4xl font-bold tracking-tight text-balance break-words md:text-5xl`), dòng dẫn (`max-w-xl text-lg text-muted-foreground md:text-xl`), `OrderSummary`, hàng nút `flex w-full flex-col gap-4 md:w-auto md:flex-row` (nút `buttonVariants({ variant: 'primary', className: 'w-full md:w-auto' })` trên `<Link>`). Mọi trạng thái cùng một khung; **không có `danger` ở trạng thái nào** (không phải lỗi kỹ thuật).
  - Bảng chữ:

    | Trạng thái | h1 | Dòng dẫn | Nút |
    |---|---|---|---|
    | `paid` | Đặt hàng thành công | Cảm ơn bạn đã mua hàng. | Tiếp tục mua sắm → `/products` |
    | `pending` | Đang xác nhận thanh toán… | Chưa nhận được kết quả từ cổng thanh toán. Đợi vài giây rồi tải lại trang. | Tải lại trang → chính trang (pathname + `?ref=`) |
    | `needs_refund`, `out-of-stock` | Đã nhận thanh toán, nhưng sản phẩm vừa hết hàng | Chúng tôi đã nhận thanh toán thử nghiệm nhưng sản phẩm trong đơn vừa hết hàng. Cửa hàng sẽ hoàn tiền cho bạn. | Tiếp tục mua sắm → `/products` |
    | `needs_refund`, `amount-mismatch` | Đã nhận thanh toán, nhưng số tiền không khớp | Số tiền nhận được không khớp với đơn hàng. Cửa hàng sẽ hoàn tiền cho bạn. | Tiếp tục mua sắm → `/products` |
    | `cancelled` | Đơn hàng đã huỷ | Thanh toán đã bị huỷ, không có khoản tiền nào bị thu. Sản phẩm vẫn ở trong giỏ hàng của bạn. | Về giỏ hàng → `/cart` |
    | không tìm thấy | Không tìm thấy đơn hàng. | Đường dẫn không đúng hoặc đã cũ. | Tiếp tục mua sắm → `/products` |

  - Không tìm thấy dùng `StatusMessage` (không `OrderSummary`). `pending` vẫn hiện mã đơn và món để khách biết đang chờ đơn nào; không tự tải lại, không vòng quay.

- **Thanh admin** (sửa `AdminShell`, "Component M5") **[Cổng 2 #9]**:
  - `nav aria-label="Quản trị"` có ba link theo thứ tự: "Sản phẩm" → `/admin/products`, "Đơn hàng" → `/admin/orders`, "Lỗi" → `/admin/errors`. Lớp link: `inline-flex min-h-11 min-w-11 items-center justify-center gap-1 px-2 font-medium underline-offset-8 hover:underline`.
  - Chip số lỗi 24 giờ qua, chỉ khi N > 0: `Lỗi<span className="sr-only">{` (${n} lỗi trong 24 giờ qua)`}</span><span aria-hidden="true" className="inline-flex h-5 min-w-5 items-center justify-center rounded-sm border border-inverse-foreground bg-inverse-foreground px-1 font-mono text-xs font-semibold text-inverse">{n > 9 ? '9+' : n}</span>` (hình badge giỏ M4 theo màu thanh; tối đa hai ký tự để vừa 390 px).
  - Để ba link và "Đăng xuất" vừa một hàng ở 390 px: container đổi `gap-x-8` thành `gap-x-2 sm:gap-x-8`; nút "Đăng xuất" đổi `px-4` thành `px-3 sm:px-4`. Đo ở 390: thanh vẫn hai hàng, cao 105 px; còn thừa ~5 px (với "9+": ~1 px sau khoảng cách). Quá hẹp (< 360 px) thì nút xuống hàng thứ ba, vẫn dùng được.
  - `AdminShellSkeleton` không đổi (không nav).

- **Trang `/admin/orders`** (`(protected)/orders/page.tsx`, `admin-order-table.tsx`, `order-status-filter.tsx`):
  - Vỏ: Container `flex flex-col gap-6 pt-10 pb-16 md:gap-8 md:pt-16 md:pb-24`. Ngoài Suspense: `<h1 id="admin-orders-heading" className="text-4xl font-bold tracking-tight md:text-5xl">Đơn hàng</h1>` và `<p className="max-w-xl text-muted-foreground md:text-lg">Đơn mới nhất ở trên. Trang này chỉ để xem; hoàn tiền làm ngoài ứng dụng.</p>`. Trong Suspense, theo thứ tự DOM: `RefundStrip`, `OrderStatusFilter`, `<p role="status" className="font-semibold">{`${total} đơn`}</p>`, bảng + thẻ (hoặc empty state), `Pagination`.
  - **RefundStrip** **[Cổng 2 #4]**: chỉ khi `needsRefundCount > 0` và bộ lọc không phải `needs_refund`: `<div className="flex min-h-12 items-center gap-3 rounded-md border-2 border-foreground px-4 before:size-2 before:shrink-0 before:bg-foreground"><Link href="/admin/orders?status=needs_refund" className="inline-flex min-h-11 items-center font-semibold text-link underline underline-offset-4 hover:decoration-2">{`${n} đơn cần hoàn tiền`}</Link></div>`. Link nằm trên background (4,79 / 5,29:1).
  - **OrderStatusFilter**: đúng mẫu "Link bộ lọc danh mục" của M2. `nav aria-label="Trạng thái"` `flex flex-col gap-2`; nhãn hiện "Trạng thái" (`text-sm font-medium`, `aria-hidden="true"`); `ul` `flex flex-wrap gap-2`; link `inline-flex min-h-11 items-center gap-2 rounded-md border border-border-strong px-4 text-sm font-medium text-foreground hover:bg-surface-muted`; đang chọn `aria-current="true"` với `aria-[current=true]:border-foreground aria-[current=true]:bg-foreground aria-[current=true]:font-semibold aria-[current=true]:text-background aria-[current=true]:before:size-2 aria-[current=true]:before:bg-background`. Mục theo thứ tự: "Tất cả" (`/admin/orders`), "Cần hoàn tiền ({N})" (`?status=needs_refund`, luôn có số kể cả 0), "Đã thanh toán" (`paid`), "Chờ thanh toán" (`pending`), "Đã huỷ" (`cancelled`). `parseOrderListParams` đã đưa `status` lạ về `all`; không có mục nào `aria-current` nếu `status` hợp lệ nhưng không nằm trong danh sách (không xảy ra).
  - **Badge trạng thái** **[Cổng 2 #2]**: thêm `attention` vào `BadgeVariant`: `attention: 'bg-foreground text-background'` (cùng lớp `sold-out`, giữ cả hai tên). `pending` "Chờ thanh toán", `paid` "Đã thanh toán", `cancelled` "Đã huỷ" → `neutral`; `needs_refund` "Cần hoàn tiền" → `attention`. Lý do hoàn tiền dưới Badge: `<p className="flex items-center gap-2 text-sm font-medium before:size-2 before:shrink-0 before:bg-foreground">` với `out-of-stock` "Hết hàng khi thanh toán", `amount-mismatch` "Số tiền không khớp". Nhãn và lý do là hằng trong `src/features/orders/` (một nơi, cổng thử nghiệm và trang xác nhận cũng dùng).
  - **Đơn `needs_refund` nổi bật, không chỉ bằng màu** **[Cổng 2 #3]**: (1) Badge đảo màu, (2) dòng lý do có ô vuông, (3) vạch trái 4 px `foreground`, (4) nền `surface-muted`. Ba trạng thái còn lại không có (2)–(4). Hàng nổi bật không chứa link.
  - **Bảng** (từ `md`): `<div className="-mx-4 hidden md:block"><table aria-labelledby="admin-orders-heading" className="w-full border-separate border-spacing-0 text-left">`.
    - Cột: "Mã đơn", "Thời gian", "Sản phẩm" (`w-full`), "Tổng" (`text-right`), "Trạng thái", "Nguồn": `th scope="col"` `whitespace-nowrap border-b border-border-strong pb-3 pl-8 text-sm font-medium text-muted-foreground`; ô đầu `pl-3 border-l-4 border-transparent`; ô cuối `pr-4`.
    - Hàng: `td` `border-b border-border py-4 pl-8 align-top`; ô đầu là `<th scope="row" className="… font-mono font-semibold text-foreground">#{id}</th>` (cùng `border-l-4 border-transparent pl-3`; hàng `needs_refund`: `border-l-foreground`); hàng `needs_refund` `<tr className="bg-surface-muted">`.
    - Thời gian: `font-mono text-sm whitespace-nowrap` (`formatDateTime`, **[Cổng 2 #11]**). Sản phẩm: `<p className="text-pretty break-words">{`${name} × ${quantity}`}{rest > 0 && `, +${rest} món`}</p>` (món đầu rồi số dòng còn lại; một dòng thì bỏ ", +n món"). Tổng: `font-mono font-medium whitespace-nowrap text-right`. Trạng thái: `<div className="flex flex-col items-start gap-1">` Badge + lý do (`whitespace-nowrap`). Nguồn: `whitespace-nowrap` chữ thường "Thử nghiệm" khi `provider = fake` (không Badge: Badge chỉ dành cho trạng thái).
  - **Thẻ** (dưới `md`): `<ul aria-labelledby="admin-orders-heading" className="-mx-4 flex flex-col border-b border-border md:hidden">`; `li` `flex flex-col gap-1 border-t border-border border-l-4 border-l-transparent py-4 pr-4 pl-3` (`needs_refund`: `bg-surface-muted border-l-foreground`) gồm theo thứ tự: `<div className="flex items-center justify-between gap-4"><p className="font-mono font-semibold"><span className="sr-only">Mã đơn </span>#{id}</p><Badge/></div>`; lý do (nếu có); `<p className="text-sm text-muted-foreground"><span className="font-mono">{dateTime}</span> · Thử nghiệm</p>`; tóm tắt món (`text-pretty break-words`); `<p className="font-mono font-medium"><span className="sr-only">Tổng </span>{formatPrice(total)}</p>`. `-mx-4` làm nền và vạch của hàng nổi bật chạm mép màn hình mà chữ vẫn thẳng với h1 (12 + 4 = 16 px).
  - Bảng và thẻ là hai khối DOM; khối bị ẩn có `display:none` nên không có trong cây truy cập, E2E thấy một dòng mỗi đơn (như M5).
  - **Phân trang:** dùng lại phân trang M2, sau khi tách khỏi `ProductQuery` thành props `page`, `pageCount`, `hrefFor` (Task 11); giữ `status`, bỏ `page` ở trang 1; chỉ hiện khi `pageCount > 1`.
  - **Trống:** empty state chuẩn `flex flex-col items-start gap-4 rounded-md bg-surface-muted px-6 py-10 md:p-16` (cursor-block `size-8`, `<p className="text-xl font-semibold md:text-2xl">`, `<p className="text-muted-foreground">`): "Chưa có đơn hàng." / "Đơn hiện ở đây sau khi có người thanh toán." (không có đơn nào, không dải hoàn tiền, không phân trang); "Không có đơn ở trạng thái này." / "Thử một trạng thái khác." + `buttonVariants({ variant: 'secondary', className: 'w-full md:w-auto' })` "Xem tất cả đơn" (bộ lọc không có kết quả; dải hoàn tiền và bộ lọc vẫn hiện). Trang vượt cuối (`total > 0`, danh sách rỗng): "Không có đơn ở trang này." / "Thử một trang khác." + "Về trang đầu" (link bỏ `?page`, giữ `?status`).
  - **Skeleton** (fallback Suspense; h1 và câu dẫn nằm ngoài): `<div aria-busy="true" className="flex flex-col gap-6 md:gap-8"><p className="sr-only">Đang tải…</p>` + hàng 5 chip `Skeleton h-11 rounded-md` (rộng 24 / 40 / 38 / 37 / 26), dòng đếm `h-6 w-16`, rồi 5 hàng bảng (`md`, `aria-hidden`, cùng `thead`; mỗi hàng `h-6` rộng 14 / 32 / 70 % / 24 / 32 / 20) / 4 thẻ (dưới `md`: `h-6 w-16` + `h-6 w-28`, `h-5 w-3/5`, `h-6 w-11/12`, `h-6 w-24`).

- **Trang `/admin/errors`** (`(protected)/errors/page.tsx`, `error-events-table.tsx`):
  - Vỏ như `/admin/orders`; `<h1 id="admin-errors-heading" …>Lỗi</h1>`; `<p className="max-w-xl text-muted-foreground md:text-lg">100 nhóm lỗi gần nhất, lỗi giống nhau gộp một dòng. Chỉ lưu tên lỗi, route và thông điệp cố định; không lưu cookie, query hay header.</p>` (nói rõ dữ liệu được lưu ngay trên trang).
  - **Bảng** (từ `md`, kiểu bảng sản phẩm M5): `<table aria-labelledby="admin-errors-heading" className="hidden w-full border-collapse text-left md:table">`; cột "Lần cuối", "Số lần" (`text-right`), "Loại", "Route", "Lỗi" (`w-full`): `th scope="col"` `whitespace-nowrap border-b border-border-strong pb-3 pl-8 text-sm font-medium text-muted-foreground` (cột đầu bỏ `pl-8`); `td` `border-b border-border py-4 pl-8 align-top` (cột đầu bỏ `pl-8`).
    - Lần cuối: `font-mono text-sm whitespace-nowrap` (`formatDateTime`). Số lần: `font-mono font-medium text-right`. Loại: `font-mono text-sm whitespace-nowrap`, nguyên văn `render` / `route` / `action` (không dịch).
    - Route: `<span className="font-mono text-sm whitespace-nowrap"><b className="font-semibold">{method}</b> {routePath}</span>`.
    - Lỗi: `<p className="font-semibold">{errorName}</p>`; thông điệp cố định (nếu có) `<p className="font-mono text-sm text-muted-foreground break-words">`; `digest` (nếu có, **[Cổng 2 #10]**) `<p className="font-mono text-xs text-muted-foreground">{`digest ${digest}`}</p>`.
    - Không link, không nút xoá, không màu nhấn (đây là bảng tra cứu; lỗi không "đỏ").
  - **Thẻ** (dưới `md`): `<ul aria-labelledby="admin-errors-heading" className="flex flex-col border-b border-border md:hidden">`; `li` `flex flex-col gap-1 border-t border-border py-4` gồm route (`font-mono text-sm font-semibold break-all`, "GET /products/[slug]"), tên lỗi, thông điệp, digest, rồi `<p className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm font-mono">` `{`${count} lần`}`, loại, thời gian.
  - **Trống:** empty state chuẩn: "Chưa ghi nhận lỗi nào trong 30 ngày." / "Lỗi mới sẽ hiện ở đây."; thanh admin không có chip.
  - **Skeleton:** `h1` ngoài Suspense; trong: `Skeleton h-6 w-75 md:h-7 md:w-140` (dòng dẫn), 5 hàng bảng / 4 thẻ cao bằng hàng thật.
  - Lỗi tải và 404: `error.tsx` của khu admin (M5), không đổi.

### Chuỗi mới của M6 (Designer, duyệt ở Cổng 2)

| Chỗ | Chuỗi | File đề xuất |
|---|---|---|
| Giỏ, đang chuyển | Đang chuyển tới thanh toán… | `checkout/messages.ts` |
| Lỗi `over-stock` (đổi so với plan, #5) | Chưa thanh toán được: có sản phẩm không đủ hàng. Giảm số lượng hoặc xoá dòng có cảnh báo. | `checkout/messages.ts` |
| Cổng, dòng dẫn | Chọn kết quả thanh toán để thử luồng đặt hàng. Không có khoản tiền nào được chuyển. | `test/page.tsx` |
| Cổng, đang gửi | Đang gửi kết quả thanh toán… | `fake-gateway.tsx` |
| Cổng, đơn đã xử lý | Trạng thái đơn: {nhãn} · Đơn này đã được xử lý. Bấm lại sẽ gửi lại cùng một kết quả thanh toán, để thử webhook gửi lặp. | `test-gateway-view.tsx` |
| Cổng, không mở / không tìm thấy | Sản phẩm trong giỏ vẫn được giữ. · Đường dẫn không đúng hoặc đã cũ. · Về giỏ hàng | `test/page.tsx` |
| Cổng, chưa cấu hình (#7) | Thanh toán chưa được cấu hình. | `test/page.tsx` |
| Xác nhận, tiêu đề và dòng dẫn | xem bảng ở "Trang `/checkout/success`" | `checkout-result.tsx` |
| Admin, nav | aria-label "Quản trị"; sr-only " ({n} lỗi trong 24 giờ qua)" | `admin-header.tsx` |
| Đơn, câu dẫn | Đơn mới nhất ở trên. Trang này chỉ để xem; hoàn tiền làm ngoài ứng dụng. | `orders/page.tsx` |
| Đơn, bộ lọc | aria-label "Trạng thái"; nhãn hiện "Trạng thái" | `order-status-filter.tsx` |
| Đơn, số đơn | {n} đơn | `orders/page.tsx` |
| Đơn, trống (dòng phụ, nút, trang vượt cuối) | Đơn hiện ở đây sau khi có người thanh toán. · Thử một trạng thái khác. · Xem tất cả đơn · Không có đơn ở trang này. · Thử một trang khác. · Về trang đầu | `admin-order-table.tsx` |
| Lỗi, câu dẫn | 100 nhóm lỗi gần nhất, lỗi giống nhau gộp một dòng. Chỉ lưu tên lỗi, route và thông điệp cố định; không lưu cookie, query hay header. | `errors/page.tsx` |
| Lỗi, cột và thẻ | Lần cuối · Số lần · Loại · Route · Lỗi · {n} lần · digest {mã} | `error-events-table.tsx` |
| Lỗi, trống (dòng phụ) | Lỗi mới sẽ hiện ở đây. | `error-events-table.tsx` |

Chuỗi không đổi được (của plan): "Thanh toán chưa mở.", "Môi trường thử nghiệm — không thu tiền", "Thanh toán thành công", "Huỷ thanh toán", "Không gửi được kết quả thanh toán. Vui lòng thử lại.", "Đặt hàng thành công", "Mã đơn #{số}", "Tiếp tục mua sắm", "Đang xác nhận thanh toán…", "Tải lại trang", "Không tìm thấy đơn hàng.", các nhãn lọc, "N đơn cần hoàn tiền", "Hết hàng khi thanh toán", "Số tiền không khớp", "Thử nghiệm", "Chưa có đơn hàng.", "Không có đơn ở trạng thái này.", "Chưa ghi nhận lỗi nào trong 30 ngày.".

### Ảnh Open Graph (1200 × 630, `src/lib/og-image.tsx`)

Một theme duy nhất (dải đảo, giống footer) vì ảnh không đổi theo người xem. Chỉ flexbox, không grid, không bóng, không gradient; chỉ Lexend 400 và 700 (TTF tĩnh). Màu là hằng trùng giá trị `--color-inverse*`: nền `#0c0f12`, chữ `#e8eef0`, chữ phụ `#9ba2aa`, đường kẻ / viền `#38424c`, khối con trỏ `#2ee6ea`. Cyan chỉ ở khối con trỏ (và khối con trỏ có sẵn trong hình minh hoạ danh mục). `next-store` + khối con trỏ, **không** logo Smile G hay lockup gin pham.

- Gốc: `display:flex; flex-direction:column; justify-content:space-between; padding:64px 80px; background:#0c0f12; color:#e8eef0; font-family:Lexend`.
- Hàng trên: chữ `next-store` 40 px / 700, `letter-spacing:-0.02em`, `line-height:1`; khối con trỏ 20 × 20 px `#2ee6ea`, `margin-left:12px`, `margin-bottom:2px`, không bo góc.
- Hàng giữa: `display:flex; align-items:center; gap:64px`.
  - Cột chữ (`flex:1`, cột, `gap:24px`): eyebrow 24 px / 400, `line-height:1.33`, `letter-spacing:0.14em`, chữ hoa, `#9ba2aa`; tiêu đề 700, `line-height:1.1`, `letter-spacing:-0.02em`, `display:block` + `lineClamp` theo bảng dưới.
  - Hình minh hoạ (khi `illustration` có): `<img>` SVG data URI của `public/images/<danh-mục>.svg`, 320 × 320, `border-radius:16px`, `border:2px solid #38424c`.
- Hàng dưới: `border-top:2px solid #38424c; padding-top:32px`; footer 32 px / 700, `line-height:1.25` (giá `450.000 ₫`, ngày `16 tháng 11, 2026`).

Quy tắc tiêu đề (đếm theo code point: `Array.from(title).length`):

| Có hình minh hoạ (cột chữ 656 px) | Không hình (cột chữ 1040 px) |
|---|---|
| ≤ 24 ký tự: 72 px, tối đa 3 dòng | ≤ 24 ký tự: 96 px, tối đa 2 dòng |
| 25–40: 64 px, 3 dòng | 25–48: 72 px, 3 dòng |
| > 40: 56 px, 3 dòng | > 48: 60 px, 3 dòng |
| > 60 ký tự: cắt ở khoảng trắng cuối cùng trước ký tự thứ 60, bỏ dấu câu cuối, thêm `…` | > 75 ký tự: như vậy với 75 |

`lineClamp` giữ làm lưới an toàn (satori cắt giữa từ); phép cắt theo từ chạy trước nên dấu `…` không rơi giữa từ. Bảng và phép cắt nằm trong `fitOgTitle` (`src/lib/og-image.tsx`), kiểm bằng Vitest `fitOgTitle (Task 6 title rules)`. Bài blog có tiêu đề ≤ 70 ký tự nên không bao giờ bị cắt; sản phẩm dài nhất hiện có (`Sticker It's not a bug, it's a feature`, 38 ký tự) ở 64 px vừa 2 dòng.

Ba loại:

| Route | eyebrow | title | footer | illustration |
|---|---|---|---|---|
| `app/opengraph-image.tsx` | `Áo thun · Cốc · Sticker · Sách` | `Đồ dùng cho dân code.` | `Cửa hàng online cho lập trình viên` | không |
| `products/[slug]/opengraph-image.tsx` | tên danh mục | tên sản phẩm | `formatPrice(price)` | slug danh mục nếu thuộc `ao-thun`, `coc`, `sticker`, `sach`; khác → không hình, tiêu đề dùng cột rộng |
| `blog/[slug]/opengraph-image.tsx` | `Blog` | tiêu đề bài | `formatDate(publishedAt)` | không |

`alt` cố định: mặc định `"next-store: đồ dùng cho dân code"`; sản phẩm `"Ảnh giới thiệu sản phẩm của next-store"`; bài `"Ảnh giới thiệu bài viết trên blog next-store"`.

Bố cục đã dựng thử bằng `ImageResponse` của next 16.4.6 (cùng satori + resvg) với hai file TTF tĩnh ở §3: chữ có dấu, `₫`, `--force`, dấu nháy đều đúng; PNG thật ở artifact M3.

## 3. Tài nguyên

| File trong repo | Nguồn |
|---|---|
| `public/images/{ao-thun,coc,sticker,sach}.svg` | Designer v2 (chỉ Ink/Paper + một khối cyan, nền xen kẽ sáng/tối) |
| `src/app/fonts/lexend-full-wght.woff2` | Brand kit `fonts/lexend-full-wght.woff2` (SIL OFL) |
| `src/app/fonts/lexend-regular.ttf`, `src/app/fonts/lexend-bold.ttf` | Cắt từ `lexend-full-wght.woff2` (SIL OFL) thành TTF **tĩnh** `wght=400` / `wght=700` cho ảnh Open Graph (~78 KB mỗi file; `ImageResponse` không đọc woff2 hay TTF variable — K7) |
| `public/brand/gin-pham-horizontal-dark.svg` | Brand kit `master/gin-pham-horizontal-dark.svg` (lockup trên nền tối) |

Tái tạo font tĩnh (fontTools ≥ 4.40 + brotli):

    python3 -c "from fontTools.ttLib import TTFont; f=TTFont('src/app/fonts/lexend-full-wght.woff2'); f.flavor=None; f.save('/tmp/lexend-var.ttf')"
    fonttools varLib.instancer /tmp/lexend-var.ttf wght=400 -o src/app/fonts/lexend-regular.ttf
    fonttools varLib.instancer /tmp/lexend-var.ttf wght=700 -o src/app/fonts/lexend-bold.ttf

Kết quả: 4 byte đầu `00010000`, không có bảng `fvar`, có đủ chữ tiếng Việt và `₫` (U+20AB).
