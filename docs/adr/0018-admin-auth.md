# ADR-0018: Xác thực admin: mật khẩu trong env, phiên cookie ký HMAC, giới hạn đăng nhập sai trong app

- Trạng thái: Đã chấp nhận (chủ dự án duyệt 2026-11-25, PR #99)
- Ngày: 2026-11-25
- Quyết định của chủ dự án: 2026-11-25 (plan M5, Cổng 1, quyết định 5, 6, 7, 8, 15, 16, phương án A)
- Bổ sung: [ADR-0015](./0015-edge-rate-limit.md) (quy tắc WAF cho Server Action cũng đếm `loginAction`; giới hạn đăng nhập sai nằm trong app vì Hobby chỉ có một quy tắc rate limit)
- Liên quan: [ADR-0009](./0009-product-404-in-proxy.md) và [ADR-0017](./0017-product-slug-registry-in-proxy.md) (proxy không chạm DB), [ADR-0010](./0010-app-role-and-preview-data.md) (role app chỉ DML), [ADR-0011](./0011-db-query-wrapper.md) (`dbQuery`, không log dữ liệu), [ADR-0014](./0014-cart-storage-and-cookie.md) (cookie giỏ, CSRF của Server Action), [ADR-0016](./0016-security-headers-and-action-body-limit.md) (body action tối đa 16 KB), [ADR-0020](./0020-content-security-policy-and-hsts.md) (CSP nonce cho `/admin`), `docs/plans/M5.md` Task 6, 7, 8, 13, 14, ticket NS-95

## Bối cảnh

US-12: admin đăng nhập bằng mật khẩu vào `/admin`; chưa đăng nhập mở `/admin/products` thì bị chuyển tới `/admin/login`; sai mật khẩu thấy lỗi; cookie phiên bị sửa tay thì bị đá ra. `requirements.md` §5: khu admin được bảo vệ, mọi input validate, trang admin `noindex`. `design.md` §5 và `.env.example` đã có `ADMIN_PASSWORD`, `SESSION_SECRET` ("tối thiểu 32 ký tự"). Chỉ có một admin.

Điều đã đọc (plan M5, D1, D2, D5, D10):

- Proxy chạy Node.js runtime (`proxy.md`, "Runtime"). Proxy chỉ nên kiểm phiên **lạc quan**: đọc cookie, không truy vấn DB, vì nó chạy cả cho prefetch. Nó không được là lớp bảo vệ duy nhất: "Always verify authentication and authorization inside each Server Function rather than relying on Proxy alone" (`proxy.md`; `02-guides/authentication.md`, "Optimistic checks with Proxy", "Creating a Data Access Layer").
- `redirect()` gọi sau khi vỏ đã stream thì chèn thẻ meta, không đổi status (`04-functions/redirect.md`). Status 307 thật của US-12 vì vậy phải đến từ proxy.
- Vercel ghi đè `X-Forwarded-For` bằng IP công khai của client và "do not forward external IPs… to prevent IP spoofing"; `x-real-ip` giống hệt ([Vercel — Request headers](https://vercel.com/docs/headers/request-headers), đọc 2026-11-25).
- Proxy chạy ở edge gần người truy cập (ADR-0009, NS-79): kiểm phiên bằng DB từ proxy sẽ lặp lại đúng lỗi của NS-79.
- Vercel WAF trên Hobby chỉ có **một** quy tắc rate limit mỗi project, và quy tắc đó đã dành cho mọi Server Action (`POST` + `next-action`, 60 / 60 s / IP, ADR-0015).

## Các phương án

**Mật khẩu (quyết định 5)**

| Phương án | Ưu | Nhược |
|---|---|---|
| **A. `ADMIN_PASSWORD` trong env** (≥ 20 ký tự ngẫu nhiên, khác nhau theo môi trường), so sánh SHA-256 + `timingSafeEqual` | Đúng `design.md` §5 và `.env.example`; không thư viện, không bảng; chủ dự án chỉ dán một giá trị | Ai đọc được env Production thì biết mật khẩu, nhưng người đó cũng có `SESSION_SECRET` nên băm mật khẩu không thêm bảo vệ |
| B. Hash scrypt trong env (`ADMIN_PASSWORD_HASH`) + script tạo hash | Lộ env không lộ mật khẩu | Thêm script, thêm bước cho chủ dự án; không bảo vệ gì khi `SESSION_SECRET` lộ cùng lúc |
| C. Bảng `users` + bcrypt / argon2 | Nhiều admin, đổi mật khẩu trong app | Thêm thư viện, migration, giao diện; ngoài phạm vi (một admin) |

**Phiên (quyết định 6)**

| Phương án | Ưu | Nhược |
|---|---|---|
| **A. Cookie ký HMAC-SHA256** (`__Host-ns_admin`, `HttpOnly`, `Secure`, `SameSite=Strict`, `Path=/`), hạn tuyệt đối 8 giờ, không trượt; đăng xuất xoá cookie; thu hồi mọi phiên = đổi `SESSION_SECRET` + redeploy | Proxy kiểm được không chạm DB (D2, bài học NS-79); không bảng; đúng `design.md` §5 | Không thu hồi được từng phiên; cookie bị đánh cắp dùng được tới hết hạn (giảm bằng `HttpOnly`, `Strict`, 8 giờ) |
| B. Phiên trong DB (`admin_sessions`) | Thu hồi từng phiên, đăng xuất thật | Proxy phải tra DB từ edge, lặp lại NS-79; thêm bảng |
| C. Như A + biến `ADMIN_SESSION_EPOCH` nằm trong chữ ký | Thu hồi mọi phiên mà không đổi secret | Thêm một biến; lợi ích nhỏ với một admin |

**CSRF (quyết định 7)**

| Phương án | Ưu | Nhược |
|---|---|---|
| **A. `SameSite=Strict` + kiểm `Origin` sẵn có của Next.js + mọi action admin tự kiểm phiên** | Không thêm gì; POST khác site không mang cookie admin; `Origin` lạ bị Next từ chối | Request không có `Origin` được Next cho qua (plan M4 D4), vô hại vì không mang cookie `Strict` |
| B. A + token double-submit trong form | Thêm một lớp | Thêm code và test cho rủi ro đã đóng |

**Giới hạn đăng nhập sai (quyết định 8)**

| Phương án | Ưu | Nhược |
|---|---|---|
| **A. Trong app, bảng `admin_login_failures`:** IP băm HMAC; 5 lần sai / 15 phút mỗi IP, 50 lần / 15 phút toàn cục thì khoá; kiểm khoá trước khi so mật khẩu; xoá dòng quá 1 ngày; quy tắc WAF chung vẫn đếm (60 POST / phút / IP) | Chặn đoán mật khẩu cả khi đổi IP chậm; không đụng quy tắc WAF của giỏ; IP không lưu thô | Một migration; khoá toàn cục có thể bị dùng để chặn admin 15 phút |
| B. Chỉ WAF chung + mật khẩu dài | Không code | 60 lần thử / phút / IP / region; không có trần toàn cục |
| C. Đổi quy tắc WAF duy nhất sang `/admin/login` với ngưỡng chặt | Chặn ở biên | Giỏ hàng mất giới hạn tốc độ (ADR-0015) |

**Admin trên Preview / Dev (quyết định 15)**

| Phương án | Ưu | Nhược |
|---|---|---|
| **A. Bật với mật khẩu và secret riêng của Preview** (khác Production), GitHub secret `E2E_ADMIN_PASSWORD` cho E2E | QA chạy được US-12, US-13 trên preview / Dev như mọi story | Thêm hai biến Preview và một GitHub secret |
| B. Chỉ Production; E2E admin chỉ chạy local / CI | Ít secret | Không kiểm được admin trên Vercel trước release (đúng loại lỗi của NS-109, NS-110) |

**E2E admin trên Production (quyết định 16)**

| Phương án | Ưu | Nhược |
|---|---|---|
| **A. Chỉ test chỉ đọc** (chuyển hướng khi chưa đăng nhập, cookie giả, `noindex`); chủ dự án nghiệm thu sửa thật một lần | Mật khẩu Production không bao giờ nằm ở GitHub | Không có test tự động đăng nhập Production |
| B. Đăng nhập trên Production bằng secret | Kiểm đủ | Mật khẩu Production trong GitHub Actions; test ghi trên dữ liệu thật |

## Quyết định

Câu trả lời của chủ dự án ở Cổng 1 (plan M5, mục "Cần chủ dự án quyết"), chép nguyên văn:

> **Đã quyết (2026-11-25):** chủ dự án duyệt tất cả đề xuất: 1A, 2A, 3A, 4A, 5A, 6A, 7A, 8A, 9A, 10A, 11A, 12A, 13A, 14A, 15A, 16A, 17A.

Quyết định 5A, 6A, 7A, 8A, 15A, 16A áp như sau. Code nằm trong miền mới `src/features/admin`.

**Cấu hình, fail-closed**

- `readAdminConfig` (`config.ts`, `server-only`) trả `enabled: false` khi thiếu `ADMIN_PASSWORD` hoặc `SESSION_SECRET` (`missing`), khi mật khẩu dưới 20 ký tự, secret dưới 32 ký tự, hoặc hai giá trị bằng nhau (`weak`). Khi đó khu admin **đóng**: đăng nhập trả "Khu quản trị chưa được cấu hình.", proxy và layout coi mọi cookie là không hợp lệ. Không bao giờ "mở khi thiếu cấu hình", không bao giờ ký bằng chuỗi rỗng. Không log giá trị.
- Mỗi môi trường có giá trị riêng: `ADMIN_PASSWORD` và `SESSION_SECRET` của Production khác của Preview (Dev dùng môi trường Preview, ADR-0007). Tạo bằng `openssl rand -base64 24` (mật khẩu) và `openssl rand -base64 32` (secret), bật Sensitive trên Vercel. `E2E_ADMIN_PASSWORD` trên GitHub là mật khẩu **Preview**, chỉ truyền cho workflow E2E của preview / Dev, không bao giờ cho `production-e2e.yml` (16A).

**Mật khẩu (5A)**

- `passwordMatches(input, expected)` (`password.ts`, `server-only`): `input` không phải chuỗi hoặc dài hơn 256 ký tự → `false` ngay, không băm. Còn lại so `sha256(input)` với `sha256(expected)` bằng `timingSafeEqual` của `node:crypto` (hai buffer cùng 32 byte, nên độ dài mật khẩu không lộ qua thời gian so).
- Loại B: không thêm bảo vệ khi env lộ, vì `SESSION_SECRET` lộ cùng lúc đủ để ký phiên. Loại C: thư viện, bảng và giao diện cho một admin.

**Phiên (6A)**

- Token `v1.<exp>.<sig>`: `exp` là giây Unix 10 chữ số, `sig` là base64url (43 ký tự) của HMAC-SHA256 trên `v1.<exp>` bằng `SESSION_SECRET`, qua Web Crypto (`crypto.subtle`), để proxy dùng được. Cookie không chứa gì khác. `session.ts` là nơi duy nhất ký / xác minh.
- `verifySession` nhận token khi: khớp `^v1\.\d{10}\.[A-Za-z0-9_-]{43}$`, `exp > now`, `exp ≤ now + 8 giờ`, rồi `crypto.subtle.verify` (so hằng thời gian do Web Crypto, không so chuỗi bằng `===`). Mọi lỗi → `false`. Ký hoặc xác minh với secret dưới 32 ký tự → ném lỗi cố định.
- Cookie: `__Host-ns_admin` khi site chạy HTTPS (`ns_admin` khi không, như cookie giỏ), `HttpOnly`, `Secure` theo HTTPS, `SameSite=Strict`, `Path=/`, `Max-Age=28800`, không `Domain`. Hạn **tuyệt đối 8 giờ, không trượt**. `cookie.ts` là nơi duy nhất đọc / ghi cookie trong app; proxy đọc qua `@/features/admin/proxy-api`.
- Đăng xuất (`logoutAction`) xoá cookie rồi chuyển tới `/admin/login`; không cần phiên hợp lệ để đăng xuất. Token cũ vẫn hợp lệ về mặt chữ ký tới hết hạn nếu đã bị chép.
- **Thu hồi mọi phiên:** đổi `SESSION_SECRET` của môi trường đó trên Vercel rồi redeploy. Không có thu hồi từng phiên.
- Loại B: proxy phải tra DB từ edge (NS-79). Loại C: thêm một biến cho lợi ích nhỏ với một admin.

**Kiểm phiên ở ba lớp (D2)**

- **Proxy** (lạc quan, không DB): nhánh `/admin` chạy **đầu tiên**, trước lối tắt Server Action và trước kiểm slug. `/admin/login` (kèm dạng `.rsc` / segment) đi tiếp. Có phiên hợp lệ → đi tiếp. Không có: `GET` / `HEAD` → 307 sang `/admin/login` và xoá cookie admin nếu request có mang (cả hai tên); method khác (kể cả `POST` + `next-action`) → 401 rỗng. Không tham số `next` / `returnTo` (không open redirect). Không log.
- **Layout** `src/app/admin/(protected)/layout.tsx`: `requireAdminPage()` trong `<Suspense>` gọi `redirect('/admin/login')` khi không có phiên. Trong streaming đây là thẻ meta (D5), nên đây là lớp thứ hai, không phải nguồn của status 307.
- **Mỗi Server Action admin** (`updateProductAction`, ADR-0019) gọi `hasAdminSession()` **trước** khi parse input hay chạm DB; không có phiên → state `unauthorized`. `loginAction` là ngoại lệ duy nhất.

**CSRF (7A)**

- Không thêm token. `SameSite=Strict` làm POST từ site khác không mang cookie admin; Next.js 16.4.6 từ chối Server Action có `Origin` khác host; mọi action admin tự kiểm phiên. Request không có `Origin` được Next cho qua nhưng không mang cookie `Strict`. Body action vẫn tối đa 16 KB (ADR-0016).

**Giới hạn đăng nhập sai (8A)**

- Bảng `admin_login_failures` (`id uuid` do server sinh bằng `crypto.randomUUID()`, `ip_hash text`, `failed_at timestamptz`; index `(ip_hash, failed_at)` và `(failed_at)`; không sequence). Migration expand ở plan M5 Task 5.
- IP là phần tử đầu của `x-forwarded-for` (Vercel ghi đè header này, D10), cắt khoảng trắng, tối đa 45 ký tự; không có → `'unknown'`. Lưu HMAC-SHA256 hex của IP bằng `SESSION_SECRET`, không bao giờ IP thô, không log IP hay IP băm.
- `loginAction`, theo đúng thứ tự: cấu hình tắt → `not-configured` (không chạm DB); mật khẩu không phải chuỗi 1..256 ký tự → `invalid`; băm IP; `isLoginLocked` (một truy vấn, hai `count` trong cửa sổ 15 phút: theo IP ≥ 5 hoặc toàn cục ≥ 50) → khoá thì `locked`; **lỗi DB khi kiểm khoá → `unavailable`, không so mật khẩu** (fail-closed); mật khẩu sai → `recordLoginFailure` (lỗi bị nuốt, log một dòng cố định) → `wrong-password`; đúng → ghi cookie phiên → `redirect('/admin/products')`. Lần đúng không ghi gì. Kiểm khoá **trước** khi so mật khẩu, nên khi đã khoá không đoán thêm được.
- `recordLoginFailure` trong một transaction: `INSERT` một hàng, rồi xoá tối đa 100 hàng quá 24 giờ (cũ nhất trước), để bảng không phình.
- Hằng: `LOGIN_WINDOW_MINUTES = 15`, `MAX_FAILURES_PER_IP = 5`, `MAX_FAILURES_GLOBAL = 50`, `FAILURE_RETENTION_HOURS = 24`.
- Quy tắc WAF chung của ADR-0015 (`POST` + `next-action`, 60 / 60 s / IP) cũng đếm `loginAction`: đó là lớp ở biên, giới hạn trong app là lớp chính. Loại B: không có trần toàn cục, 60 lần thử / phút / IP / region. Loại C: giỏ hàng mất giới hạn tốc độ, vì Hobby chỉ có một quy tắc.

**Preview và Production (15A, 16A)**

- Admin bật trên Preview / Dev với secret riêng của Preview, để QA chạy US-12, US-13 trên preview như mọi story.
- E2E trên Production chỉ gồm test chỉ đọc: chuyển hướng khi chưa đăng nhập (status 307), cookie giả bị đá ra, `noindex`. Chủ dự án nghiệm thu sửa thật một lần trên Production sau `v0.5.1`.

**Không dùng:** thư viện auth (NextAuth, iron-session, jose), bcrypt / argon2, `localStorage` cho phiên, Route Handler cho đăng nhập, `middleware.ts`.

## Hệ quả

- **Không thu hồi được từng phiên.** Cookie bị đánh cắp dùng được tới 8 giờ. Giảm bằng `HttpOnly` (script không đọc được), `SameSite=Strict`, `Secure`, CSP nonce cho `/admin` (ADR-0020). Nghi lộ: đổi `SESSION_SECRET` + redeploy (mọi phiên của môi trường đó mất).
- **Đổi `SESSION_SECRET` cũng làm mới bộ đếm đăng nhập sai,** vì IP băm bằng secret đó: hàng cũ không còn khớp IP nào và tự bị xoá sau 24 giờ. Chấp nhận: đổi secret là thao tác hiếm của chủ dự án.
- **Khoá toàn cục có thể bị dùng để chặn admin.** Ai gửi 50 mật khẩu sai trong 15 phút (từ ít nhất 10 IP, vì mỗi IP bị khoá sau 5) thì admin không đăng nhập được tới khi cửa sổ trôi. **Rủi ro chấp nhận:** một admin, chờ tối đa 15 phút, phiên đang mở không bị ảnh hưởng; ngưỡng là một hằng (`MAX_FAILURES_GLOBAL`).
- **Trần đoán mật khẩu:** dưới giới hạn trong app, một IP thử được khoảng 5 / 15 phút ≈ 480 lần / ngày; toàn cục khoảng 50 / 15 phút ≈ 4.800 lần / ngày. Với mật khẩu 24 byte ngẫu nhiên (base64, 32 ký tự) thì không đoán được trong thực tế.
- **Đếm theo IP sau NAT:** người dùng chung IP với kẻ đoán bị khoá cùng. Chỉ có một admin nên chấp nhận.
- **Dưới `next start` (local, CI) không có `x-forwarded-for` do Vercel đặt:** IP là `'unknown'` hoặc giá trị client tự gửi. Giới hạn theo IP chỉ có nghĩa trên Vercel; giới hạn toàn cục vẫn đúng ở mọi nơi. Kiểm tại chỗ C6 ở Task 7 Step 1 (trên Vercel header là một IP).
- **Thêm một miền `admin` và một cây route `src/app/admin/`** ngoài `(shop)`: không header giỏ, không `CartProvider`, `robots: noindex`. Dữ liệu admin không bao giờ nằm trong `'use cache'`; trang admin đọc DB sau `cookies()` trong `<Suspense>`.
- **Không có test tự động đăng nhập Production.** Bù bằng test chỉ đọc trên Production và nghiệm thu tay một lần (việc của chủ dự án 6, plan M5).
- **Mật khẩu Preview có thể lộ qua report / trace E2E** (bước `fill` của Playwright ghi nguyên giá trị). Chỉ mở được admin Preview, không mở Production vì secret khác nhau. `redact-report` mở rộng cho nhiều secret ở plan M5 Task 14.
- **Không có audit log, nhiều admin, 2FA, quên mật khẩu, đổi mật khẩu trong app.** Đổi mật khẩu = đổi `ADMIN_PASSWORD` + redeploy. Muốn nhiều admin thì cần ADR mới (hướng 5C).
- **Cách kiểm:**
  - Vitest `config.test.ts`, `password.test.ts`, `session.test.ts` (`rejects a token signed with another secret`, `rejects an expired token`, `rejects an expiry further than the TTL`, `refuses to sign or verify without a 32-character secret`, `verifies with crypto.subtle.verify`), `cookie.test.ts` (Task 6).
  - Vitest `login-limit.test.ts`, `actions.test.ts` (`checks the lock before comparing the password`, `refuses to log in when the lock check fails`, `stores only an HMAC of the IP`, `a successful login records nothing`, `never logs the password, the cookie or the IP`) (Task 7).
  - Vitest `proxy.test.ts` (`checks the admin session before the Server Action shortcut`, `answers 401 to a Server Action on an admin page without a session`, `does not touch the database for /admin`, `closes /admin when SESSION_SECRET is missing`); smoke `/admin/products` không cookie → 307, cookie rác → 307 và `Set-Cookie` xoá (Task 8).
  - E2E US-12 (Task 14), audit toàn mốc (Task 13 Step 1–4, gồm đọc lại quy tắc WAF thật sau NS-95).
  - Kiểm tại chỗ C3 (`crypto.subtle` HMAC trong proxy trên Vercel và `next start`, Task 6 Step 1), C6 (Task 7 Step 1), C8 (Task 8 Step 1).
