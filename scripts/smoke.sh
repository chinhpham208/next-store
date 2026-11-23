#!/usr/bin/env bash
# Smoke test: trang chủ trả 200 và có SMOKE_TEXT; một đường dẫn không tồn tại trả 404 với trang tiếng Việt;
# một trang chi tiết sản phẩm trả 200 và có tên sản phẩm; /products trả 200 và có lưới sản phẩm, kể cả với
# tham số không hợp lệ; nút "Thêm vào giỏ" dùng được ở sản phẩm còn hàng, vô hiệu ở sản phẩm hết hàng, trang chủ không
# Set-Cookie; /cart không cookie trả 200, giỏ trống, noindex; /blog và một bài blog trả 200 và có nội dung; slug sản phẩm, slug bài và ảnh OG của slug
# lạ trả 404 ngay lần đầu, bài và sản phẩm có thật vẫn 200 ở mọi dạng vận chuyển; /sitemap.xml và /robots.txt trả 200, cùng một origin tuyệt đối, robots.txt chặn hay cho crawl đúng môi trường;
# trang chủ có og:site_name; og:image của trang chủ, một sản phẩm và một bài blog tải được, là PNG.
#
#   npm run smoke                                   # chạy `next start` từ bản build hiện có (.next/), kiểm rồi tắt
#   BASE_URL=https://<deploy>.vercel.app npm run smoke   # kiểm một URL đã deploy
#
# Biến tuỳ chọn:
#   BASE_URL                         https://<host>[:cổng], hoặc http://localhost|127.0.0.1[:cổng]; không có đường dẫn
#   SMOKE_TEXT                       chuỗi phải có trong HTML trang chủ (mặc định: tên một sản phẩm nổi bật trong
#                                    src/db/seed-data.ts, chứng minh trang đọc được dữ liệu, không chỉ render khung)
#   SMOKE_PORT                       cổng cho `next start` khi không có BASE_URL (mặc định: 3100); cổng phải trống
#   SMOKE_ROBOTS                     disallow = robots.txt phải `Disallow: /` (Preview / Dev; workflow e2e-preview đặt),
#                                    allow = phải `Allow: /` (Production). Bỏ trống: chấp nhận một trong hai, in ra
#                                    (next start: build ngoài Vercel là disallow). Header X-Robots-Tag luôn chỉ được in
#   SMOKE_PRODUCT_FAIL_OPEN          warn = slug sản phẩm lạ đúng dạng (cần lookup DB trong proxy) trả 200 thì chỉ in
#                                    ::warning:: kèm thời gian, không fail; áp cho warm-up và mọi dạng (slug mới, RSC,
#                                    .rsc, segment, ảnh OG sản phẩm). Chỉ workflow Production E2E đặt (NS-79: proxy chạy
#                                    ở edge gần người gọi, xa Neon, ADR-0009). Slug sai dạng, blog, ảnh OG của bài không
#                                    chạm DB nên vẫn phải 404. Bỏ trống (mặc định, Preview / CI): fail-open là lỗi
#   VERCEL_AUTOMATION_BYPASS_SECRET  có thì gửi header x-vercel-protection-bypass (vượt Deployment Protection),
#                                    chỉ khi BASE_URL là https://
set -euo pipefail
cd "$(dirname "$0")/.."

SMOKE_TEXT=${SMOKE_TEXT:-Áo thun 404 Not Found}
SMOKE_PORT=${SMOKE_PORT:-3100}
# At most this many fresh unknown slugs may fail open before the first 404 (audit PR #26 L3; ADR-0009).
MAX_WARMUP_FAIL_OPEN=2
SERVER_PID=
SERVER_GROUP=
# Whether the bypass header is sent. Only this flag is read outside xtrace_off, so `bash -x` never prints BYPASS.
SEND_BYPASS=

fail() { echo "smoke: LỖI: $*" >&2; exit 1; }

# Under `bash -x`, every line that reads the secret would be printed; these turn xtrace off around them.
# The redirect hides the trace of `set +x` itself.
xtrace_off() { XTRACE_WAS=; case $- in *x*) XTRACE_WAS=1 ;; esac; { set +x; } 2>/dev/null; }
xtrace_restore() { if [ -n "$XTRACE_WAS" ]; then set -x; fi; }

# -g: no URL globbing; --proto / --proto-redir: curl may only speak the scheme BASE_URL was checked against.
curl_safe() { curl -g --proto "=$SCHEME" --proto-redir "=$SCHEME" "$@"; }

# The bypass secret goes to curl through a config on stdin, never on the command line, so it cannot show up in
# `ps` output or in a CI log that echoes commands. It was validated to [A-Za-z0-9_-], so it cannot break out of
# the quoted config value.
# <header> is a fixed string from this script (e.g. `rsc: 1`), checked so it cannot break out of the config value.
# The total time of the request, in seconds as curl prints it, goes to $TMP/last-time (read with last_time_ms).
# <method> (default GET) is a fixed word from this script; any other method sends the fixed body `smoke=1` and never
# the `next-action` header, so it is never a Server Action (NS-103).
fetch() { # fetch <url> <body-file> [header] [response-headers-file] [method] → in mã HTTP
  local url=$1 body=$2 header=${3:-} dump=${4:-/dev/null} method=${5:-GET} code=0 out request=()
  if [ -n "$header" ] && ! [[ $header =~ ^[A-Za-z0-9-]+:\ [A-Za-z0-9./-]+$ ]]; then fail "header không hợp lệ"; fi
  case $method in GET) ;; POST | PUT | PATCH | DELETE) request=(-X "$method" --data 'smoke=1') ;; *) fail "method không hợp lệ" ;; esac
  xtrace_off
  {
    if [ -n "$SEND_BYPASS" ]; then printf 'header = "x-vercel-protection-bypass: %s"\n' "$BYPASS"; fi
    if [ -n "$header" ]; then printf 'header = "%s"\n' "$header"; fi
  } | curl_safe -sS -D "$dump" -o "$body" -w '%{http_code} %{time_total}' --max-time 20 --config - "${request[@]}" --url "$url" > "$TMP/last-write" || code=$?
  xtrace_restore
  out=$(cat "$TMP/last-write")
  printf '%s\n' "${out#* }" > "$TMP/last-time"
  printf '%s' "${out%% *}"
  return "$code"
}
last_time_ms() { LC_ALL=C awk '{ printf "%d ms", $1 * 1000 }' "$TMP/last-time"; }

stop_server() {
  [ -n "$SERVER_PID" ] || return 0
  # With setsid the server leads its own process group; kill the whole group so no worker keeps the port.
  if [ -n "$SERVER_GROUP" ]; then kill -- "-$SERVER_PID" 2>/dev/null || true; fi
  kill "$SERVER_PID" 2>/dev/null || true
  wait "$SERVER_PID" 2>/dev/null || true
}

# A stale `next start` still holding the port would make the new server exit and smoke test the old build (K13).
port_busy() {
  (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null && return 0
  (exec 3<>"/dev/tcp/::1/$1") 2>/dev/null && return 0
  return 1
}

start_server() {
  port_busy "$SMOKE_PORT" && fail "cổng $SMOKE_PORT đang bận: đã có tiến trình lắng nghe. Tắt nó hoặc đặt SMOKE_PORT khác."
  [ -d .next ] || fail "chưa có bản build (.next/). Chạy npm run build trước."
  echo "smoke: next start -p $SMOKE_PORT"
  if command -v setsid >/dev/null; then
    setsid node_modules/.bin/next start -p "$SMOKE_PORT" > "$TMP/server.log" 2>&1 &
    SERVER_GROUP=1
  else
    # macOS has no setsid; next start runs as one process, so killing its PID frees the port.
    node_modules/.bin/next start -p "$SMOKE_PORT" > "$TMP/server.log" 2>&1 &
  fi
  SERVER_PID=$!
  local i
  for i in $(seq 1 60); do
    if curl_safe -s -o /dev/null --max-time 2 --url "http://127.0.0.1:$SMOKE_PORT/"; then return 0; fi
    kill -0 "$SERVER_PID" 2>/dev/null || { tail -n 20 "$TMP/server.log" >&2; fail "next start đã thoát"; }
    sleep 1
  done
  tail -n 20 "$TMP/server.log" >&2
  fail "next start không sẵn sàng sau 60 giây"
}

# Messages name the variable only: BASE_URL may carry credentials, and the secret must never be echoed.
validate_input() {
  local https_re='^https://[A-Za-z0-9.-]+(:[0-9]{1,5})?/?$'
  local http_re='^http://(localhost|127\.0\.0\.1)(:[0-9]{1,5})?/?$'
  [[ $SMOKE_PORT =~ ^[0-9]{1,5}$ ]] && [ "$((10#$SMOKE_PORT))" -ge 1 ] && [ "$((10#$SMOKE_PORT))" -le 65535 ] ||
    fail "SMOKE_PORT không hợp lệ: cần số nguyên 1–65535."
  case ${SMOKE_ROBOTS:-} in ''|allow|disallow) ;; *) fail "SMOKE_ROBOTS không hợp lệ: cần allow, disallow hoặc bỏ trống." ;; esac
  case ${SMOKE_PRODUCT_FAIL_OPEN:-} in ''|warn) ;; *) fail "SMOKE_PRODUCT_FAIL_OPEN không hợp lệ: cần warn hoặc bỏ trống." ;; esac
  SCHEME=http
  if [ -n "${BASE_URL:-}" ]; then
    if [[ $BASE_URL =~ $https_re ]]; then SCHEME=https
    elif [[ $BASE_URL =~ $http_re ]]; then SCHEME=http
    else fail "BASE_URL không hợp lệ: cần https://<host>[:cổng], hoặc http://localhost|127.0.0.1[:cổng], không có đường dẫn."
    fi
  fi
  local ok=1 given=
  xtrace_off
  BYPASS=${VERCEL_AUTOMATION_BYPASS_SECRET:-}
  if [ -n "$BYPASS" ]; then given=1; fi
  if [ -n "$BYPASS" ] && ! [[ $BYPASS =~ ^[A-Za-z0-9_-]{16,128}$ ]]; then ok=; fi
  xtrace_restore
  [ -n "$ok" ] || fail "VERCEL_AUTOMATION_BYPASS_SECRET không hợp lệ: cần 16–128 ký tự A-Z a-z 0-9 _ -."
  [ -n "$given" ] || return 0
  # The header is never sent over plain http: anyone on the path could read it.
  if [ "$SCHEME" = https ]; then SEND_BYPASS=1; return 0; fi
  echo "smoke: BASE_URL là http, không gửi header bypass."
}

TMP=$(mktemp -d)
trap 'stop_server; rm -rf "$TMP"' EXIT

validate_input
RUN_ID="$(date +%s)-$RANDOM"

if [ -n "${BASE_URL:-}" ]; then
  BASE=${BASE_URL%/}
else
  start_server
  BASE="http://127.0.0.1:$SMOKE_PORT"
fi
echo "smoke: $BASE"

status=$(fetch "$BASE/" "$TMP/home.html" '' "$TMP/home.headers") || fail "không kết nối được $BASE/"
# Protection answers 401 (login page) or redirects to vercel.com; say so instead of a bare "expected 200".
if [ "$status" = 401 ] || [ "$status" = 403 ] || { [ "$status" != 200 ] && grep -q 'vercel\.com/\(sso\|login\)' "$TMP/home.html"; }; then
  [ -n "$SEND_BYPASS" ] && fail "GET / trả $status: Vercel Deployment Protection từ chối bypass secret."
  fail "GET / trả $status: Vercel Deployment Protection chặn. Đặt VERCEL_AUTOMATION_BYPASS_SECRET rồi chạy lại."
fi
[ "$status" = 200 ] || fail "GET / trả $status, cần 200"
grep -qF -- "$SMOKE_TEXT" "$TMP/home.html" || fail "HTML trang chủ không có \"$SMOKE_TEXT\""
echo "smoke: GET / → 200, có \"$SMOKE_TEXT\""

# x-vercel-id is <edge POP>::[<function region>::]<request id>. The edge POP is the one nearest the client (iad1 from
# GitHub's US runners); a function region only appears when a function rendered the response, which a proxy rewrite to
# the prerendered not-found page does not. Logged as a hint for ADR-0009, not asserted. Third-party text: reduced to
# [a-z0-9:-] before it reaches the log.
print_vercel_region() { # print_vercel_region <response-headers-file>
  local id
  id=$(tr -d '\r' < "$1" | sed -n 's/^[Xx]-[Vv]ercel-[Ii]d: *//p' | head -n 1 | tr -cd 'a-z0-9:-')
  [ -n "$id" ] || return 0
  echo "smoke: x-vercel-id (edge[::function]): ${id%::*}"
}
# Owner decision 15 (plan M3) relied on Vercel's `X-Robots-Tag: noindex` on Preview / Dev; NS-65 found Dev without
# it, so robots.txt now says Disallow: / outside production (checked below). The header is still printed, right after
# /, so every run records what Vercel sends. Third-party text: reduced to a safe set before it is printed.
report_robots_tag() { # report_robots_tag <path> <response-headers-file>
  local value
  value=$(tr -d '\r' < "$2" | sed -n 's/^[Xx]-[Rr][Oo][Bb][Oo][Tt][Ss]-[Tt][Aa][Gg]: *//p' | head -n 1 | tr -cd 'A-Za-z0-9 ,:_-')
  echo "smoke: GET $1 → x-robots-tag: ${value:-<không có>}"
}
report_robots_tag / "$TMP/home.headers"
status=$(fetch "$BASE/robots.txt" "$TMP/robots.txt" '' "$TMP/robots.headers") || fail "không kết nối được $BASE/robots.txt"
report_robots_tag /robots.txt "$TMP/robots.headers"
ROBOTS_TIME=$(last_time_ms)
# NS-79: where the proxy runs. An unknown blog slug goes through the proxy but never the database (static registry,
# ADR-0012), so its time next to /robots.txt (no proxy) shows the cost of the proxy hop alone; x-vercel-id names the
# edge POP. Information only: the 404 itself is checked with the other blog slugs below.
PROXY_PROBE=/blog/smoke-proxy-$RUN_ID
if status_probe=$(fetch "$BASE$PROXY_PROBE" "$TMP/proxy-probe" '' "$TMP/proxy-probe.headers"); then
  echo "smoke: thời gian: GET /robots.txt $ROBOTS_TIME; GET $PROXY_PROBE (qua proxy, không chạm DB) → $status_probe, $(last_time_ms)"
  print_vercel_region "$TMP/proxy-probe.headers"
else
  echo "smoke: thời gian: GET /robots.txt $ROBOTS_TIME; GET $PROXY_PROBE (qua proxy, không chạm DB): không kết nối được"
fi
status_sitemap=$(fetch "$BASE/sitemap.xml" "$TMP/sitemap.xml" '' "$TMP/sitemap.headers") ||
  fail "không kết nối được $BASE/sitemap.xml"
report_robots_tag /sitemap.xml "$TMP/sitemap.headers"

# US-11 / NFR SEO: every <loc> is absolute on one origin; on a deployment that origin is https and not localhost
# (no metadataBase / SITE_URL read at build → localhost, K6, K12). robots.txt points at the sitemap on that origin.
[ "$status" = 200 ] || fail "GET /robots.txt trả $status, cần 200"
[ "$status_sitemap" = 200 ] || fail "GET /sitemap.xml trả $status_sitemap, cần 200"
for SITEMAP_LOC in /products/ao-404-not-found /blog/chao-mung-den-next-store; do
  grep -qF -- "$SITEMAP_LOC</loc>" "$TMP/sitemap.xml" || fail "/sitemap.xml không có $SITEMAP_LOC</loc>"
done
SITEMAP_ORIGINS=$(grep -o '<loc>[^<]*</loc>' "$TMP/sitemap.xml" | sed -E 's#^<loc>([a-z]+://[^/<]+).*#\1#' | sort -u)
[ "$(printf '%s\n' "$SITEMAP_ORIGINS" | grep -c .)" = 1 ] || fail "/sitemap.xml có <loc> trên nhiều origin hoặc không có <loc> nào"
[[ $SITEMAP_ORIGINS =~ ^https?://[A-Za-z0-9.-]+(:[0-9]{1,5})?$ ]] || fail "/sitemap.xml có <loc> không phải URL tuyệt đối"
if [ "$SCHEME" = https ] && [[ ! $SITEMAP_ORIGINS =~ ^https:// || $SITEMAP_ORIGINS =~ ^https?://(localhost|127\.0\.0\.1)(:|$) ]]; then
  fail "/sitemap.xml dùng origin $SITEMAP_ORIGINS trên deployment: cần https và không phải localhost"
fi
echo "smoke: GET /sitemap.xml → 200, mọi <loc> trên $SITEMAP_ORIGINS"
ROBOTS_POLICY=
if tr -d '\r' < "$TMP/robots.txt" | grep -qx 'Allow: /'; then ROBOTS_POLICY=allow; fi
if tr -d '\r' < "$TMP/robots.txt" | grep -qx 'Disallow: /'; then
  if [ -n "$ROBOTS_POLICY" ]; then ROBOTS_POLICY=both; else ROBOTS_POLICY=disallow; fi
fi
case $ROBOTS_POLICY in
  allow|disallow) ;;
  both) fail "/robots.txt có cả \"Allow: /\" lẫn \"Disallow: /\"" ;;
  *) fail "/robots.txt không có \"Allow: /\" hay \"Disallow: /\"" ;;
esac
if [ -n "${SMOKE_ROBOTS:-}" ] && [ "$ROBOTS_POLICY" != "$SMOKE_ROBOTS" ]; then
  fail "/robots.txt là $ROBOTS_POLICY, cần $SMOKE_ROBOTS (SMOKE_ROBOTS; ngoài production phải Disallow: /, quyết định 15 plan M3)"
fi
tr -d '\r' < "$TMP/robots.txt" | grep -qxF "Sitemap: $SITEMAP_ORIGINS/sitemap.xml" ||
  fail "/robots.txt không có dòng \"Sitemap: $SITEMAP_ORIGINS/sitemap.xml\""
echo "smoke: GET /robots.txt → 200, $ROBOTS_POLICY /, Sitemap: $SITEMAP_ORIGINS/sitemap.xml"
grep -qF -- 'property="og:site_name" content="next-store"' "$TMP/home.html" || fail "HTML trang chủ không có og:site_name"
echo "smoke: trang chủ có og:site_name"

status=$(fetch "$BASE/khong-ton-tai" "$TMP/404.html") || fail "không kết nối được $BASE/khong-ton-tai"
[ "$status" = 404 ] || fail "GET /khong-ton-tai trả $status, cần 404"
# NS-38: the 404 must be the app's Vietnamese page, not Next.js's built-in English fallback.
grep -qF 'Không tìm thấy trang' "$TMP/404.html" || fail "HTML 404 không có \"Không tìm thấy trang\""
if grep -qF 'This page could not be found' "$TMP/404.html"; then fail "HTML 404 còn trang mặc định tiếng Anh của Next.js"; fi
echo "smoke: GET /khong-ton-tai → 404, trang tiếng Việt"

# US-04: a prerendered detail page reads its product (the h1 is the name), not just the shell and skeleton.
DETAIL_PATH=/products/ao-404-not-found
DETAIL_TEXT='Áo thun 404 Not Found'
status=$(fetch "$BASE$DETAIL_PATH" "$TMP/detail.html") || fail "không kết nối được $BASE$DETAIL_PATH"
[ "$status" = 200 ] || fail "GET $DETAIL_PATH trả $status, cần 200"
grep -qF -- "$DETAIL_TEXT" "$TMP/detail.html" || fail "HTML $DETAIL_PATH không có \"$DETAIL_TEXT\""
echo "smoke: GET $DETAIL_PATH → 200, có \"$DETAIL_TEXT\""

# US-06 / US-08 (M4 Task 8): an in-stock product has an enabled "Thêm vào giỏ" submit button in the prerendered page,
# a sold-out one only a disabled button. The home page sets no cookie: the cart cookie is written by the action alone.
add_button() { grep -o '<button[^>]*>Thêm vào giỏ</button>' "$1" | head -n 1; }
BUTTON=$(add_button "$TMP/detail.html")
[ -n "$BUTTON" ] || fail "HTML $DETAIL_PATH không có nút \"Thêm vào giỏ\""
case $BUTTON in *'disabled=""'*) fail "nút \"Thêm vào giỏ\" của $DETAIL_PATH bị vô hiệu" ;; esac
SOLD_OUT_PATH=/products/ao-tabs-vs-spaces
status=$(fetch "$BASE$SOLD_OUT_PATH" "$TMP/sold-out.html") || fail "không kết nối được $BASE$SOLD_OUT_PATH"
[ "$status" = 200 ] || fail "GET $SOLD_OUT_PATH trả $status, cần 200"
case $(add_button "$TMP/sold-out.html") in *'disabled=""'*) ;; *) fail "HTML $SOLD_OUT_PATH không có nút \"Thêm vào giỏ\" bị vô hiệu" ;; esac
if tr -d '\r' < "$TMP/home.headers" | grep -qi '^set-cookie:'; then fail "GET / trả Set-Cookie"; fi
echo "smoke: nút \"Thêm vào giỏ\": $DETAIL_PATH dùng được, $SOLD_OUT_PATH vô hiệu; GET / không có Set-Cookie"

# US-07 (M4 Task 9): /cart without a cookie is the empty cart, read behind Suspense (so the text proves the section
# rendered, not just the shell), and never indexed. No cookie is sent, so the request writes nothing.
status=$(fetch "$BASE/cart" "$TMP/cart.html" '' "$TMP/cart.headers") || fail "không kết nối được $BASE/cart"
[ "$status" = 200 ] || fail "GET /cart trả $status, cần 200"
grep -qF -- 'Giỏ hàng trống.' "$TMP/cart.html" || fail "HTML /cart (không cookie) không có \"Giỏ hàng trống.\""
if ! grep -qE '<meta name="robots" content="[^"]*noindex' "$TMP/cart.html" &&
  ! tr -d '\r' < "$TMP/cart.headers" | grep -qiE '^x-robots-tag:.*noindex'; then
  fail "/cart không có noindex (meta robots hay X-Robots-Tag)"
fi
if tr -d '\r' < "$TMP/cart.headers" | grep -qi '^set-cookie:'; then fail "GET /cart (không cookie) trả Set-Cookie"; fi
echo "smoke: GET /cart → 200, giỏ trống, noindex, không Set-Cookie"

# US-02 / US-03: the listing reads the catalogue (the labelled grid is inside the Suspense boundary, so it is
# only in the HTML when the data was read), and invalid parameters fall back to defaults instead of an error.
LISTING_TEXT='aria-label="Danh sách sản phẩm"'
for LISTING_PATH in /products '/products?page=abc&sort=xyz'; do
  status=$(fetch "$BASE$LISTING_PATH" "$TMP/listing.html") || fail "không kết nối được $BASE$LISTING_PATH"
  [ "$status" = 200 ] || fail "GET $LISTING_PATH trả $status, cần 200"
  grep -qF -- "$LISTING_TEXT" "$TMP/listing.html" || fail "HTML $LISTING_PATH không có lưới \"Danh sách sản phẩm\""
  if grep -qF -- 'Đã có lỗi xảy ra' "$TMP/listing.html"; then fail "HTML $LISTING_PATH là trang lỗi"; fi
  echo "smoke: GET $LISTING_PATH → 200, có lưới sản phẩm"
done

# US-10: /blog lists the posts from the registry and a prerendered post renders its MDX under its h1. Unknown blog
# slugs are checked with the other 404s below.
BLOG_TEXT='Chào mừng đến next-store'
status=$(fetch "$BASE/blog" "$TMP/blog.html") || fail "không kết nối được $BASE/blog"
[ "$status" = 200 ] || fail "GET /blog trả $status, cần 200"
grep -qF -- "$BLOG_TEXT" "$TMP/blog.html" || fail "HTML /blog không có \"$BLOG_TEXT\""
echo "smoke: GET /blog → 200, có \"$BLOG_TEXT\""
POST_PATH=/blog/chao-mung-den-next-store
status=$(fetch "$BASE$POST_PATH" "$TMP/post.html") || fail "không kết nối được $BASE$POST_PATH"
[ "$status" = 200 ] || fail "GET $POST_PATH trả $status, cần 200"
grep -qF -- '<h1' "$TMP/post.html" || fail "HTML $POST_PATH không có <h1"
grep -qF -- '<article' "$TMP/post.html" || fail "HTML $POST_PATH không có <article"
echo "smoke: GET $POST_PATH → 200, có <h1 và <article"

# US-11: each page's og:image loads as a PNG. Only the path and query of the tag are fetched, on BASE: the host in the
# tag is the site URL read at build time (localhost:3000 under next start, K6). A route that built but reads uncached
# IO answers 500 here (K8). The value comes from the page, so it is reduced to a URL path before it reaches curl.
# The path is kept in OG_PATH: the 404 checks below swap its slug for an unknown one.
OG_PATH=
expect_og_image() { # expect_og_image <page path> <html file>
  local page=$1 html=$2 url path status type
  url=$(grep -o '<meta property="og:image" content="[^"]*"' "$html" | head -n 1 | sed -E 's/.*content="([^"]*)"/\1/; s/&amp;/\&/g')
  [ -n "$url" ] || fail "HTML $page không có og:image"
  path=$(printf '%s' "$url" | sed -E 's#^https?://[^/]+##')
  [[ $path =~ ^/[A-Za-z0-9/._?=-]*$ ]] || fail "og:image của $page không phải đường dẫn hợp lệ"
  status=$(fetch "$BASE$path" "$TMP/og.png" '' "$TMP/og.headers") || fail "không kết nối được $BASE$path"
  [ "$status" = 200 ] || fail "GET $path (og:image của $page) trả $status, cần 200"
  type=$(tr -d '\r' < "$TMP/og.headers" | sed -n 's/^[Cc]ontent-[Tt]ype: *//p' | tail -n 1)
  [ "$type" = image/png ] || fail "GET $path (og:image của $page) có content-type \"$type\", cần image/png"
  echo "smoke: og:image của $page → GET $path → 200, image/png"
  OG_PATH=$path
}
expect_og_image / "$TMP/home.html"
expect_og_image "$DETAIL_PATH" "$TMP/detail.html"
DETAIL_OG_PATH=$OG_PATH
expect_og_image "$POST_PATH" "$TMP/post.html"
POST_OG_PATH=$OG_PATH
[[ $DETAIL_OG_PATH == "$DETAIL_PATH/opengraph-image"* ]] || fail "og:image của $DETAIL_PATH không nằm dưới $DETAIL_PATH/opengraph-image"
[[ $POST_OG_PATH == "$POST_PATH/opengraph-image"* ]] || fail "og:image của $POST_PATH không nằm dưới $POST_PATH/opengraph-image"

# US-05 (ADR-0009): src/proxy.ts answers an unknown product slug with a real 404 on the very first request, before
# render; a page-level notFound() would send a 200 shell first (K3). Fresh slugs each run, so no earlier request
# can have left a cached 404 behind, plus the fixed slug from the acceptance criteria. Every transport form of the
# URL (RSC request, .rsc suffix) and every non-canonical spelling (%2D, upper case) must be a 404 too.
# Every case runs before smoke fails: which variants pass tells whether the proxy ran at all (malformed slugs never
# reach the database) or only its database lookup failed open.
# A well-formed product slug is the one case that needs the database lookup; with SMOKE_PRODUCT_FAIL_OPEN=warn its
# fail-open (200) is a CI warning with the time taken, not a failure (NS-79). Every other case never reaches the
# database, so a 200 there means the proxy did not run: always a failure.
NOT_FOUND_FAILED=
PRODUCT_FAIL_OPEN_COUNT=0
expect_404() { check_404 '' "$@"; } # expect_404 <path> <label> [header] [method]
expect_product_404() { check_404 product "$@"; } # expect_product_404 <path> <label> [header] [method]: slug đi qua lookup DB
product_fail_open_warned() { # product_fail_open_warned <status> <message>: 0 = cảnh báo thay cho lỗi
  [ "$1" = 200 ] && [ "${SMOKE_PRODUCT_FAIL_OPEN:-}" = warn ] || return 1
  # A workflow command on purpose: visible on the run summary, not only in the log.
  echo "::warning::smoke: $2 sau $(last_time_ms): lookup DB của proxy fail-open (SMOKE_PRODUCT_FAIL_OPEN=warn, NS-79)"
  PRODUCT_FAIL_OPEN_COUNT=$((PRODUCT_FAIL_OPEN_COUNT + 1))
}
check_404() { # check_404 <kind> <path> <label> [header] [method]
  local kind=$1 path=$2 label=$3 header=${4:-} method=${5:-GET} status
  status=$(fetch "$BASE$path" "$TMP/not-found" "$header" /dev/null "$method") || fail "không kết nối được $BASE$path"
  if [ "$kind" = product ] && product_fail_open_warned "$status" "$method $path ($label) trả 200"; then return 0; fi
  if [ "$status" != 404 ]; then
    echo "smoke: LỖI: $method $path ($label) trả $status ngay lần đầu, cần 404" >&2
    NOT_FOUND_FAILED=1
    return 0
  fi
  # An image URL is not a page: its 404 is either the proxy's rewrite to the not-found page or, when the product lookup
  # failed open (NS-79), the image route's own empty 404. Both are a 404 for the image, so only pages need the text.
  if [ -z "$header" ] && [ "${path%.rsc}" = "$path" ] && [[ $path != */opengraph-image* ]] &&
    ! grep -qF 'Không tìm thấy trang' "$TMP/not-found"; then
    echo "smoke: LỖI: HTML $path ($label) không có \"Không tìm thấy trang\"" >&2
    NOT_FOUND_FAILED=1
    return 0
  fi
  echo "smoke: $method $path ($label) → 404, $(last_time_ms)"
}
# A cold database connection (Neon waking up, new function instance) can outlast the proxy's 400 ms bound; the
# proxy then fails open and that slug answers 200 (ADR-0009). Measured on the first preview of NS-49: the first two
# lookups failed open, later ones 404'd. On Vercel the proxy runs at the edge nearest the caller, not in sin1 beside
# Neon (NS-79, ADR-0009), so from a far region every lookup can outlast the bound. So first send fresh slugs — each one
# a first hit — until one gets its 404: more than MAX_WARMUP_FAIL_OPEN fail-opens fail smoke (with
# SMOKE_PRODUCT_FAIL_OPEN=warn: a warning), any fail-open is a CI warning; then every case below must 404 on the first
# hit, or, with the flag, at least not answer anything but 404 or a warned 200.
warm_up_product_lookup() {
  local i status
  for i in $(seq 1 "$((MAX_WARMUP_FAIL_OPEN + 1))"); do
    status=$(fetch "$BASE/products/smoke-warmup-$RUN_ID-$i" "$TMP/warmup" '' "$TMP/warmup.headers") ||
      fail "không kết nối được $BASE/products/smoke-warmup-…"
    print_vercel_region "$TMP/warmup.headers"
    echo "smoke: warm-up $i → $status, $(last_time_ms)"
    if [ "$status" = 404 ]; then
      echo "smoke: proxy kiểm slug được từ request thứ $i ($((i - 1)) slug lạ fail-open trước đó)"
      # A workflow command on purpose: a fail-open within the limit is visible on the run summary, not only in the log.
      if [ "$i" -gt 1 ]; then echo "::warning::smoke: $((i - 1)) slug lạ fail-open (trả 200) trước khi proxy trả 404"; fi
      return 0
    fi
    sleep 1
  done
  if product_fail_open_warned "$status" "$((MAX_WARMUP_FAIL_OPEN + 1)) slug lạ warm-up đều trả 200, lần cuối"; then return 0; fi
  fail "proxy chưa trả 404 cho slug lạ sau $((MAX_WARMUP_FAIL_OPEN + 1)) request: hơn $MAX_WARMUP_FAIL_OPEN slug fail-open (lookup DB lỗi hoặc quá 400 ms; xem log function)"
}
warm_up_product_lookup
expect_product_404 /products/khong-ton-tai 'slug cố định của US-05'
expect_product_404 "/products/khong-ton-tai-smoke-$RUN_ID" 'slug mới'
expect_product_404 "/products/khong-ton-tai-rsc-$RUN_ID" 'request RSC' 'rsc: 1'
expect_product_404 "/products/khong-ton-tai-suffix-$RUN_ID.rsc" 'hậu tố .rsc'
expect_404 "/products/khong%2Dton%2Dtai%2D$RUN_ID" '%2D'
expect_404 "/products/KHONG-TON-TAI-$RUN_ID" 'chữ hoa'
# Segment prefetch (audit PR #26 M1): Next.js fetches <page>.segments/<segment>.segment.rsc; Vercel hands the proxy
# that path as is.
expect_product_404 "/products/khong-ton-tai-seg-$RUN_ID.segments/_tree.segment.rsc" 'segment prefetch dạng đường dẫn' 'rsc: 1'
expect_product_404 "/products/khong-ton-tai-seg2-$RUN_ID.segments/_tree.segment.rsc" 'segment prefetch dạng đường dẫn, không header'

# US-10 (ADR-0012): an unknown blog slug is checked against the static registry in src/proxy.ts, with no database, so
# there is no warm-up: the very first request for a fresh slug must be a 404, in every transport form and spelling.
expect_404 "/blog/khong-ton-tai-$RUN_ID" 'bài: slug mới'
expect_404 "/blog/khong-ton-tai-rsc-$RUN_ID" 'bài: request RSC' 'rsc: 1'
expect_404 "/blog/khong-ton-tai-suffix-$RUN_ID.rsc" 'bài: hậu tố .rsc'
expect_404 "/blog/khong-ton-tai-seg-$RUN_ID.segments/_tree.segment.rsc" 'bài: segment prefetch dạng đường dẫn' 'rsc: 1'
expect_404 "/blog/KHONG-TON-TAI-$RUN_ID" 'bài: chữ hoa'
expect_404 "/blog/khong%2Dton%2Dtai%2D$RUN_ID" 'bài: %2D'
expect_404 /blog/constructor 'bài: constructor'
# A percent-encoded spelling of a real post is not decoded by the proxy: 404, never a duplicate URL of the post.
expect_404 /blog/chao%2Dmung-den-next-store 'bài: %2D trong slug có thật'

# US-11 (K10): the image route of an unknown slug would answer a 200 PNG and leave a cache entry. The paths are the
# real og:image paths of a product and a post (hash suffix as built) with the slug swapped, and the same without the
# hash suffix.
OG_UNKNOWN_PRODUCT="/products/khong-ton-tai-og-$RUN_ID"
OG_UNKNOWN_POST="/blog/khong-ton-tai-og-$RUN_ID"
expect_product_404 "$OG_UNKNOWN_PRODUCT${DETAIL_OG_PATH#"$DETAIL_PATH"}" 'ảnh OG: slug sản phẩm lạ'
expect_product_404 "$OG_UNKNOWN_PRODUCT-2/opengraph-image" 'ảnh OG: slug sản phẩm lạ, không hậu tố băm'
expect_404 "$OG_UNKNOWN_POST${POST_OG_PATH#"$POST_PATH"}" 'ảnh OG: slug bài lạ'
expect_404 "$OG_UNKNOWN_POST-2/opengraph-image" 'ảnh OG: slug bài lạ, không hậu tố băm'
[ -z "$NOT_FOUND_FAILED" ] || fail "slug hoặc ảnh OG không tồn tại không trả 404 ngay lần đầu (xem các dòng LỖI ở trên)"

# NS-103 (narrows M4 decision 11, NS-92): only a POST with the `next-action` header is a Server Action and skips the
# slug check. Next.js renders any other request like a GET, so a POST without the header, a PUT or a DELETE to an unknown
# or malformed slug must get the proxy's 404 too; before the fix it answered 200 and left a new route cache entry
# (audit NS-96). The unknown product slug needs the lookup, so it may fail open like the GET cases above (NS-79).
expect_product_404 "/products/khong-ton-tai-post-$RUN_ID" 'POST không có next-action' '' POST
expect_404 "/products/KHONG-TON-TAI-POST-$RUN_ID" 'POST không có next-action, chữ hoa' '' POST
expect_404 "/blog/khong-ton-tai-post-$RUN_ID" 'bài: POST không có next-action' '' POST
expect_product_404 "/products/khong-ton-tai-put-$RUN_ID" 'PUT' '' PUT
expect_404 "/blog/khong-ton-tai-delete-$RUN_ID" 'bài: DELETE' '' DELETE
expect_product_404 "/products/khong-ton-tai-post-$RUN_ID" 'GET sau POST cùng slug'
[ -z "$NOT_FOUND_FAILED" ] || fail "request không phải Server Action tới slug lạ không trả 404 ngay lần đầu (xem các dòng LỖI ở trên)"
if [ "$PRODUCT_FAIL_OPEN_COUNT" -gt 0 ]; then
  echo "smoke: $PRODUCT_FAIL_OPEN_COUNT ca slug sản phẩm fail-open, chỉ cảnh báo (SMOKE_PRODUCT_FAIL_OPEN=warn)"
fi

# The proxy must not turn a known product's client navigation (RSC request) into a 404. `?_rsc` is the cache-busting
# parameter Next.js redirects an RSC request to (307) when it is missing; empty matches a request with no router headers.
# The transport forms of a known product's URL must reach the page too: `.rsc` and the segment prefetch path
# (audit PR #26 M1: before the fix the proxy answered the latter with 404, breaking the page's own prefetch).
# The same holds for a known post (client navigation between posts and Back use these forms too, Task 13 Step 5).
expect_known_200() { # expect_known_200 <path> <label> [header]
  local path=$1 label=$2 header=${3:-} status
  status=$(fetch "$BASE$path" "$TMP/known-transport" "$header") || fail "không kết nối được $BASE$path"
  [ "$status" = 200 ] || fail "GET $path ($label) trả $status, cần 200"
  echo "smoke: GET $path ($label) → 200"
}
# `next start` never serves the path form of a segment prefetch (Next.js 16.4.6 enables that normalizer only in
# minimal mode, i.e. on Vercel: server/base-server.js), so it answers 404 even for `/`. Locally the check is that the
# proxy let the request through (no rewrite header); on a deployment the response itself must be 200.
expect_known_segment() { # expect_known_segment <page path> <label>
  local path="$1.segments/_tree.segment.rsc" label=$2 status
  if [ "$SCHEME" = https ]; then
    expect_known_200 "$path" "$label" 'rsc: 1'
    return 0
  fi
  status=$(fetch "$BASE$path" "$TMP/known-segment" 'rsc: 1' "$TMP/known-segment.headers") ||
    fail "không kết nối được $BASE$path"
  if tr -d '\r' < "$TMP/known-segment.headers" | grep -qi '^x-middleware-rewrite:'; then
    fail "GET $path ($label) bị proxy rewrite sang not-found, cần cho đi tiếp"
  fi
  echo "smoke: GET $path ($label) → $status, proxy cho đi tiếp (next start không phục vụ dạng này)"
}
expect_known_200 "$DETAIL_PATH?_rsc" 'request RSC' 'rsc: 1'
expect_known_200 "$DETAIL_PATH.rsc" 'hậu tố .rsc'
expect_known_segment "$DETAIL_PATH" 'segment prefetch dạng đường dẫn'
expect_known_200 "$POST_PATH?_rsc" 'bài: request RSC' 'rsc: 1'
expect_known_200 "$POST_PATH.rsc" 'bài: hậu tố .rsc'
expect_known_segment "$POST_PATH" 'bài: segment prefetch dạng đường dẫn'

echo "smoke: qua"
