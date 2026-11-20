# ADR-0009: 404 thật cho sản phẩm không tồn tại bằng proxy

- Trạng thái: Đã chấp nhận
- Ngày: 2026-11-21
- Quyết định của chủ dự án: 2026-11-20 (plan M2, quyết định 1, phương án A)
- Liên quan: [ADR-0003](./0003-cache-strategy.md), ticket NS-49 (M2 Task 12), audit PR #20

## Bối cảnh

US-05 yêu cầu `/products/<slug không tồn tại>` trả **HTTP 404** với trang "Không tìm thấy trang" tiếng Việt. Với Cache Components (`cacheComponents: true`, ADR-0003):

- `notFound()` gọi trong trang cho slug chưa prerender chạy **sau khi** vỏ 200 đã gửi: lần đầu trả 200, giao diện not-found chỉ dựng phía client; từ lần hai mới trả 404 vì kết quả đã được lưu (plan M2, K3). Test chạy hai lần sẽ không thấy lỗi này.
- `export const dynamicParams = false` không dùng được cùng `cacheComponents` (build lỗi, K4).
- `NextResponse.rewrite(<route thật>, { status: 404 })` không đổi status (vẫn 200); rewrite sang một đường dẫn **không khớp route nào** thì Next.js trả 404 kèm `app/not-found.tsx`, cả với request RSC (K5).
- Hàm `'use cache'` không gọi được từ proxy (K6); truy vấn Drizzle không cache thì được.

## Các phương án

| Phương án | Ưu | Nhược |
|---|---|---|
| **A. `src/proxy.ts` kiểm slug trước khi render** | 404 thật ngay lần đầu, cho cả HTML và RSC | Mọi request `/products/<slug>` đi qua proxy; slug lạ tốn một truy vấn mỗi lần; `proxy.ts` có từ M2 thay vì M5 |
| B. `notFound()` trong trang, chấp nhận 200 + `noindex` lần đầu | Không thêm thành phần | 404 "mềm", phải sửa tiêu chí US-05 |
| C. Danh sách slug sinh lúc build, proxy đối chiếu tĩnh | Không chạm DB lúc chạy | Sản phẩm admin tạo ở M5 bị 404 tới lần build sau |

## Quyết định

Phương án A.

- `src/proxy.ts`, `config = { matcher: '/products/:slug' }` (hằng, để Next.js phân tích tĩnh). Next.js tự thêm các dạng vận chuyển (`.rsc`, `.segments/…`) vào matcher và chuẩn hoá đường dẫn trước khi gọi proxy, nên `/products/<slug>.rsc` của slug có thật vẫn tới trang. `/`, `/products`, `/_next/*`, ảnh tĩnh không đi qua proxy (`src/proxy.test.ts`, `unstable_doesMiddlewareMatch`).
- Slug là đoạn cuối của `nextUrl.pathname`, **không giải mã**. Không qua `isProductSlug` (chữ thường, số, `-`, tối đa 80 ký tự; kể cả `%2D`, chữ hoa, `.`) → 404 ngay, **không chạm DB**, nên vẫn đúng khi DB chết.
- Slug đúng dạng → `isKnownProductSlug` (`src/features/products/slug-guard.ts`, không cache): `true` → `NextResponse.next()`; `false` → rewrite sang `/_khong-tim-thay` (thư mục bắt đầu bằng `_` là private folder, không bao giờ thành route) → 404.
- Slug đã thấy tồn tại được nhớ trong một `Set` cấp module (chỉ kết quả dương). Các lần tra cùng slug đang chờ DB dùng chung một promise (`Map<string, Promise<boolean>>`, xoá khi xong), nên một đợt request cùng slug chỉ tốn một truy vấn.
- **Fail-open.** Lookup ném lỗi, hoặc chưa xong sau **400 ms** (client DB đợi kết nối tới 10 giây) → `console.error` **một dòng cố định** rồi `NextResponse.next()`. Không bao giờ in object lỗi, `cause`, slug hay URL: lỗi Drizzle chứa câu SQL, `cause` của driver chứa host. Trang đã prerender vẫn phục vụ được; slug chưa prerender tự hiện trang lỗi (K8).

## Hệ quả

- Mỗi request `/products/<slug>` chạy proxy. Slug có thật tốn một truy vấn theo khoá unique cho mỗi instance (rồi nhớ); slug lạ đúng dạng tốn **một truy vấn mỗi request**.
- **Fail-open để lọt slug lạ vào route cache.** Khi lookup lỗi hoặc quá 400 ms, slug lạ đi tiếp tới trang: lần đó trả 200 (vỏ + trang lỗi hoặc not-found phía client, K3) và Next.js có thể lưu một entry route cache cho slug đó. Trong lúc DB chậm hoặc chết, người ngoài gửi slug ngẫu nhiên là tạo được entry mới. Chấp nhận vì phương án ngược lại (fail-closed: 404 hoặc 503 cho mọi slug) làm sập cả trang sản phẩm đã prerender khi DB có sự cố.
- **Kết nối lạnh làm mất 404 ở những request đầu (đã đo trên preview).** Preview đầu tiên của NS-49 (Vercel + Neon branch): slug sai dạng (`%2D`, chữ hoa) 404 ngay — proxy có chạy; hai slug lạ đúng dạng đầu tiên trả **200** (lookup fail-open), các slug lạ mới sau đó 404 ngay lần đầu. Nghĩa là lần kết nối đầu tới Neon (compute thức dậy, instance function mới) lâu hơn 400 ms hoặc lỗi; không có log Vercel trong phiên nên chưa phân biệt được hai trường hợp (log function sẽ có một trong hai dòng `proxy: product slug lookup failed…` / `…timed out…`). Trên Production, Neon tạm dừng compute khi rảnh nên điều này lặp lại sau mỗi lần rảnh. `scripts/smoke.sh` vì vậy chờ lookup sẵn sàng (thử slug lạ mới tới khi gặp 404, tối đa `SMOKE_WARMUP_TRIES`, in số lần fail-open) rồi mới đòi 404 ngay lần đầu. Nếu cần 404 tuyệt đối cả lúc lạnh: nâng ngưỡng (vẫn dưới `connect_timeout` 10 giây) đổi lấy request treo lâu hơn khi DB chết — quyết định của chủ dự án, ADR mới.
- **Region của function phải cạnh Neon.** Nguyên nhân của bảng đo trên: project Vercel chạy function (và proxy) ở `iad1` (Washington; `serverlessFunctionRegion: iad1`, deployment `regions: ["iad1"]`) trong khi Neon ở `aws-ap-southeast-1` (Singapore); mỗi kết nối lạnh là vài vòng đi về qua Thái Bình Dương nên ngưỡng 400 ms không giữ được. Sửa: `vercel.json` đặt `"regions": ["sin1"]` (Hobby cho một region). Next.js 16.4.6 không đặt region cho proxy trừ khi `config.regions` có trong `proxy.ts` (`build/adapter/build-complete.js` chuyển nó thành `preferredRegion`), nên proxy theo region mặc định của project; `config` cố ý chỉ có `matcher`, một nguồn sự thật là `vercel.json`. Không đọc được docs Vercel trong phiên (vercel.com bị chặn), nên region được kiểm trên deployment: smoke in phần region của `x-vercel-id` cho request đi qua proxy. Đổi region của Neon hoặc chuyển project sang gói khác → kiểm lại dòng này. Ngưỡng 400 ms giữ nguyên.
- **Cần giới hạn tần suất ở biên (chưa làm ở M2).** Vì slug lạ tốn một truy vấn mỗi request, ai cũng tạo được tải DB bằng cách đổi slug. Đặt rate limit ở tầng biên trước khi tới function, ví dụ quy tắc Vercel Firewall cho `/products/*`; cùng chỗ với giới hạn tìm kiếm `q` của ADR-0008. Thêm thư viện hoặc kho đếm → ADR riêng.
- **Tập slug đã biết bị cũ sau khi xoá.** Sản phẩm bị xoá sau khi đã được thấy vẫn "đã biết" trong instance đó cho tới khi instance khởi động lại: proxy cho đi tiếp, trang gọi `notFound()` và trả 404 "mềm" (200 lần đầu). M5 (admin xoá / đổi slug sản phẩm) thêm `forgetProductSlug(slug)` vào `slug-guard.ts` và gọi nó trong Server Action cùng lúc với `updateTag`. Trên Vercel mỗi instance có `Set` riêng, nên `forgetProductSlug` chỉ xoá được ở instance chạy action; instance khác vẫn cũ tới khi được thay — M5 phải quyết định có chấp nhận điều này hay bỏ cache dương.
- **Kết nối DB riêng của proxy trên Vercel (chưa kiểm).** Trên `next start`, proxy và trang chạy cùng tiến trình nên dùng chung kết nối qua `globalThis` (K6). Trên Vercel, proxy có thể được đóng gói và chạy thành function riêng, tức là một pool kết nối riêng tới Neon (thêm kết nối, thêm độ trễ kết nối lạnh có thể chạm ngưỡng 400 ms). Chưa đo được; kiểm bằng log function và số kết nối trên Neon khi có tải thật. Nếu cần: dùng pooler của Neon cho proxy hoặc giảm `max` của pool.
- `proxy.ts` xuất hiện từ M2; M5 thêm nhánh `/admin` vào cùng file và mở rộng `matcher`. File giữ mỏng, logic nằm trong `src/features`.
- Kiểm chứng: Vitest `src/proxy.test.ts` (slug có thật / lạ / sai dạng khi DB chết / lỗi / không bao giờ xong / matcher); `scripts/smoke.sh` kiểm `/products/khong-ton-tai`, slug mới mỗi lần chạy, request `rsc: 1`, hậu tố `.rsc`, `%2D`, chữ hoa đều 404 ngay lần đầu, và request RSC của slug có thật vẫn 200 — trên CI và trên mỗi preview / Dev (`e2e-preview`).
