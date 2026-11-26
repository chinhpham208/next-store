#!/usr/bin/env bash
# Kiểm hành vi an toàn của scripts/smoke.sh (NS-35, audit PR #6 mục L1). Không cần bản build, không ra mạng.
#
#   bash scripts/smoke.test.sh
#
# Một server HTTP dùng một lần (node) trên 127.0.0.1 ghi lại header nhận được; một `curl` giả đứng trước PATH
# ghi lại tham số của mọi lần gọi rồi chuyển cho curl thật, để biết smoke.sh có gửi request nào hay không.
set -euo pipefail
cd "$(dirname "$0")/.."

SECRET=abcdefghijklmnop0123456789ABCDEF
PORT=3199
BUSY_PORT=3198
DENY_PORT=3197
EN_404_PORT=3196
SOFT_404_PORT=3195
SOFT_RSC_PORT=3194
FIRST_PRODUCT_PORT=3193
SEG_PORT=3191
NOINDEX_PORT=3190
SITEMAP_PORT=3189
OG_PORT=3188
SOFT_BLOG_PORT=3187
SOFT_OG_PORT=3186
POST_SEG_PORT=3185
UNKNOWN_PRODUCT_PORT=3184
NON_ACTION_PORT=3182
NON_ACTION_5XX_PORT=3181
UNKNOWN_405_PORT=3180
UNKNOWN_307_PORT=3179
REDIRECT_PORT=3178
SECURITY_PORT=3177
ADMIN_PORT=3176
CSP_OLD_PORT=3175
HSTS_PORT=3174
HSTS_SHORT_PORT=3173
CSP_PREVIEW_PORT=3172
CSP_PREVIEW_ALLOW_PORT=3171
ADMIN_TWO_CSP_PORT=3170

TMP=$(mktemp -d)
PIDS=()
cleanup() {
  local pid
  for pid in "${PIDS[@]+"${PIDS[@]}"}"; do kill "$pid" 2>/dev/null || true; done
  rm -rf "$TMP"
}
trap cleanup EXIT

fail() { echo "FAIL $1: $2" >&2; [ -f "$TMP/out" ] && sed 's/^/  | /' "$TMP/out" >&2; exit 1; }

REAL_CURL=$(command -v curl)
mkdir -p "$TMP/bin"
cat > "$TMP/bin/curl" <<EOF
#!/usr/bin/env bash
printf '%s\n' "\$*" >> "$TMP/curl-calls"
exec "$REAL_CURL" "\$@"
EOF
chmod +x "$TMP/bin/curl"

# start_server <port> <header-file> [status] [404-body] [soft-regex] [hard-404-regex]: answers / and the smoke's
# product page (and its RSC / segment prefetch forms) with the default SMOKE_TEXT, /cart with the empty cart, /blog and the smoke's post (and its
# RSC / segment prefetch forms) with an article and its h1, the smoke's listing paths with the labelled grid (or with <status>, e.g. 401 like Vercel Deployment Protection), everything else with 404 and
# <404-body> (default: the app's Vietnamese page). URLs matching <soft-regex> answer 200 with the not-found page, like
# a page-level notFound() under Cache Components (K3) or a proxy that failed open; URLs matching <hard-404-regex>
# answer 404 with the proxy's rewrite header even when they are a known product's. /sitemap.xml and /robots.txt
# answer like the app on <sitemap-origin> (default https://shop.example.test); <robots-tag>, when set, is sent as
# X-Robots-Tag on every response; <robots-rule> (default `Allow: /`) is the rule line of robots.txt. The pages carry an
# og:image on http://localhost:3000 (as under next start); its path answers <og-status> (default 200) with a PNG.
# <non-get-status>, when set, answers every request that is not a GET with that status and the not-found page, like a
# proxy that lets every non-GET through to a page rendered like a GET (NS-92, fixed by NS-103).
# <rsc-status>, when set, answers a request with `rsc: 1` to a URL matching <soft-regex> with that status and a
# Location to <url>?_rsc, like `next start` when the proxy fails open (NS-111).
# Every response carries the site's security headers (NS-108, next.config.ts) unless <security-file> names a file whose
# first line is a regex: matching URLs then leave out the header named on its second line, or all of them. The file is
# read on each request, so one server serves every security case.
# The admin area (US-12, M5 Task 8) answers like src/proxy.ts without a session: /admin/login 200 (noindex), every other
# /admin/* (and /%61dmin/*, /admin%2F…; not /Admin/…) GET 307 to /admin/login clearing each admin cookie sent, any
# other method 401. <admin-mode> breaks one part: `open` (/admin/products 200 with the signed-in shell), `keep-cookie`
# (no clearing Set-Cookie), `action-open` (a POST with next-action 200), `encoded-open` (/%61dmin/products 200 with the
# shell), `login-guarded` (/admin/login 307 like any admin page). /admin/login carries the proxy's nonce CSP (a fresh
# nonce per request, on every <script>, ADR-0020); `csp-missing` (baseline only), `csp-script-without-nonce`,
# `csp-same-nonce` and `csp-unsafe-inline` break it. <hsts>, when set, is sent as Strict-Transport-Security.
start_server() {
  local port=$1 headers=$2 status=${3:-200} body=${4:-"<h1>Không tìm thấy trang</h1>"} soft=${5:-} hard=${6:-} robotsTag=${7:-} origin=${8:-https://shop.example.test} robotsRule=${9:-Allow: /} ogStatus=${10:-200} postStatus=${11:-} rscStatus=${12:-} securityFile=${13:-} adminMode=${14:-} hsts=${15:-} ready="$TMP/ready-$1"
  node -e '
    const [port, headers, ready, status, body, soft, hard, robotsTag, origin, robotsRule, ogStatus, postStatus, rscStatus, securityFile, adminMode, hsts] = process.argv.slice(1)
    const adminCsp = (nonce) => `default-src \x27self\x27; script-src \x27self\x27 \x27nonce-${nonce}\x27 \x27strict-dynamic\x27${adminMode === "csp-unsafe-inline" ? " \x27unsafe-inline\x27" : ""}; style-src \x27self\x27 \x27nonce-${nonce}\x27; object-src \x27none\x27; frame-ancestors \x27none\x27`
    const loginPage = (res) => {
      const nonce = adminMode === "csp-same-nonce" ? "AAAAAAAAAAAAAAAAAAAAAA==" : require("node:crypto").randomBytes(16).toString("base64")
      if (adminMode === "csp-none") res.removeHeader("content-security-policy")
      else if (adminMode === "csp-two-headers") res.setHeader("content-security-policy", [BASELINE_CSP, adminCsp(nonce)])
      else if (adminMode !== "csp-missing") res.setHeader("content-security-policy", adminCsp(nonce))
      const second = adminMode === "csp-script-without-nonce" ? "<script>self.x=1</script>" : `<script nonce="${nonce}">self.x=1</script>`
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" })
      res.end(`<meta name="robots" content="noindex, nofollow"/><h1>Đăng nhập quản trị</h1><script src="/_next/a.js" async="" nonce="${nonce}"></script>${second}`)
    }
    const SHELL = "<header>Quản trị next-store<nav><a href=\"/admin/products\">Sản phẩm</a></nav><button>Đăng xuất</button></header>"
    const admin = (req, res) => {
      if (req.url === "/admin/login" && adminMode !== "login-guarded") { loginPage(res); return true }
      if (!/^\/(?:admin|%61dmin)(?:$|[/.?]|%2F)/.test(req.url)) return false
      const action = req.method === "POST" && "next-action" in req.headers
      if ((adminMode === "open" && req.url === "/admin/products") || (adminMode === "encoded-open" && req.url === "/%61dmin/products") || (adminMode === "action-open" && action)) {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); res.end(SHELL); return true
      }
      if (req.method !== "GET" && req.method !== "HEAD") { res.writeHead(401); res.end(); return true }
      const sent = (req.headers.cookie || "").split(/; */).map((pair) => pair.split("=")[0])
      const clear = adminMode === "keep-cookie" ? [] : ["__Host-ns_admin", "ns_admin"].filter((name) => sent.includes(name))
      res.writeHead(307, { location: `http://127.0.0.1:${port}/admin/login`, "set-cookie": clear.map((name) => `${name}=; Path=/; Max-Age=0; HttpOnly; SameSite=strict`) })
      res.end()
      return true
    }
    const PREVIEW_CSP = "default-src \x27self\x27; script-src \x27self\x27 \x27unsafe-inline\x27 https://vercel.live; style-src \x27self\x27 \x27unsafe-inline\x27 https://vercel.live; img-src \x27self\x27 data: blob: https://vercel.live https://vercel.com; font-src \x27self\x27 https://vercel.live https://assets.vercel.com; connect-src \x27self\x27 https://vercel.live wss://ws-us3.pusher.com; frame-src https://vercel.live; object-src \x27none\x27; base-uri \x27self\x27; form-action \x27self\x27; frame-ancestors \x27none\x27; upgrade-insecure-requests"
    const BASELINE_CSP = adminMode === "csp-preview" ? PREVIEW_CSP : adminMode === "csp-old" ? "frame-ancestors \x27none\x27" : "default-src \x27self\x27; script-src \x27self\x27 \x27unsafe-inline\x27; style-src \x27self\x27 \x27unsafe-inline\x27; img-src \x27self\x27 data: blob:; font-src \x27self\x27; connect-src \x27self\x27; object-src \x27none\x27; base-uri \x27self\x27; form-action \x27self\x27; frame-ancestors \x27none\x27; upgrade-insecure-requests"
    const SECURITY = { "x-frame-options": "DENY", "content-security-policy": BASELINE_CSP, "x-content-type-options": "nosniff", "referrer-policy": "strict-origin-when-cross-origin" }
    const og = (path) => `<meta property="og:image" content="http://localhost:3000${path}"/>`
    const images = ["/opengraph-image?a1b2c3", "/products/ao-404-not-found/opengraph-image-16g1u1?d4e5f6", "/blog/chao-mung-den-next-store/opengraph-image-16g1u1?a7b8c9"]
    const fs = require("node:fs")
    require("node:http").createServer((req, res) => {
      fs.appendFileSync(headers, JSON.stringify(req.headers) + "\n")
      const [omitUrl, omitName] = securityFile && fs.existsSync(securityFile) ? fs.readFileSync(securityFile, "utf8").split("\n") : []
      for (const [name, value] of Object.entries(SECURITY)) {
        if (!(omitUrl && new RegExp(omitUrl).test(req.url) && (!omitName || omitName === name))) res.setHeader(name, value)
      }
      if (robotsTag) res.setHeader("x-robots-tag", robotsTag)
      if (hsts) res.setHeader("strict-transport-security", hsts)
      if (admin(req, res)) return
      if (rscStatus && req.headers.rsc === "1" && soft && new RegExp(soft).test(req.url)) { res.writeHead(Number(rscStatus), { location: `${req.url}?_rsc` }); res.end(); return }
      if (postStatus && req.method !== "GET" && (!soft || new RegExp(soft).test(req.url))) { res.writeHead(Number(postStatus), { "content-type": "text/html; charset=utf-8" }); res.end(body); return }
      const locs = ["/", "/products/ao-404-not-found", "/blog/chao-mung-den-next-store"]
      if (req.url === "/sitemap.xml") { res.writeHead(200, { "content-type": "application/xml" }); res.end(`<urlset>${locs.map((p) => `<url>\n<loc>${p === "/" ? "https://shop.example.test" : origin}${p}</loc>\n</url>`).join("\n")}</urlset>`); return }
      if (req.url === "/robots.txt") { res.writeHead(200, { "content-type": "text/plain" }); res.end(`User-Agent: *\n${robotsRule}\n\nSitemap: https://shop.example.test/sitemap.xml\n`); return }
      if (images.includes(req.url)) { res.writeHead(Number(ogStatus), { "content-type": Number(ogStatus) === 200 ? "image/png" : "text/html" }); res.end("png"); return }
      if (hard && new RegExp(hard).test(req.url)) { res.writeHead(404, { "content-type": "text/html; charset=utf-8", "x-middleware-rewrite": "/_khong-tim-thay" }); res.end(body) }
      else if (req.url === "/" || ["/products/ao-404-not-found", "/products/ao-404-not-found?_rsc", "/products/ao-404-not-found.rsc", "/products/ao-404-not-found.segments/_tree.segment.rsc"].includes(req.url)) { res.writeHead(Number(status), { "content-type": "text/html; charset=utf-8" }); res.end(`<meta property="og:site_name" content="next-store"/>${og(req.url === "/" ? images[0] : images[1])}<h1>Áo thun 404 Not Found</h1><button type="submit" class="x disabled:x">Thêm vào giỏ</button>`) }
      else if (req.url === "/cart") { res.writeHead(Number(status), { "content-type": "text/html; charset=utf-8" }); res.end("<meta name=\"robots\" content=\"noindex\"/><h1>Giỏ hàng</h1><p>Giỏ hàng trống.</p>") }
      else if (req.url === "/products/ao-tabs-vs-spaces") { res.writeHead(Number(status), { "content-type": "text/html; charset=utf-8" }); res.end("<h1>Áo thun Tabs vs Spaces</h1><button type=\"button\" class=\"x\" disabled=\"\">Thêm vào giỏ</button>") }
      else if (["/blog", "/blog/chao-mung-den-next-store", "/blog/chao-mung-den-next-store?_rsc", "/blog/chao-mung-den-next-store.rsc", "/blog/chao-mung-den-next-store.segments/_tree.segment.rsc"].includes(req.url)) { res.writeHead(Number(status), { "content-type": "text/html; charset=utf-8" }); res.end(`${og(images[2])}<article><h1>Chào mừng đến next-store</h1></article>`) }
      else if (req.url === "/products" || req.url === "/products?page=abc&sort=xyz") { res.writeHead(Number(status), { "content-type": "text/html; charset=utf-8" }); res.end("<ul aria-label=\"Danh sách sản phẩm\"></ul>") }
      else if (soft && new RegExp(soft).test(req.url)) { res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); res.end(body) }
      else { res.writeHead(404, { "content-type": "text/html; charset=utf-8" }); res.end(body) }
    }).listen(Number(port), "127.0.0.1", () => fs.writeFileSync(ready, ""))
  ' "$port" "$headers" "$ready" "$status" "$body" "$soft" "$hard" "$robotsTag" "$origin" "$robotsRule" "$ogStatus" "$postStatus" "$rscStatus" "$securityFile" "$adminMode" "$hsts" &
  PIDS+=($!)
  local i
  for i in $(seq 1 50); do [ -f "$ready" ] && return 0; sleep 0.1; done
  echo "server thử không khởi động được trên cổng $port" >&2; exit 1
}

# run <env…> -- <command…>: runs with the shim first on PATH, output in $TMP/out, exit code in $CODE.
run() {
  local envs=()
  while [ "$1" != -- ]; do envs+=("$1"); shift; done
  shift
  rm -f "$TMP/curl-calls"
  : > "$TMP/curl-calls"
  set +e
  env -u BASE_URL -u VERCEL_AUTOMATION_BYPASS_SECRET -u SMOKE_PORT -u SMOKE_ROBOTS -u SMOKE_HSTS -u SMOKE_PRODUCT_FAIL_OPEN PATH="$TMP/bin:$PATH" "${envs[@]}" "$@" > "$TMP/out" 2>&1
  CODE=$?
  set -e
}

start_server "$PORT" "$TMP/headers"

# http-no-header: a plain-http target never receives the bypass secret; curl is pinned to http.
: > "$TMP/headers"
run BASE_URL="http://127.0.0.1:$PORT" VERCEL_AUTOMATION_BYPASS_SECRET="$SECRET" -- bash scripts/smoke.sh
[ "$CODE" = 0 ] || fail http-no-header "smoke.sh thoát $CODE, cần 0"
[ -s "$TMP/headers" ] || fail http-no-header "server thử không nhận request nào"
! grep -qi 'x-vercel-protection-bypass' "$TMP/headers" || fail http-no-header "header bypass bị gửi qua http"
! grep -qF "$SECRET" "$TMP/headers" "$TMP/out" || fail http-no-header "secret lộ ra"
grep -q -- "-g --proto =http --proto-redir =http" "$TMP/curl-calls" || fail http-no-header "curl thiếu -g / --proto =http"
grep -q -- "--url http://127.0.0.1:$PORT/" "$TMP/curl-calls" || fail http-no-header "URL không đi qua --url"
echo "ok http-no-header"

# http-remote-refused: plain http is only allowed to localhost; refused before any request.
for url in http://example.com "http://127.0.0.1.example.com:$PORT" "https://user:pw@example.com" "https://example.com/path" "ftp://127.0.0.1"; do
  : > "$TMP/headers"
  run BASE_URL="$url" -- bash scripts/smoke.sh
  [ "$CODE" = 1 ] || fail http-remote-refused "$url: thoát $CODE, cần 1"
  [ ! -s "$TMP/curl-calls" ] || fail http-remote-refused "$url: curl đã được gọi"
  [ ! -s "$TMP/headers" ] || fail http-remote-refused "$url: server thử nhận request"
  ! grep -qF 'pw@' "$TMP/out" || fail http-remote-refused "$url: thông báo lặp lại BASE_URL"
done
echo "ok http-remote-refused"

# bad-secret: a secret outside [A-Za-z0-9_-]{16,128} is refused without being echoed.
for secret in 'a"b' 'short' "$SECRET\"; url = \"http://evil"; do
  run BASE_URL=https://127.0.0.1:1 VERCEL_AUTOMATION_BYPASS_SECRET="$secret" -- bash scripts/smoke.sh
  [ "$CODE" = 1 ] || fail bad-secret "thoát $CODE, cần 1"
  ! grep -qF -- "$secret" "$TMP/out" || fail bad-secret "thông báo lặp lại secret"
  [ ! -s "$TMP/curl-calls" ] || fail bad-secret "curl đã được gọi"
done
echo "ok bad-secret"

# bad-port: SMOKE_PORT must be 1–65535, digits only.
for port in abc 0 65536 '3100 ' '-1' '1;id'; do
  run SMOKE_PORT="$port" -- bash scripts/smoke.sh
  [ "$CODE" = 1 ] || fail bad-port "SMOKE_PORT=$port: thoát $CODE, cần 1"
  grep -q 'SMOKE_PORT' "$TMP/out" || fail bad-port "SMOKE_PORT=$port: thông báo không nêu SMOKE_PORT"
  [ ! -s "$TMP/curl-calls" ] || fail bad-port "SMOKE_PORT=$port: curl đã được gọi"
done
echo "ok bad-port"

# busy-port: a server already on SMOKE_PORT (e.g. a stale `next start`) is refused, never tested.
start_server "$BUSY_PORT" "$TMP/busy-headers"
: > "$TMP/busy-headers"
run SMOKE_PORT="$BUSY_PORT" -- bash scripts/smoke.sh
[ "$CODE" = 1 ] || fail busy-port "thoát $CODE, cần 1"
grep -qF "cổng $BUSY_PORT đang bận" "$TMP/out" || fail busy-port "thiếu \"cổng $BUSY_PORT đang bận\""
[ ! -s "$TMP/busy-headers" ] || fail busy-port "smoke đã kiểm server đang giữ cổng"
echo "ok busy-port"

# xtrace-no-secret: `bash -x` must not print the secret (connection to port 1 fails, so exit 1).
run BASE_URL=https://127.0.0.1:1 VERCEL_AUTOMATION_BYPASS_SECRET="$SECRET" -- bash -x scripts/smoke.sh
[ "$CODE" = 1 ] || fail xtrace-no-secret "thoát $CODE, cần 1"
grep -q '^+' "$TMP/out" || fail xtrace-no-secret "không thấy output của xtrace"
grep -q -- "--proto =https --proto-redir =https" "$TMP/curl-calls" || fail xtrace-no-secret "curl thiếu --proto =https"
! grep -qF "$SECRET" "$TMP/out" "$TMP/curl-calls" || fail xtrace-no-secret "secret lộ ra trong xtrace hoặc tham số curl"
echo "ok xtrace-no-secret"

# The 401 branch reads whether a secret was given; under `bash -x` it must not print the secret either.
start_server "$DENY_PORT" "$TMP/deny-headers" 401
run BASE_URL="http://127.0.0.1:$DENY_PORT" VERCEL_AUTOMATION_BYPASS_SECRET="$SECRET" -- bash -x scripts/smoke.sh
[ "$CODE" = 1 ] || fail xtrace-no-secret "401: thoát $CODE, cần 1"
grep -qF 'Deployment Protection chặn' "$TMP/out" || fail xtrace-no-secret "401: thiếu thông báo Deployment Protection"
! grep -qF "$SECRET" "$TMP/out" "$TMP/curl-calls" || fail xtrace-no-secret "401: secret lộ ra trong xtrace"
echo "ok xtrace-no-secret-401"

# english-404 (NS-38): a 404 that is Next.js's built-in English page fails smoke even though the status is right.
start_server "$EN_404_PORT" "$TMP/en-headers" 200 "<h2>This page could not be found.</h2>"
run BASE_URL="http://127.0.0.1:$EN_404_PORT" -- bash scripts/smoke.sh
[ "$CODE" = 1 ] || fail english-404 "thoát $CODE, cần 1"
grep -qF 'Không tìm thấy trang' "$TMP/out" || fail english-404 "thông báo không nêu trang 404 tiếng Việt"
echo "ok english-404"

# soft-404 (US-05, K3): an unknown product slug answered 200 with the not-found page fails smoke.
start_server "$SOFT_404_PORT" "$TMP/soft-headers" 200 "<h1>Không tìm thấy trang</h1>" '^/products/khong-ton-tai'
run BASE_URL="http://127.0.0.1:$SOFT_404_PORT" -- bash scripts/smoke.sh
[ "$CODE" = 1 ] || fail soft-404 "thoát $CODE, cần 1"
grep -qF 'GET /products/khong-ton-tai (slug cố định của US-05) trả 200 ngay lần đầu' "$TMP/out" || fail soft-404 "thông báo không nêu slug trả 200"
echo "ok soft-404"

# soft-404-rsc: only the RSC form of an unknown slug answering 200 still fails smoke.
start_server "$SOFT_RSC_PORT" "$TMP/soft-rsc-headers" 200 "<h1>Không tìm thấy trang</h1>" '^/products/khong-ton-tai-suffix-'
run BASE_URL="http://127.0.0.1:$SOFT_RSC_PORT" -- bash scripts/smoke.sh
[ "$CODE" = 1 ] || fail soft-404-rsc "thoát $CODE, cần 1"
grep -qF '(hậu tố .rsc) trả 200 ngay lần đầu' "$TMP/out" || fail soft-404-rsc "thông báo không nêu hậu tố .rsc"
echo "ok soft-404-rsc"

# first-product-404 (ADR-0017, NS-79): the proxy answers product slugs from the static registry, so the very first
# request for a fresh unknown product slug must be a 404: no warm-up, no fail-open allowed. One request, then smoke
# fails at once and names it.
start_server "$FIRST_PRODUCT_PORT" "$TMP/first-product-headers" 200 "<h1>Không tìm thấy trang</h1>" '^/products/smoke-first-'
run BASE_URL="http://127.0.0.1:$FIRST_PRODUCT_PORT" -- bash scripts/smoke.sh
[ "$CODE" = 1 ] || fail first-product-404 "thoát $CODE, cần 1"
grep -qE 'GET /products/smoke-first-[0-9-]+ \(slug sản phẩm lạ đầu tiên\) trả 200, cần 404 ngay lần đầu' "$TMP/out" ||
  fail first-product-404 "thông báo không nêu slug sản phẩm lạ đầu tiên"
[ "$(grep -c 'smoke-first-' "$TMP/curl-calls")" = 1 ] || fail first-product-404 "cần đúng 1 request cho slug lạ đầu tiên"
! grep -q 'smoke-warmup-' "$TMP/curl-calls" || fail first-product-404 "còn request warm-up"
echo "ok first-product-404"

# no-warning: no fail-open → no ::warning::.
run BASE_URL="http://127.0.0.1:$PORT" -- bash scripts/smoke.sh
[ "$CODE" = 0 ] || fail no-warning "thoát $CODE, cần 0"
! grep -q '::warning::' "$TMP/out" || fail no-warning "có ::warning:: dù không fail-open"
echo "ok no-warning"

# known-segment-404 (audit PR #26 M1): a known product's segment prefetch path answered 404 fails smoke.
start_server "$SEG_PORT" "$TMP/seg-headers" 200 "<h1>Không tìm thấy trang</h1>" "" '^/products/ao-404-not-found\.segments/'
run BASE_URL="http://127.0.0.1:$SEG_PORT" -- bash scripts/smoke.sh
[ "$CODE" = 1 ] || fail known-segment-404 "thoát $CODE, cần 1"
grep -qF '(segment prefetch dạng đường dẫn) bị proxy rewrite sang not-found' "$TMP/out" || fail known-segment-404 "thông báo không nêu segment prefetch"
echo "ok known-segment-404"

# robots-policy (owner decision 15 fallback, NS-65): SMOKE_ROBOTS=disallow fails on `Allow: /` and passes on
# `Disallow: /`; unset accepts either and prints it; X-Robots-Tag is only reported, present or not.
run BASE_URL="http://127.0.0.1:$PORT" SMOKE_ROBOTS=disallow -- bash scripts/smoke.sh
[ "$CODE" = 1 ] || fail robots-policy "Allow với SMOKE_ROBOTS=disallow: thoát $CODE, cần 1"
grep -qF '/robots.txt là allow, cần disallow' "$TMP/out" || fail robots-policy "thông báo không nêu chính sách robots"
run BASE_URL="http://127.0.0.1:$PORT" -- bash scripts/smoke.sh
[ "$CODE" = 0 ] || fail robots-policy "không có cờ: thoát $CODE, cần 0"
grep -qF 'GET / → x-robots-tag: <không có>' "$TMP/out" || fail robots-policy "không in header thiếu"
grep -qF 'GET /robots.txt → 200, allow /' "$TMP/out" || fail robots-policy "không in chính sách robots"
start_server "$NOINDEX_PORT" "$TMP/noindex-headers" 200 "<h1>Không tìm thấy trang</h1>" "" "" "noindex" "" "Disallow: /"
run BASE_URL="http://127.0.0.1:$NOINDEX_PORT" SMOKE_ROBOTS=disallow -- bash scripts/smoke.sh
[ "$CODE" = 0 ] || fail robots-policy "Disallow với SMOKE_ROBOTS=disallow: thoát $CODE, cần 0"
for path in / /robots.txt /sitemap.xml; do
  grep -qF "GET $path → x-robots-tag: noindex" "$TMP/out" || fail robots-policy "không in header của $path"
done
run BASE_URL="http://127.0.0.1:$NOINDEX_PORT" SMOKE_ROBOTS=allow -- bash scripts/smoke.sh
[ "$CODE" = 1 ] || fail robots-policy "Disallow với SMOKE_ROBOTS=allow: thoát $CODE, cần 1"
echo "ok robots-policy"

# bad-robots-flag: SMOKE_ROBOTS is allow, disallow or empty; refused before any request.
run SMOKE_ROBOTS=yes -- bash scripts/smoke.sh
[ "$CODE" = 1 ] || fail bad-robots-flag "thoát $CODE, cần 1"
[ ! -s "$TMP/curl-calls" ] || fail bad-robots-flag "curl đã được gọi"
echo "ok bad-robots-flag"

# sitemap-two-origins (US-11, K6): a sitemap whose <loc> mix two hosts (e.g. a page left on localhost) fails smoke.
start_server "$SITEMAP_PORT" "$TMP/sitemap-headers" 200 "<h1>Không tìm thấy trang</h1>" "" "" "" "http://localhost:3000"
run BASE_URL="http://127.0.0.1:$SITEMAP_PORT" -- bash scripts/smoke.sh
[ "$CODE" = 1 ] || fail sitemap-two-origins "thoát $CODE, cần 1"
grep -qF '/sitemap.xml có <loc> trên nhiều origin' "$TMP/out" || fail sitemap-two-origins "thông báo không nêu nhiều origin"
echo "ok sitemap-two-origins"

# og-image (US-11, K8): each og:image is fetched by path on BASE, not on the tag's host; an image route that answers
# 500 at request time fails smoke.
run BASE_URL="http://127.0.0.1:$PORT" -- bash scripts/smoke.sh
[ "$CODE" = 0 ] || fail og-image "thoát $CODE, cần 0"
grep -qF 'og:image của /products/ao-404-not-found → GET /products/ao-404-not-found/opengraph-image-16g1u1?d4e5f6 → 200, image/png' "$TMP/out" ||
  fail og-image "không kiểm og:image của sản phẩm"
! grep -q 'localhost:3000' "$TMP/curl-calls" || fail og-image "đã gọi host trong thẻ thay vì BASE_URL"
start_server "$OG_PORT" "$TMP/og-headers" 200 "<h1>Không tìm thấy trang</h1>" "" "" "" "" "" 500
run BASE_URL="http://127.0.0.1:$OG_PORT" -- bash scripts/smoke.sh
[ "$CODE" = 1 ] || fail og-image "ảnh trả 500: thoát $CODE, cần 1"
grep -qF 'GET /opengraph-image?a1b2c3 (og:image của /) trả 500, cần 200' "$TMP/out" || fail og-image "thông báo không nêu ảnh lỗi"
echo "ok og-image"

# soft-404-blog (US-10, ADR-0012): an unknown blog slug answered 200 with the not-found page (page-level notFound(),
# K3) fails smoke, without any warm-up: the blog branch of the proxy has no database lookup to wait for.
start_server "$SOFT_BLOG_PORT" "$TMP/soft-blog-headers" 200 "<h1>Không tìm thấy trang</h1>" '^/blog/khong-ton-tai-[0-9]'
run BASE_URL="http://127.0.0.1:$SOFT_BLOG_PORT" -- bash scripts/smoke.sh
[ "$CODE" = 1 ] || fail soft-404-blog "thoát $CODE, cần 1"
grep -qF '(bài: slug mới) trả 200 ngay lần đầu' "$TMP/out" || fail soft-404-blog "thông báo không nêu slug bài trả 200"
[ "$(grep -c 'blog/smoke-warmup-' "$TMP/curl-calls")" = 0 ] || fail soft-404-blog "có request warm-up cho blog"
grep -qF -- "--url http://127.0.0.1:$SOFT_BLOG_PORT/blog/constructor" "$TMP/curl-calls" || fail soft-404-blog "không kiểm /blog/constructor"
echo "ok soft-404-blog"

# soft-og (US-11, K10): the open graph image of an unknown slug answered 200 fails smoke. The unknown path keeps the
# hash suffix of the real og:image, with the slug swapped.
start_server "$SOFT_OG_PORT" "$TMP/soft-og-headers" 200 "<h1>Không tìm thấy trang</h1>" '^/blog/khong-ton-tai-og-[0-9-]+/opengraph-image-16g1u1'
run BASE_URL="http://127.0.0.1:$SOFT_OG_PORT" -- bash scripts/smoke.sh
[ "$CODE" = 1 ] || fail soft-og "thoát $CODE, cần 1"
grep -qF '(ảnh OG: slug bài lạ) trả 200 ngay lần đầu' "$TMP/out" || fail soft-og "thông báo không nêu ảnh OG của slug bài lạ"
grep -qE -- '--url http://127\.0\.0\.1:[0-9]+/products/khong-ton-tai-og-[0-9-]+/opengraph-image-16g1u1\?d4e5f6' "$TMP/curl-calls" ||
  fail soft-og "không kiểm ảnh OG có hậu tố băm của slug sản phẩm lạ"
grep -qE -- '--url http://127\.0\.0\.1:[0-9]+/products/khong-ton-tai-og-[0-9-]+-2/opengraph-image( |$)' "$TMP/curl-calls" ||
  fail soft-og "không kiểm ảnh OG không hậu tố băm của slug sản phẩm lạ"
echo "ok soft-og"

# known-post-segment-404: a known post's segment prefetch path rewritten to not-found fails smoke, like a product's.
start_server "$POST_SEG_PORT" "$TMP/post-seg-headers" 200 "<h1>Không tìm thấy trang</h1>" "" '^/blog/chao-mung-den-next-store\.segments/'
run BASE_URL="http://127.0.0.1:$POST_SEG_PORT" -- bash scripts/smoke.sh
[ "$CODE" = 1 ] || fail known-post-segment-404 "thoát $CODE, cần 1"
grep -qF '(bài: segment prefetch dạng đường dẫn) bị proxy rewrite sang not-found' "$TMP/out" || fail known-post-segment-404 "thông báo không nêu segment prefetch của bài"
echo "ok known-post-segment-404"

# product-unknown-404 (ADR-0017, NS-79): every well-formed unknown product slug answering 200 (a proxy that let it
# through) fails smoke, in every form: fixed slug, fresh slug, RSC, .rsc, segment, product OG image. Every case is
# reported before smoke fails. POST, PUT and GET after POST: product-unknown-405, non-action-200.
start_server "$UNKNOWN_PRODUCT_PORT" "$TMP/unknown-product-headers" 200 "<h1>Không tìm thấy trang</h1>" '^/products/khong-ton-tai'
run BASE_URL="http://127.0.0.1:$UNKNOWN_PRODUCT_PORT" -- bash scripts/smoke.sh
[ "$CODE" = 1 ] || fail product-unknown-404 "thoát $CODE, cần 1"
for label in 'slug cố định của US-05' 'slug mới' 'request RSC' 'hậu tố .rsc' 'segment prefetch dạng đường dẫn' \
  'segment prefetch dạng đường dẫn, không header' 'ảnh OG: slug sản phẩm lạ' 'ảnh OG: slug sản phẩm lạ, không hậu tố băm'; do
  grep -qE "LỖI: GET /products/[^ ]+ \\($label\\) trả 200 ngay lần đầu, cần 404" "$TMP/out" ||
    fail product-unknown-404 "thiếu LỖI cho \"$label\""
done
grep -qF '(%2D) → 404' "$TMP/out" || fail product-unknown-404 "ca %2D không còn được kiểm 404"
grep -qF '(chữ hoa) → 404' "$TMP/out" || fail product-unknown-404 "ca chữ hoa không còn được kiểm 404"
grep -qF 'slug hoặc ảnh OG không tồn tại không trả 404 ngay lần đầu' "$TMP/out" || fail product-unknown-404 "thiếu dòng tóm tắt"
! grep -q '::warning::' "$TMP/out" || fail product-unknown-404 "có ::warning:: thay cho lỗi"
echo "ok product-unknown-404"

# product-unknown-405 (NS-110): a POST without next-action or a PUT to an unknown product slug that reaches the page
# (Next answers 405) is no longer a tolerated fail-open: it fails smoke.
start_server "$UNKNOWN_405_PORT" "$TMP/unknown-405-headers" 200 "<h1>Không tìm thấy trang</h1>" '^/products/khong-ton-tai-(post|put)-' "" "" https://shop.example.test "Allow: /" 200 405
run BASE_URL="http://127.0.0.1:$UNKNOWN_405_PORT" -- bash scripts/smoke.sh
[ "$CODE" = 1 ] || fail product-unknown-405 "thoát $CODE, cần 1"
for label in 'POST không có next-action' 'PUT'; do
  grep -qE "LỖI: (POST|PUT) /products/[^ ]+ \\($label\\) trả 405 ngay lần đầu, cần 404" "$TMP/out" ||
    fail product-unknown-405 "thiếu LỖI 405 cho \"$label\""
done
echo "ok product-unknown-405"

# product-unknown-307 (NS-111): under `next start` an RSC request (`rsc: 1`) to an unknown product slug that the proxy
# let through answers 307 to <path>?_rsc; that fails smoke, like a 307 to a request without the rsc header.
start_server "$UNKNOWN_307_PORT" "$TMP/unknown-307-headers" 200 "<h1>Không tìm thấy trang</h1>" '^/products/khong-ton-tai' "" "" https://shop.example.test "Allow: /" 200 "" 307
run BASE_URL="http://127.0.0.1:$UNKNOWN_307_PORT" -- bash scripts/smoke.sh
[ "$CODE" = 1 ] || fail product-unknown-307 "thoát $CODE, cần 1"
for label in 'request RSC' 'segment prefetch dạng đường dẫn'; do
  grep -qE "LỖI: GET /products/[^ ]+ \\($label\\) trả 307 ngay lần đầu, cần 404" "$TMP/out" ||
    fail product-unknown-307 "thiếu LỖI 307 cho \"$label\""
done
start_server "$REDIRECT_PORT" "$TMP/redirect-headers" 200 "<h1>Không tìm thấy trang</h1>" '^/products/khong-ton-tai-post-' "" "" https://shop.example.test "Allow: /" 200 307
run BASE_URL="http://127.0.0.1:$REDIRECT_PORT" -- bash scripts/smoke.sh
[ "$CODE" = 1 ] || fail product-unknown-307 "POST 307: thoát $CODE, cần 1"
grep -qE '\(POST không có next-action\) trả 307 ngay lần đầu, cần 404' "$TMP/out" || fail product-unknown-307 "không nêu POST 307"
echo "ok product-unknown-307"

# non-action-200 (NS-103): a proxy that lets every non-GET through (the NS-92 behaviour) answers 200 to a POST without
# next-action, a PUT or a DELETE to an unknown slug; smoke fails.
# GET to the same paths is still 404.
start_server "$NON_ACTION_PORT" "$TMP/non-action-headers" 200 "<h1>Không tìm thấy trang</h1>" "" "" "" https://shop.example.test "Allow: /" 200 200
run BASE_URL="http://127.0.0.1:$NON_ACTION_PORT" -- bash scripts/smoke.sh
[ "$CODE" = 1 ] || fail non-action-200 "thoát $CODE, cần 1"
for line in 'POST /products/KHONG-TON-TAI-POST-[^ ]+ \(POST không có next-action, chữ hoa\) trả 200 ngay lần đầu, cần 404' \
  'POST /blog/khong-ton-tai-post-[^ ]+ \(bài: POST không có next-action\) trả 200 ngay lần đầu, cần 404' \
  'DELETE /blog/khong-ton-tai-delete-[^ ]+ \(bài: DELETE\) trả 200 ngay lần đầu, cần 404' \
  'request không phải Server Action tới slug lạ không trả 404'; do
  grep -qE "$line" "$TMP/out" || fail non-action-200 "thiếu dòng: $line"
done
grep -qE 'GET /products/khong-ton-tai-post-[^ ]+ \(GET sau POST cùng slug\) → 404' "$TMP/out" ||
  fail non-action-200 "GET sau POST không còn được kiểm"
grep -qF -- "-X POST --data smoke=1" "$TMP/curl-calls" || fail non-action-200 "POST không gửi body cố định"
! grep -qi 'next-action' "$TMP/curl-calls" "$TMP/non-action-headers" || fail non-action-200 "smoke gửi next-action"
echo "ok non-action-200"

# non-action-5xx: a 5xx to a request that is not a Server Action fails smoke with the method in the message.
start_server "$NON_ACTION_5XX_PORT" "$TMP/non-action-5xx-headers" 200 "<h1>Không tìm thấy trang</h1>" "" "" "" https://shop.example.test "Allow: /" 200 500
run BASE_URL="http://127.0.0.1:$NON_ACTION_5XX_PORT" -- bash scripts/smoke.sh
[ "$CODE" = 1 ] || fail non-action-5xx "thoát $CODE, cần 1"
grep -qE 'PUT /products/khong-ton-tai-put-[^ ]+ \(PUT\) trả 500 ngay lần đầu, cần 404' "$TMP/out" ||
  fail non-action-5xx "thông báo không nêu PUT trả 500"
echo "ok non-action-5xx"

# removed-fail-open-flag (ADR-0017 (e)): SMOKE_PRODUCT_FAIL_OPEN is gone. Any value, `warn` included, is refused before
# any request, so a workflow still setting it cannot believe it tolerates something.
for flag in warn yes; do
  run SMOKE_PRODUCT_FAIL_OPEN="$flag" -- bash scripts/smoke.sh
  [ "$CODE" = 1 ] || fail removed-fail-open-flag "$flag: thoát $CODE, cần 1"
  grep -qF 'SMOKE_PRODUCT_FAIL_OPEN đã bỏ' "$TMP/out" || fail removed-fail-open-flag "$flag: thông báo không nêu biến"
  [ ! -s "$TMP/curl-calls" ] || fail removed-fail-open-flag "$flag: curl đã được gọi"
done
echo "ok removed-fail-open-flag"

# proxy-timing (NS-79): the time of /robots.txt and of an unknown blog slug (through the proxy, no database) is printed
# next to each other; information only.
run BASE_URL="http://127.0.0.1:$PORT" -- bash scripts/smoke.sh
[ "$CODE" = 0 ] || fail proxy-timing "thoát $CODE, cần 0"
grep -qE '^smoke: thời gian: GET /robots.txt [0-9]+ ms; GET /blog/smoke-proxy-[0-9-]+ \(qua proxy, không chạm DB\) → 404, [0-9]+ ms$' "$TMP/out" ||
  fail proxy-timing "thiếu dòng thời gian của /robots.txt và slug bài lạ"
grep -qE '^smoke: GET /products/khong-ton-tai \(slug cố định của US-05\) → 404, [0-9]+ ms$' "$TMP/out" || fail proxy-timing "dòng 404 thiếu thời gian"
grep -qE '^smoke: GET /products/smoke-first-[0-9-]+ \(slug sản phẩm lạ đầu tiên\) → 404, [0-9]+ ms$' "$TMP/out" ||
  fail proxy-timing "thiếu thời gian của slug sản phẩm lạ đầu tiên"
echo "ok proxy-timing"

# security-headers (NS-108): every checked response must carry the four security headers of next.config.ts. A response
# that leaves them out (the home page, robots.txt, the sitemap, the 404 page, the proxy's 404 rewrite, a product page,
# an og:image) or leaves out a single one of them fails smoke and names the path and the header.
start_server "$SECURITY_PORT" "$TMP/security-headers" 200 "<h1>Không tìm thấy trang</h1>" "" "" "" https://shop.example.test "Allow: /" 200 "" "" "$TMP/security-omit"
run BASE_URL="http://127.0.0.1:$SECURITY_PORT" -- bash scripts/smoke.sh
[ "$CODE" = 0 ] || fail security-headers "đủ header: thoát $CODE, cần 0"
grep -qF 'smoke: header bảo mật có trên' "$TMP/out" || fail security-headers "thiếu dòng tóm tắt header bảo mật"
for omit in '^/$|/' '^/robots\.txt$|/robots.txt' '^/sitemap\.xml$|/sitemap.xml' '^/khong-ton-tai$|/khong-ton-tai' \
  '^/blog/smoke-headers-|/blog/smoke-headers-' '^/products/ao-404-not-found$|/products/ao-404-not-found' \
  '^/products/ao-404-not-found/opengraph-image|/products/ao-404-not-found/opengraph-image'; do
  printf '%s\n' "${omit%%|*}" > "$TMP/security-omit"
  run BASE_URL="http://127.0.0.1:$SECURITY_PORT" -- bash scripts/smoke.sh
  [ "$CODE" = 1 ] || fail security-headers "${omit#*|} thiếu header: thoát $CODE, cần 1"
  grep -qE "LỖI: GET ${omit#*|}[^ ]* thiếu header x-frame-options" "$TMP/out" ||
    fail security-headers "${omit#*|} thiếu header: thông báo không nêu đường dẫn và header"
done
for name in x-frame-options content-security-policy x-content-type-options referrer-policy; do
  printf '%s\n%s\n' '^/robots\.txt$' "$name" > "$TMP/security-omit"
  run BASE_URL="http://127.0.0.1:$SECURITY_PORT" -- bash scripts/smoke.sh
  [ "$CODE" = 1 ] || fail security-headers "thiếu $name: thoát $CODE, cần 1"
  grep -qF "thiếu header $name" "$TMP/out" || fail security-headers "thiếu $name: thông báo không nêu header"
done
rm -f "$TMP/security-omit"
echo "ok security-headers"

# csp-baseline (ADR-0020): the CSP of next.config.ts is the full baseline; the old frame-ancestors-only policy of
# ADR-0016 fails smoke.
start_server "$CSP_OLD_PORT" "$TMP/csp-old-headers" 200 "<h1>Không tìm thấy trang</h1>" "" "" "" https://shop.example.test "Allow: /" 200 "" "" "" csp-old
run BASE_URL="http://127.0.0.1:$CSP_OLD_PORT" -- bash scripts/smoke.sh
[ "$CODE" = 1 ] || fail csp-baseline "CSP chỉ frame-ancestors: thoát $CODE, cần 1"
grep -qF 'LỖI: GET / thiếu header content-security-policy' "$TMP/out" || fail csp-baseline "thông báo không nêu CSP"
# The Vercel Toolbar's sources (Preview build): accepted with robots.txt Disallow: /, refused with Allow: / (Production).
start_server "$CSP_PREVIEW_PORT" "$TMP/csp-preview-headers" 200 "<h1>Không tìm thấy trang</h1>" "" "" "" https://shop.example.test "Disallow: /" 200 "" "" "" csp-preview
run BASE_URL="http://127.0.0.1:$CSP_PREVIEW_PORT" -- bash scripts/smoke.sh
[ "$CODE" = 0 ] || fail csp-baseline "CSP Preview, robots Disallow: thoát $CODE, cần 0"
grep -qF 'smoke: CSP nền có nguồn thanh công cụ Vercel' "$TMP/out" || fail csp-baseline "thiếu dòng CSP Preview"
start_server "$CSP_PREVIEW_ALLOW_PORT" "$TMP/csp-preview-allow-headers" 200 "<h1>Không tìm thấy trang</h1>" "" "" "" https://shop.example.test "Allow: /" 200 "" "" "" csp-preview
run BASE_URL="http://127.0.0.1:$CSP_PREVIEW_ALLOW_PORT" -- bash scripts/smoke.sh
[ "$CODE" = 1 ] || fail csp-baseline "CSP Preview, robots Allow (Production): thoát $CODE, cần 1"
grep -qF 'LỖI: GET / thiếu header content-security-policy' "$TMP/out" || fail csp-baseline "CSP Preview trên Production: thông báo không nêu CSP"
echo "ok csp-baseline"

# hsts (ADR-0020 10A): HSTS is required on a Vercel URL (SMOKE_HSTS=require stands for it here: the fake server is
# plain http), skipped elsewhere; a max-age under a year fails; an unknown SMOKE_HSTS value is refused before any
# request.
run BASE_URL="http://127.0.0.1:$PORT" -- bash scripts/smoke.sh
grep -qF 'smoke: HSTS không kiểm (không phải URL Vercel)' "$TMP/out" || fail hsts "http: thiếu dòng bỏ qua HSTS"
run SMOKE_HSTS=require BASE_URL="http://127.0.0.1:$PORT" -- bash scripts/smoke.sh
[ "$CODE" = 1 ] || fail hsts "require, không có header: thoát $CODE, cần 1"
grep -qF 'LỖI: GET / thiếu Strict-Transport-Security' "$TMP/out" || fail hsts "require: thông báo không nêu HSTS"
start_server "$HSTS_PORT" "$TMP/hsts-headers" 200 "<h1>Không tìm thấy trang</h1>" "" "" "" https://shop.example.test "Allow: /" 200 "" "" "" "" "max-age=63072000; includeSubDomains; preload"
run SMOKE_HSTS=require BASE_URL="http://127.0.0.1:$HSTS_PORT" -- bash scripts/smoke.sh
[ "$CODE" = 0 ] || fail hsts "require, header của Vercel: thoát $CODE, cần 0"
grep -qF 'smoke: GET / → strict-transport-security: max-age=63072000; includeSubDomains; preload' "$TMP/out" || fail hsts "thiếu dòng HSTS"
start_server "$HSTS_SHORT_PORT" "$TMP/hsts-short-headers" 200 "<h1>Không tìm thấy trang</h1>" "" "" "" https://shop.example.test "Allow: /" 200 "" "" "" "" "max-age=86400"
run SMOKE_HSTS=require BASE_URL="http://127.0.0.1:$HSTS_SHORT_PORT" -- bash scripts/smoke.sh
[ "$CODE" = 1 ] || fail hsts "max-age một ngày: thoát $CODE, cần 1"
run SMOKE_HSTS=yes BASE_URL="http://127.0.0.1:$PORT" -- bash scripts/smoke.sh
[ "$CODE" = 1 ] && grep -qF 'SMOKE_HSTS không hợp lệ' "$TMP/out" || fail hsts "SMOKE_HSTS=yes: không bị từ chối"
[ ! -s "$TMP/curl-calls" ] || fail hsts "SMOKE_HSTS=yes: vẫn gửi request"
echo "ok hsts"

# admin-guard (US-12, M5 Task 8): smoke checks every admin path a visitor without a session can reach. The default
# server answers like the proxy; each mode breaks one part and must fail smoke, naming it.
: > "$TMP/headers"
run BASE_URL="http://127.0.0.1:$PORT" -- bash scripts/smoke.sh
[ "$CODE" = 0 ] || fail admin-guard "proxy đúng: thoát $CODE, cần 0"
for line in 'smoke: GET /admin/products (không cookie) → 307 /admin/login' \
  'smoke: GET /admin/products (cookie __Host-ns_admin rác) → Set-Cookie xoá __Host-ns_admin' \
  'smoke: GET /admin/products (cookie ns_admin rác) → Set-Cookie xoá ns_admin' \
  'smoke: POST /admin/products (Server Action, không phiên) → 401' \
  'smoke: GET /%61dmin/products (đường dẫn admin viết khác) → 307' \
  'smoke: GET /Admin/products (đường dẫn admin viết khác) → 404' \
  'smoke: GET /admin/login → 200, noindex, không Set-Cookie' \
  "smoke: GET /admin/login (lần nữa) → CSP nonce 'strict-dynamic', 2 / 2 <script> mang nonce" \
  'smoke: GET /admin/login (lần nữa) → 1 header content-security-policy' \
  "smoke:   content-security-policy: default-src 'self'; script-src 'self' 'nonce-"; do
  grep -qF -- "$line" "$TMP/out" || fail admin-guard "thiếu dòng \"$line\""
done
# The next-action header reaches only /admin/* (the fake server logs every request's headers).
grep -c '"next-action"' "$TMP/headers" | grep -qx 2 || fail admin-guard "next-action được gửi ngoài hai request admin"
# Vercel may send the baseline of next.config.ts as a second CSP header (audit PR #110 L3): safe, smoke passes and
# says so (NS-133).
start_server "$ADMIN_TWO_CSP_PORT" "$TMP/admin-two-csp-headers" 200 "<h1>Không tìm thấy trang</h1>" "" "" "" https://shop.example.test "Allow: /" 200 "" "" "" csp-two-headers
run BASE_URL="http://127.0.0.1:$ADMIN_TWO_CSP_PORT" -- bash scripts/smoke.sh
[ "$CODE" = 0 ] || fail admin-guard "csp-two-headers: thoát $CODE, cần 0"
for line in 'smoke: GET /admin/login (lần cuối) → 2 header content-security-policy' \
  "smoke:   content-security-policy: default-src 'self'; script-src 'self' 'unsafe-inline';" \
  "smoke: GET /admin/login (lần cuối) → CSP nonce 'strict-dynamic', 2 / 2 <script> mang nonce"; do
  grep -qF -- "$line" "$TMP/out" || fail admin-guard "csp-two-headers: thiếu dòng \"$line\""
done
for mode in open keep-cookie action-open encoded-open login-guarded csp-none csp-missing csp-script-without-nonce csp-same-nonce csp-unsafe-inline; do
  start_server "$ADMIN_PORT" "$TMP/admin-headers-$mode" 200 "<h1>Không tìm thấy trang</h1>" "" "" "" https://shop.example.test "Allow: /" 200 "" "" "" "$mode"
  run BASE_URL="http://127.0.0.1:$ADMIN_PORT" -- bash scripts/smoke.sh
  [ "$CODE" = 1 ] || fail admin-guard "$mode: thoát $CODE, cần 1"
  grep -qF 'khu admin không được chặn đúng' "$TMP/out" || fail admin-guard "$mode: thiếu thông báo tổng"
  case $mode in
    open) expected='LỖI: GET /admin/products (không cookie) trả 200, cần 307 tới /admin/login' ;;
    keep-cookie) expected='LỖI: GET /admin/products (cookie __Host-ns_admin rác) không xoá cookie' ;;
    action-open) expected='LỖI: POST /admin/products (Server Action, không phiên) trả 200, cần 401' ;;
    encoded-open) expected='LỖI: GET /%61dmin/products (đường dẫn admin viết khác) trả 200 kèm nội dung khu admin' ;;
    login-guarded) expected='LỖI: GET /admin/login trả 307, cần 200' ;;
    csp-none) expected='LỖI: GET /admin/login (lần cuối) không có header content-security-policy nào' ;;
    csp-missing) expected="LỖI: GET /admin/login (lần cuối) không có CSP nonce 'strict-dynamic'" ;;
    csp-script-without-nonce) expected='LỖI: GET /admin/login (lần cuối): 1 / 2 thẻ <script> mang nonce của response' ;;
    csp-same-nonce) expected='LỖI: GET /admin/login hai lần trả cùng một nonce' ;;
    csp-unsafe-inline) expected="LỖI: GET /admin/login (lần cuối): CSP nonce có 'unsafe-inline'" ;;
  esac
  grep -qF -- "$expected" "$TMP/out" || fail admin-guard "$mode: thiếu \"$expected\""
  # One port for every mode: stop this server and forget its ready file before the next one starts.
  kill "${PIDS[-1]}" 2>/dev/null || true
  wait "${PIDS[-1]}" 2>/dev/null || true
  rm -f "$TMP/ready-$ADMIN_PORT"
done
echo "ok admin-guard"
