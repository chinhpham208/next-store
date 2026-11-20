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
# product page (and its RSC / segment prefetch forms) with the default SMOKE_TEXT, the smoke's listing paths with the
# labelled grid (or with <status>, e.g. 401 like Vercel Deployment Protection), everything else with 404 and
# <404-body> (default: the app's Vietnamese page). URLs matching <soft-regex> answer 200 with the not-found page, like
# a page-level notFound() under Cache Components (K3) or a proxy that failed open; URLs matching <hard-404-regex>
# answer 404 with the proxy's rewrite header even when they are a known product's.
start_server() {
  local port=$1 headers=$2 status=${3:-200} body=${4:-"<h1>Không tìm thấy trang</h1>"} soft=${5:-} hard=${6:-} ready="$TMP/ready-$1"
  node -e '
    const [port, headers, ready, status, body, soft, hard] = process.argv.slice(1)
    const fs = require("node:fs")
    require("node:http").createServer((req, res) => {
      fs.appendFileSync(headers, JSON.stringify(req.headers) + "\n")
      if (hard && new RegExp(hard).test(req.url)) { res.writeHead(404, { "content-type": "text/html; charset=utf-8", "x-middleware-rewrite": "/_khong-tim-thay" }); res.end(body) }
      else if (req.url === "/" || ["/products/ao-404-not-found", "/products/ao-404-not-found?_rsc", "/products/ao-404-not-found.rsc", "/products/ao-404-not-found.segments/_tree.segment.rsc"].includes(req.url)) { res.writeHead(Number(status), { "content-type": "text/html; charset=utf-8" }); res.end("<h1>Áo thun 404 Not Found</h1>") }
      else if (req.url === "/products" || req.url === "/products?page=abc&sort=xyz") { res.writeHead(Number(status), { "content-type": "text/html; charset=utf-8" }); res.end("<ul aria-label=\"Danh sách sản phẩm\"></ul>") }
      else if (soft && new RegExp(soft).test(req.url)) { res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); res.end(body) }
      else { res.writeHead(404, { "content-type": "text/html; charset=utf-8" }); res.end(body) }
    }).listen(Number(port), "127.0.0.1", () => fs.writeFileSync(ready, ""))
  ' "$port" "$headers" "$ready" "$status" "$body" "$soft" "$hard" &
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
  env -u BASE_URL -u VERCEL_AUTOMATION_BYPASS_SECRET -u SMOKE_PORT PATH="$TMP/bin:$PATH" "${envs[@]}" "$@" > "$TMP/out" 2>&1
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
