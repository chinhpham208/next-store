#!/usr/bin/env bash
# Smoke với DB ở xa (NS-111; đổi mục đích ở ADR-0017 / NS-79): DB chậm mà slug sản phẩm lạ vẫn 404 ngay.
#
#   npm run build && bash scripts/smoke-fail-open.sh
#
# Vì sao: tới v0.4.x proxy tra slug sản phẩm trong DB và fail-open khi quá 400 ms; trên Production (proxy chạy ở edge
# gần runner GitHub ở Mỹ, xa Neon ở Singapore) slug lạ vì vậy trả 200, kéo theo OG 500 của v0.4.0 (NS-109) và 405 của
# v0.4.1 (NS-110). Từ ADR-0017 proxy đối chiếu registry slug tĩnh, không chạm DB. Ở đây `next start` của bản build
# hiện có chạy với e2e/far-db.mjs (mỗi truy vấn chờ 600 ms trước), trên một bản sao của PGlite đã seed, và smoke chạy
# như trên Production, không cờ nào. Smoke phải qua, và mọi slug sản phẩm lạ phải 404 dưới SLOW_MS: một lần tra DB
# đã tốn 600 ms, nên một ca chậm hơn nghĩa là proxy (hay trang 404) lại chờ DB.
#
# Không gửi request ra ngoài, không dùng secret: BASE_URL, VERCEL_AUTOMATION_BYPASS_SECRET và SMOKE_PRODUCT_FAIL_OPEN
# (đã bỏ) bị bỏ. Biến tuỳ chọn: SMOKE_PORT (như smoke.sh). Chỉ cho test: SMOKE_FAIL_OPEN_SMOKE, SMOKE_FAIL_OPEN_PGLITE.
set -euo pipefail
cd "$(dirname "$0")/.."

SMOKE=${SMOKE_FAIL_OPEN_SMOKE:-scripts/smoke.sh}
SOURCE_DB=${SMOKE_FAIL_OPEN_PGLITE:-.data/pglite}
# Well under the 600 ms every query of e2e/far-db.mjs waits.
SLOW_MS=200
# Printed by smoke.sh for every unknown product slug that got its 404: `smoke: <method> /products/… (<label>) → 404, N ms`.
PRODUCT_404='^smoke: [A-Z]+ /products/[^ ]+ \(.*\) → 404, [0-9]+ ms$'
FIRST='(slug sản phẩm lạ đầu tiên) → 404'

[ -d "$SOURCE_DB" ] || { echo "smoke-fail-open: LỖI: chưa có $SOURCE_DB (chạy npm run build trước)" >&2; exit 1; }

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
# PGlite has no cross-process lock (next.config.ts): the server works on a copy, never on the seeded database.
cp -R "$SOURCE_DB" "$TMP/pglite"

code=0
env -u BASE_URL -u VERCEL_AUTOMATION_BYPASS_SECRET -u SMOKE_PRODUCT_FAIL_OPEN \
  NODE_OPTIONS='--import ./e2e/far-db.mjs' PGLITE_DATA_DIR="$TMP/pglite" \
  bash "$SMOKE" 2>&1 | tee "$TMP/out" || code=$? # pipefail: smoke's exit code

if [ "$code" != 0 ]; then
  echo "smoke-fail-open: LỖI: smoke thoát $code khi DB ở xa (xem các dòng LỖI ở trên)" >&2
  exit 1
fi
if ! grep -qF -- "$FIRST" "$TMP/out"; then
  echo "smoke-fail-open: LỖI: không thấy dòng 404 của slug sản phẩm lạ đầu tiên: lần chạy không kiểm được gì" >&2
  exit 1
fi
grep -E -- "$PRODUCT_404" "$TMP/out" > "$TMP/product-404" || true
slow=$(awk -v limit="$SLOW_MS" '{ ms = $(NF - 1) + 0; if (ms >= limit) { sub(/^smoke: /, ""); sub(/, [0-9]+ ms$/, " sau " ms " ms"); print } }' "$TMP/product-404")
if [ -n "$slow" ]; then
  echo "smoke-fail-open: LỖI: slug sản phẩm lạ trả 404 chậm (từ $SLOW_MS ms): proxy hay trang 404 chờ DB:" >&2
  printf '  %s\n' "$slow" >&2
  exit 1
fi
count=$(grep -c . "$TMP/product-404")
max=$(awk '{ ms = $(NF - 1) + 0; if (ms > max) max = ms } END { print max + 0 }' "$TMP/product-404")
echo "smoke-fail-open: qua ($count slug sản phẩm lạ trả 404, chậm nhất $max ms, với mỗi truy vấn DB chờ 600 ms)"
