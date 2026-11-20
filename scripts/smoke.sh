#!/usr/bin/env bash
# Smoke test: trang chủ trả 200 và có SMOKE_TEXT; một đường dẫn không tồn tại trả 404 với trang tiếng Việt.
#
#   npm run smoke                                   # chạy `next start` từ bản build hiện có (.next/), kiểm rồi tắt
#   BASE_URL=https://<deploy>.vercel.app npm run smoke   # kiểm một URL đã deploy
#
# Biến tuỳ chọn:
#   BASE_URL                         https://<host>[:cổng], hoặc http://localhost|127.0.0.1[:cổng]; không có đường dẫn
#   SMOKE_TEXT                       chuỗi phải có trong HTML trang chủ (mặc định: tên một sản phẩm nổi bật trong
#                                    src/db/seed-data.ts, chứng minh trang đọc được dữ liệu, không chỉ render khung)
#   SMOKE_PORT                       cổng cho `next start` khi không có BASE_URL (mặc định: 3100); cổng phải trống
#   VERCEL_AUTOMATION_BYPASS_SECRET  có thì gửi header x-vercel-protection-bypass (vượt Deployment Protection),
#                                    chỉ khi BASE_URL là https://
set -euo pipefail
cd "$(dirname "$0")/.."

SMOKE_TEXT=${SMOKE_TEXT:-Áo thun 404 Not Found}
SMOKE_PORT=${SMOKE_PORT:-3100}
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
fetch() { # fetch <url> <body-file> → in mã HTTP
  local url=$1 body=$2 code=0
  xtrace_off
  {
    if [ -n "$SEND_BYPASS" ]; then printf 'header = "x-vercel-protection-bypass: %s"\n' "$BYPASS"; fi
  } | curl_safe -sS -o "$body" -w '%{http_code}' --max-time 20 --config - --url "$url" || code=$?
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

status=$(fetch "$BASE/" "$TMP/home.html") || fail "không kết nối được $BASE/"
# Protection answers 401 (login page) or redirects to vercel.com; say so instead of a bare "expected 200".
if [ "$status" = 401 ] || [ "$status" = 403 ] || { [ "$status" != 200 ] && grep -q 'vercel\.com/\(sso\|login\)' "$TMP/home.html"; }; then
  [ -n "$SEND_BYPASS" ] && fail "GET / trả $status: Vercel Deployment Protection từ chối bypass secret."
  fail "GET / trả $status: Vercel Deployment Protection chặn. Đặt VERCEL_AUTOMATION_BYPASS_SECRET rồi chạy lại."
fi
[ "$status" = 200 ] || fail "GET / trả $status, cần 200"
grep -qF -- "$SMOKE_TEXT" "$TMP/home.html" || fail "HTML trang chủ không có \"$SMOKE_TEXT\""
echo "smoke: GET / → 200, có \"$SMOKE_TEXT\""

status=$(fetch "$BASE/khong-ton-tai" "$TMP/404.html") || fail "không kết nối được $BASE/khong-ton-tai"
[ "$status" = 404 ] || fail "GET /khong-ton-tai trả $status, cần 404"
# NS-38: the 404 must be the app's Vietnamese page, not Next.js's built-in English fallback.
grep -qF 'Không tìm thấy trang' "$TMP/404.html" || fail "HTML 404 không có \"Không tìm thấy trang\""
if grep -qF 'This page could not be found' "$TMP/404.html"; then fail "HTML 404 còn trang mặc định tiếng Anh của Next.js"; fi
echo "smoke: GET /khong-ton-tai → 404, trang tiếng Việt"

echo "smoke: qua"
