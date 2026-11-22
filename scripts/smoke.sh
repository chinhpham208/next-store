#!/usr/bin/env bash
# Smoke test: trang chủ trả 200 và có SMOKE_TEXT; một đường dẫn không tồn tại trả 404 với trang tiếng Việt;
# một trang chi tiết sản phẩm trả 200 và có tên sản phẩm; /products trả 200 và có lưới sản phẩm, kể cả với
# tham số không hợp lệ; slug sản phẩm không tồn tại trả 404 ngay lần đầu; /sitemap.xml và /robots.txt trả 200, cùng
# một origin tuyệt đối, robots.txt chặn hay cho crawl đúng môi trường; trang chủ có og:site_name.
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
fetch() { # fetch <url> <body-file> [header] [response-headers-file] → in mã HTTP
  local url=$1 body=$2 header=${3:-} dump=${4:-/dev/null} code=0
  if [ -n "$header" ] && ! [[ $header =~ ^[A-Za-z0-9-]+:\ [A-Za-z0-9./-]+$ ]]; then fail "header không hợp lệ"; fi
  xtrace_off
  {
    if [ -n "$SEND_BYPASS" ]; then printf 'header = "x-vercel-protection-bypass: %s"\n' "$BYPASS"; fi
    if [ -n "$header" ]; then printf 'header = "%s"\n' "$header"; fi
  } | curl_safe -sS -D "$dump" -o "$body" -w '%{http_code}' --max-time 20 --config - --url "$url" || code=$?
  xtrace_restore
  return "$code"
}

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

# US-05 (ADR-0009): src/proxy.ts answers an unknown product slug with a real 404 on the very first request, before
# render; a page-level notFound() would send a 200 shell first (K3). Fresh slugs each run, so no earlier request
# can have left a cached 404 behind, plus the fixed slug from the acceptance criteria. Every transport form of the
# URL (RSC request, .rsc suffix) and every non-canonical spelling (%2D, upper case) must be a 404 too.
# Every case runs before smoke fails: which variants pass tells whether the proxy ran at all (malformed slugs never
# reach the database) or only its database lookup failed open.
PRODUCT_404_FAILED=
expect_product_404() { # expect_product_404 <path> <label> [header]
  local path=$1 label=$2 header=${3:-} status
  status=$(fetch "$BASE$path" "$TMP/product-404" "$header") || fail "không kết nối được $BASE$path"
  if [ "$status" != 404 ]; then
    echo "smoke: LỖI: GET $path ($label) trả $status ngay lần đầu, cần 404" >&2
    PRODUCT_404_FAILED=1
    return 0
  fi
  if [ -z "$header" ] && [ "${path%.rsc}" = "$path" ] && ! grep -qF 'Không tìm thấy trang' "$TMP/product-404"; then
    echo "smoke: LỖI: HTML $path ($label) không có \"Không tìm thấy trang\"" >&2
    PRODUCT_404_FAILED=1
    return 0
  fi
  echo "smoke: GET $path ($label) → 404"
}
RUN_ID="$(date +%s)-$RANDOM"
# A cold database connection (Neon waking up, new function instance) can outlast the proxy's 400 ms bound; the
# proxy then fails open and that slug answers 200 (ADR-0009). Measured on the first preview of NS-49: the first two
# lookups failed open, later ones 404'd (that preview ran in iad1, far from Neon; sin1 since). So first send fresh
# slugs — each one a first hit — until one gets its 404: more than MAX_WARMUP_FAIL_OPEN fail-opens fail smoke, any
# fail-open is a CI warning; then every case below must 404 on the first hit.
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
warm_up_product_lookup() {
  local i status
  for i in $(seq 1 "$((MAX_WARMUP_FAIL_OPEN + 1))"); do
    status=$(fetch "$BASE/products/smoke-warmup-$RUN_ID-$i" "$TMP/warmup" '' "$TMP/warmup.headers") ||
      fail "không kết nối được $BASE/products/smoke-warmup-…"
    print_vercel_region "$TMP/warmup.headers"
    if [ "$status" = 404 ]; then
      echo "smoke: proxy kiểm slug được từ request thứ $i ($((i - 1)) slug lạ fail-open trước đó)"
      # A workflow command on purpose: a fail-open within the limit is visible on the run summary, not only in the log.
      if [ "$i" -gt 1 ]; then echo "::warning::smoke: $((i - 1)) slug lạ fail-open (trả 200) trước khi proxy trả 404"; fi
      return 0
    fi
    sleep 1
  done
  fail "proxy chưa trả 404 cho slug lạ sau $((MAX_WARMUP_FAIL_OPEN + 1)) request: hơn $MAX_WARMUP_FAIL_OPEN slug fail-open (lookup DB lỗi hoặc quá 400 ms; xem log function)"
}
warm_up_product_lookup
expect_product_404 /products/khong-ton-tai 'slug cố định của US-05'
expect_product_404 "/products/khong-ton-tai-smoke-$RUN_ID" 'slug mới'
expect_product_404 "/products/khong-ton-tai-rsc-$RUN_ID" 'request RSC' 'rsc: 1'
expect_product_404 "/products/khong-ton-tai-suffix-$RUN_ID.rsc" 'hậu tố .rsc'
expect_product_404 "/products/khong%2Dton%2Dtai%2D$RUN_ID" '%2D'
expect_product_404 "/products/KHONG-TON-TAI-$RUN_ID" 'chữ hoa'
# Segment prefetch (audit PR #26 M1): Next.js fetches <page>.segments/<segment>.segment.rsc; Vercel hands the proxy
# that path as is.
expect_product_404 "/products/khong-ton-tai-seg-$RUN_ID.segments/_tree.segment.rsc" 'segment prefetch dạng đường dẫn' 'rsc: 1'
expect_product_404 "/products/khong-ton-tai-seg2-$RUN_ID.segments/_tree.segment.rsc" 'segment prefetch dạng đường dẫn, không header'
[ -z "$PRODUCT_404_FAILED" ] || fail "slug sản phẩm không tồn tại không trả 404 ngay lần đầu (xem các dòng LỖI ở trên)"

# The proxy must not turn a known product's client navigation (RSC request) into a 404. `?_rsc` is the cache-busting
# parameter Next.js redirects an RSC request to (307) when it is missing; empty matches a request with no router headers.
# The transport forms of a known product's URL must reach the page too: `.rsc` and the segment prefetch path
# (audit PR #26 M1: before the fix the proxy answered the latter with 404, breaking the page's own prefetch).
expect_known_product_200() { # expect_known_product_200 <path> <label> [header]
  local path=$1 label=$2 header=${3:-} status
  status=$(fetch "$BASE$path" "$TMP/known-transport" "$header") || fail "không kết nối được $BASE$path"
  [ "$status" = 200 ] || fail "GET $path ($label) trả $status, cần 200"
  echo "smoke: GET $path ($label) → 200"
}
expect_known_product_200 "$DETAIL_PATH?_rsc" 'request RSC' 'rsc: 1'
expect_known_product_200 "$DETAIL_PATH.rsc" 'hậu tố .rsc'
# `next start` never serves the path form of a segment prefetch (Next.js 16.4.6 enables that normalizer only in
# minimal mode, i.e. on Vercel: server/base-server.js), so it answers 404 even for `/`. Locally the check is that the
# proxy let the request through (no rewrite header); on a deployment the response itself must be 200.
SEGMENT_PATH="$DETAIL_PATH.segments/_tree.segment.rsc"
if [ "$SCHEME" = https ]; then
  expect_known_product_200 "$SEGMENT_PATH" 'segment prefetch dạng đường dẫn' 'rsc: 1'
else
  status=$(fetch "$BASE$SEGMENT_PATH" "$TMP/known-segment" 'rsc: 1' "$TMP/known-segment.headers") ||
    fail "không kết nối được $BASE$SEGMENT_PATH"
  if tr -d '\r' < "$TMP/known-segment.headers" | grep -qi '^x-middleware-rewrite:'; then
    fail "GET $SEGMENT_PATH (segment prefetch dạng đường dẫn) bị proxy rewrite sang not-found, cần cho đi tiếp"
  fi
  echo "smoke: GET $SEGMENT_PATH (segment prefetch dạng đường dẫn) → $status, proxy cho đi tiếp (next start không phục vụ dạng này)"
fi

echo "smoke: qua"
