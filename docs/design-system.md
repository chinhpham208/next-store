# Design system: next-store (v2, theo brand Gin Pham)

Nguồn: Designer, ticket NS-24 — **chủ dự án duyệt 2026-11-19**. Bản gốc trên Claude Design:
- Design system: https://claude.ai/artifact/GmucdqjNPKDzHFY4FWZCUj
- Màn hình trang chủ (390 / 1280 px, sáng / tối / trống): https://claude.ai/artifact/Tjc6tnwX3q96CPSxDk2c2r
- Màn hình M2 (danh sách, chi tiết, 404, lỗi; 390 / 1280 px, sáng / tối) và đặc tả component M2: https://claude.ai/artifact/MzW3An6ebYKxUjEMT7tuEU — **chủ dự án duyệt 2026-11-20** (Cổng 2, NS-46)
- Màn hình M3 (blog, bài viết, "Bài viết mới" trên trang chủ, header có "Blog"; 390 / 1280 px, sáng / tối), ảnh Open Graph và nội dung 4 bài: https://claude.ai/artifact/N5Gkua8mA1whwo5PxeHfcX — **chủ dự án duyệt 2026-11-22** (Cổng 2, Task 6 M3)
- Màn hình M4 (biểu tượng giỏ trên header, nút "Thêm vào giỏ", trang `/cart`; 390 / 1280 px, sáng / tối) và đặc tả component M4: https://claude.ai/artifact/XUBrrWUoY6vpLG1mSaVXMk — **chủ dự án duyệt 2026-11-23** (Cổng 2, Task 2 M4)

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
- **Trang `/cart`** (Task 9): chép vào đây cùng PR của Task 9.

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
