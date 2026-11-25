#!/usr/bin/env bash
# Smoke với lookup DB của proxy luôn fail-open (NS-111), như Production nhìn từ runner GitHub ở Mỹ.
#
#   npm run build && bash scripts/smoke-fail-open.sh
#
# Vì sao: lỗi OG 500 của v0.4.0 (NS-109) và 405 của v0.4.1 (NS-110) chỉ lộ khi lookup slug trong proxy quá 400 ms và
# fail-open. Trên preview / Dev lookup xong kịp (404 sau ~300 ms trong mọi run e2e-preview đã xem), nên smoke ở đó
# chưa bao giờ đi nhánh fail-open. Ở đây `next start` của bản build hiện có chạy với e2e/far-db.mjs (mỗi truy vấn chờ
# 600 ms trước), trên một bản sao của PGlite đã seed, và smoke chạy như production-e2e (SMOKE_PRODUCT_FAIL_OPEN=warn).
# Smoke qua mà không có cảnh báo warm-up fail-open thì lần chạy không chứng minh gì: cũng là lỗi.
#
# Không gửi request ra ngoài, không dùng secret: BASE_URL và VERCEL_AUTOMATION_BYPASS_SECRET bị bỏ.
# Biến tuỳ chọn: SMOKE_PORT (như smoke.sh). Chỉ cho test: SMOKE_FAIL_OPEN_SMOKE, SMOKE_FAIL_OPEN_PGLITE.
set -euo pipefail
cd "$(dirname "$0")/.."

SMOKE=${SMOKE_FAIL_OPEN_SMOKE:-scripts/smoke.sh}
SOURCE_DB=${SMOKE_FAIL_OPEN_PGLITE:-.data/pglite}
# Printed by smoke.sh when every warm-up slug answered 200 with SMOKE_PRODUCT_FAIL_OPEN=warn.
PROOF='slug lạ warm-up đều trả 200'

[ -d "$SOURCE_DB" ] || { echo "smoke-fail-open: LỖI: chưa có $SOURCE_DB (chạy npm run build trước)" >&2; exit 1; }

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
# PGlite has no cross-process lock (next.config.ts): the server works on a copy, never on the seeded database.
cp -R "$SOURCE_DB" "$TMP/pglite"

code=0
env -u BASE_URL -u VERCEL_AUTOMATION_BYPASS_SECRET \
  NODE_OPTIONS='--import ./e2e/far-db.mjs' PGLITE_DATA_DIR="$TMP/pglite" SMOKE_PRODUCT_FAIL_OPEN=warn \
  bash "$SMOKE" 2>&1 | tee "$TMP/out" || code=$? # pipefail: smoke's exit code

if [ "$code" != 0 ]; then
  echo "smoke-fail-open: LỖI: smoke thoát $code khi proxy fail-open (xem các dòng LỖI ở trên)" >&2
  exit 1
fi
if ! grep -qF -- "$PROOF" "$TMP/out"; then
  echo "smoke-fail-open: LỖI: proxy không fail-open (không có cảnh báo warm-up): lần chạy không kiểm được nhánh fail-open" >&2
  exit 1
fi
echo "smoke-fail-open: qua (mọi lookup slug sản phẩm fail-open, như Production)"
