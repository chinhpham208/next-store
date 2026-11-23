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
COLD_PORT=3193
WARM_PORT=3192
SEG_PORT=3191
NOINDEX_PORT=3190
SITEMAP_PORT=3189
OG_PORT=3188
SOFT_BLOG_PORT=3187
SOFT_OG_PORT=3186
POST_SEG_PORT=3185
FAIL_OPEN_PORT=3184
MALFORMED_PORT=3183

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
# product page (and its RSC / segment prefetch forms) with the default SMOKE_TEXT, /blog and the smoke's post (and its
# RSC / segment prefetch forms) with an article and its h1, the smoke's listing paths with the labelled grid (or with <status>, e.g. 401 like Vercel Deployment Protection), everything else with 404 and
# <404-body> (default: the app's Vietnamese page). URLs matching <soft-regex> answer 200 with the not-found page, like
# a page-level notFound() under Cache Components (K3) or a proxy that failed open; URLs matching <hard-404-regex>
# answer 404 with the proxy's rewrite header even when they are a known product's. /sitemap.xml and /robots.txt
# answer like the app on <sitemap-origin> (default https://shop.example.test); <robots-tag>, when set, is sent as
# X-Robots-Tag on every response; <robots-rule> (default `Allow: /`) is the rule line of robots.txt. The pages carry an
# og:image on http://localhost:3000 (as under next start); its path answers <og-status> (default 200) with a PNG.
start_server() {
  local port=$1 headers=$2 status=${3:-200} body=${4:-"<h1>Không tìm thấy trang</h1>"} soft=${5:-} hard=${6:-} robotsTag=${7:-} origin=${8:-https://shop.example.test} robotsRule=${9:-Allow: /} ogStatus=${10:-200} ready="$TMP/ready-$1"
  node -e '
    const [port, headers, ready, status, body, soft, hard, robotsTag, origin, robotsRule, ogStatus] = process.argv.slice(1)
    const og = (path) => `<meta property="og:image" content="http://localhost:3000${path}"/>`
    const images = ["/opengraph-image?a1b2c3", "/products/ao-404-not-found/opengraph-image-16g1u1?d4e5f6", "/blog/chao-mung-den-next-store/opengraph-image-16g1u1?a7b8c9"]
    const fs = require("node:fs")
    require("node:http").createServer((req, res) => {
      fs.appendFileSync(headers, JSON.stringify(req.headers) + "\n")
      if (robotsTag) res.setHeader("x-robots-tag", robotsTag)
      const locs = ["/", "/products/ao-404-not-found", "/blog/chao-mung-den-next-store"]
      if (req.url === "/sitemap.xml") { res.writeHead(200, { "content-type": "application/xml" }); res.end(`<urlset>${locs.map((p) => `<url>\n<loc>${p === "/" ? "https://shop.example.test" : origin}${p}</loc>\n</url>`).join("\n")}</urlset>`); return }
      if (req.url === "/robots.txt") { res.writeHead(200, { "content-type": "text/plain" }); res.end(`User-Agent: *\n${robotsRule}\n\nSitemap: https://shop.example.test/sitemap.xml\n`); return }
      if (images.includes(req.url)) { res.writeHead(Number(ogStatus), { "content-type": Number(ogStatus) === 200 ? "image/png" : "text/html" }); res.end("png"); return }
      if (hard && new RegExp(hard).test(req.url)) { res.writeHead(404, { "content-type": "text/html; charset=utf-8", "x-middleware-rewrite": "/_khong-tim-thay" }); res.end(body) }
      else if (req.url === "/" || ["/products/ao-404-not-found", "/products/ao-404-not-found?_rsc", "/products/ao-404-not-found.rsc", "/products/ao-404-not-found.segments/_tree.segment.rsc"].includes(req.url)) { res.writeHead(Number(status), { "content-type": "text/html; charset=utf-8" }); res.end(`<meta property="og:site_name" content="next-store"/>${og(req.url === "/" ? images[0] : images[1])}<h1>Áo thun 404 Not Found</h1>`) }
      else if (["/blog", "/blog/chao-mung-den-next-store", "/blog/chao-mung-den-next-store?_rsc", "/blog/chao-mung-den-next-store.rsc", "/blog/chao-mung-den-next-store.segments/_tree.segment.rsc"].includes(req.url)) { res.writeHead(Number(status), { "content-type": "text/html; charset=utf-8" }); res.end(`${og(images[2])}<article><h1>Chào mừng đến next-store</h1></article>`) }
      else if (req.url === "/products" || req.url === "/products?page=abc&sort=xyz") { res.writeHead(Number(status), { "content-type": "text/html; charset=utf-8" }); res.end("<ul aria-label=\"Danh sách sản phẩm\"></ul>") }
      else if (soft && new RegExp(soft).test(req.url)) { res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); res.end(body) }
      else { res.writeHead(404, { "content-type": "text/html; charset=utf-8" }); res.end(body) }
    }).listen(Number(port), "127.0.0.1", () => fs.writeFileSync(ready, ""))
  ' "$port" "$headers" "$ready" "$status" "$body" "$soft" "$hard" "$robotsTag" "$origin" "$robotsRule" "$ogStatus" &
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
  env -u BASE_URL -u VERCEL_AUTOMATION_BYPASS_SECRET -u SMOKE_PORT -u SMOKE_ROBOTS -u SMOKE_PRODUCT_FAIL_OPEN PATH="$TMP/bin:$PATH" "${envs[@]}" "$@" > "$TMP/out" 2>&1
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

# cold-lookup: the proxy never gets a working lookup (every fresh slug answers 200) → smoke fails after 3 warm-up
# requests, i.e. more than 2 fail-opens.
start_server "$COLD_PORT" "$TMP/cold-headers" 200 "<h1>Không tìm thấy trang</h1>" '^/products/smoke-warmup-'
run BASE_URL="http://127.0.0.1:$COLD_PORT" -- bash scripts/smoke.sh
[ "$CODE" = 1 ] || fail cold-lookup "thoát $CODE, cần 1"
grep -qF 'hơn 2 slug fail-open' "$TMP/out" || fail cold-lookup "thiếu thông báo warm-up"
[ "$(grep -c 'smoke-warmup-' "$TMP/curl-calls")" = 3 ] || fail cold-lookup "cần đúng 3 request warm-up"
echo "ok cold-lookup"

# warm-up-warning: one fail-open before the first 404 passes smoke with a ::warning:: naming the count.
start_server "$WARM_PORT" "$TMP/warm-headers" 200 "<h1>Không tìm thấy trang</h1>" '^/products/smoke-warmup-.*-1$'
run BASE_URL="http://127.0.0.1:$WARM_PORT" -- bash scripts/smoke.sh
[ "$CODE" = 0 ] || fail warm-up-warning "thoát $CODE, cần 0"
grep -qF '::warning::smoke: 1 slug lạ fail-open' "$TMP/out" || fail warm-up-warning "thiếu ::warning:: có số lần fail-open"
echo "ok warm-up-warning"

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

# product-fail-open-warn (NS-79): every well-formed unknown product slug answers 200 (the proxy's lookup fails open
# from a far edge). SMOKE_PRODUCT_FAIL_OPEN=warn turns each of them — warm-up, fixed slug, fresh slug, RSC, .rsc,
# segment, product OG image — into a ::warning:: with the time taken and smoke passes; without the flag it fails.
start_server "$FAIL_OPEN_PORT" "$TMP/fail-open-headers" 200 "<h1>Không tìm thấy trang</h1>" '^/products/(smoke-warmup-|khong-ton-tai)'
run BASE_URL="http://127.0.0.1:$FAIL_OPEN_PORT" SMOKE_PRODUCT_FAIL_OPEN=warn -- bash scripts/smoke.sh
[ "$CODE" = 0 ] || fail product-fail-open-warn "có cờ: thoát $CODE, cần 0"
grep -qE '^::warning::smoke: 3 slug lạ warm-up đều trả 200, lần cuối sau [0-9]+ ms: lookup DB của proxy fail-open' "$TMP/out" ||
  fail product-fail-open-warn "thiếu ::warning:: của warm-up"
for label in 'slug cố định của US-05' 'slug mới' 'request RSC' 'hậu tố .rsc' 'segment prefetch dạng đường dẫn' \
  'segment prefetch dạng đường dẫn, không header' 'ảnh OG: slug sản phẩm lạ' 'ảnh OG: slug sản phẩm lạ, không hậu tố băm'; do
  grep -qE "^::warning::smoke: GET /products/[^ ]+ \\($label\\) trả 200 sau [0-9]+ ms" "$TMP/out" ||
    fail product-fail-open-warn "thiếu ::warning:: có thời gian cho \"$label\""
done
[ "$(grep -c '^::warning::smoke: .*SMOKE_PRODUCT_FAIL_OPEN=warn' "$TMP/out")" = 9 ] || fail product-fail-open-warn "cần đúng 9 cảnh báo fail-open"
grep -qF '(%2D) → 404' "$TMP/out" || fail product-fail-open-warn "ca %2D không còn được kiểm 404"
grep -qF '(chữ hoa) → 404' "$TMP/out" || fail product-fail-open-warn "ca chữ hoa không còn được kiểm 404"
run BASE_URL="http://127.0.0.1:$FAIL_OPEN_PORT" -- bash scripts/smoke.sh
[ "$CODE" = 1 ] || fail product-fail-open-warn "không cờ: thoát $CODE, cần 1"
grep -qF 'hơn 2 slug fail-open' "$TMP/out" || fail product-fail-open-warn "không cờ: thiếu lỗi warm-up"
! grep -q 'SMOKE_PRODUCT_FAIL_OPEN=warn' "$TMP/out" || fail product-fail-open-warn "không cờ mà vẫn cảnh báo"
echo "ok product-fail-open-warn"

# product-fail-open-warn-single: warm-up fine, only one later product case fails open → warning with the flag, failure
# without (the existing soft-404 case with the flag added).
run BASE_URL="http://127.0.0.1:$SOFT_RSC_PORT" SMOKE_PRODUCT_FAIL_OPEN=warn -- bash scripts/smoke.sh
[ "$CODE" = 0 ] || fail product-fail-open-warn-single "thoát $CODE, cần 0"
grep -qE '^::warning::smoke: GET /products/khong-ton-tai-suffix-[0-9-]+\.rsc \(hậu tố \.rsc\) trả 200 sau [0-9]+ ms' "$TMP/out" ||
  fail product-fail-open-warn-single "thiếu ::warning:: cho hậu tố .rsc"
echo "ok product-fail-open-warn-single"

# fail-open-flag-scope: the flag never covers the cases that do not reach the database. A 200 for a malformed product
# slug (%2D, upper case), an unknown post or an unknown post's OG image still fails smoke.
start_server "$MALFORMED_PORT" "$TMP/malformed-headers" 200 "<h1>Không tìm thấy trang</h1>" '^/products/(KHONG-|khong%2D)'
run BASE_URL="http://127.0.0.1:$MALFORMED_PORT" SMOKE_PRODUCT_FAIL_OPEN=warn -- bash scripts/smoke.sh
[ "$CODE" = 1 ] || fail fail-open-flag-scope "slug sai dạng: thoát $CODE, cần 1"
grep -qF '(%2D) trả 200 ngay lần đầu' "$TMP/out" || fail fail-open-flag-scope "thông báo không nêu %2D"
grep -qF '(chữ hoa) trả 200 ngay lần đầu' "$TMP/out" || fail fail-open-flag-scope "thông báo không nêu chữ hoa"
run BASE_URL="http://127.0.0.1:$SOFT_BLOG_PORT" SMOKE_PRODUCT_FAIL_OPEN=warn -- bash scripts/smoke.sh
[ "$CODE" = 1 ] || fail fail-open-flag-scope "slug bài: thoát $CODE, cần 1"
grep -qF '(bài: slug mới) trả 200 ngay lần đầu' "$TMP/out" || fail fail-open-flag-scope "thông báo không nêu slug bài"
run BASE_URL="http://127.0.0.1:$SOFT_OG_PORT" SMOKE_PRODUCT_FAIL_OPEN=warn -- bash scripts/smoke.sh
[ "$CODE" = 1 ] || fail fail-open-flag-scope "ảnh OG của bài: thoát $CODE, cần 1"
grep -qF '(ảnh OG: slug bài lạ) trả 200 ngay lần đầu' "$TMP/out" || fail fail-open-flag-scope "thông báo không nêu ảnh OG của bài"
! grep -q '^::warning::' "$TMP/out" || fail fail-open-flag-scope "ảnh OG của bài: có ::warning:: dù không ca sản phẩm nào fail-open"
echo "ok fail-open-flag-scope"

# bad-fail-open-flag: SMOKE_PRODUCT_FAIL_OPEN is warn or empty; refused before any request.
run SMOKE_PRODUCT_FAIL_OPEN=yes -- bash scripts/smoke.sh
[ "$CODE" = 1 ] || fail bad-fail-open-flag "thoát $CODE, cần 1"
grep -qF 'SMOKE_PRODUCT_FAIL_OPEN không hợp lệ' "$TMP/out" || fail bad-fail-open-flag "thông báo không nêu biến"
[ ! -s "$TMP/curl-calls" ] || fail bad-fail-open-flag "curl đã được gọi"
echo "ok bad-fail-open-flag"

# proxy-timing (NS-79): the time of /robots.txt and of an unknown blog slug (through the proxy, no database) is printed
# next to each other; information only.
run BASE_URL="http://127.0.0.1:$PORT" -- bash scripts/smoke.sh
[ "$CODE" = 0 ] || fail proxy-timing "thoát $CODE, cần 0"
grep -qE '^smoke: thời gian: GET /robots.txt [0-9]+ ms; GET /blog/smoke-proxy-[0-9-]+ \(qua proxy, không chạm DB\) → 404, [0-9]+ ms$' "$TMP/out" ||
  fail proxy-timing "thiếu dòng thời gian của /robots.txt và slug bài lạ"
grep -qE '^smoke: GET /products/khong-ton-tai \(slug cố định của US-05\) → 404, [0-9]+ ms$' "$TMP/out" || fail proxy-timing "dòng 404 thiếu thời gian"
echo "ok proxy-timing"
