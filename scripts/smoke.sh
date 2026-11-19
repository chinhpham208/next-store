#!/usr/bin/env bash
# Smoke test: trang chủ trả 200 và có SMOKE_TEXT; một đường dẫn không tồn tại trả 404.
#
#   npm run smoke                                   # chạy `next start` từ bản build hiện có (.next/), kiểm rồi tắt
#   BASE_URL=https://<deploy>.vercel.app npm run smoke   # kiểm một URL đã deploy
#
# Biến tuỳ chọn:
#   SMOKE_TEXT                       chuỗi phải có trong HTML trang chủ (mặc định: tên một sản phẩm nổi bật trong
#                                    src/db/seed-data.ts, chứng minh trang đọc được dữ liệu, không chỉ render khung)
#   SMOKE_PORT                       cổng cho `next start` khi không có BASE_URL (mặc định: 3100)
#   VERCEL_AUTOMATION_BYPASS_SECRET  có thì gửi header x-vercel-protection-bypass (vượt Deployment Protection)
set -euo pipefail
cd "$(dirname "$0")/.."

SMOKE_TEXT=${SMOKE_TEXT:-Áo thun 404 Not Found}
SMOKE_PORT=${SMOKE_PORT:-3100}
BYPASS=${VERCEL_AUTOMATION_BYPASS_SECRET:-}
SERVER_PID=

fail() { echo "smoke: LỖI: $*" >&2; exit 1; }

# The bypass secret goes to curl through a config on stdin, never on the command line, so it cannot show up in
# `ps` output or in a CI log that echoes commands.
fetch() { # fetch <url> <body-file> → in mã HTTP
  local url=$1 body=$2
  {
    if [ -n "$BYPASS" ]; then printf 'header = "x-vercel-protection-bypass: %s"\n' "$BYPASS"; fi
  } | curl -sS -o "$body" -w '%{http_code}' --max-time 20 --config - "$url"
}

stop_server() {
  [ -n "$SERVER_PID" ] || return 0
  # setsid gave the server its own process group; kill the whole group so no worker keeps the port.
  kill -- "-$SERVER_PID" 2>/dev/null || kill "$SERVER_PID" 2>/dev/null || true
  wait "$SERVER_PID" 2>/dev/null || true
}

start_server() {
  [ -d .next ] || fail "chưa có bản build (.next/). Chạy npm run build trước."
  echo "smoke: next start -p $SMOKE_PORT"
  setsid node_modules/.bin/next start -p "$SMOKE_PORT" > "$TMP/server.log" 2>&1 &
  SERVER_PID=$!
  local i
  for i in $(seq 1 60); do
    if curl -s -o /dev/null --max-time 2 "http://127.0.0.1:$SMOKE_PORT/"; then return 0; fi
    kill -0 "$SERVER_PID" 2>/dev/null || { tail -n 20 "$TMP/server.log" >&2; fail "next start đã thoát"; }
    sleep 1
  done
  tail -n 20 "$TMP/server.log" >&2
  fail "next start không sẵn sàng sau 60 giây"
}

TMP=$(mktemp -d)
trap 'stop_server; rm -rf "$TMP"' EXIT

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
  [ -n "$BYPASS" ] && fail "GET / trả $status: Vercel Deployment Protection từ chối bypass secret."
  fail "GET / trả $status: Vercel Deployment Protection chặn. Đặt VERCEL_AUTOMATION_BYPASS_SECRET rồi chạy lại."
fi
[ "$status" = 200 ] || fail "GET / trả $status, cần 200"
grep -qF -- "$SMOKE_TEXT" "$TMP/home.html" || fail "HTML trang chủ không có \"$SMOKE_TEXT\""
echo "smoke: GET / → 200, có \"$SMOKE_TEXT\""

status=$(fetch "$BASE/khong-ton-tai" "$TMP/404.html") || fail "không kết nối được $BASE/khong-ton-tai"
[ "$status" = 404 ] || fail "GET /khong-ton-tai trả $status, cần 404"
echo "smoke: GET /khong-ton-tai → 404"

echo "smoke: qua"
