#!/usr/bin/env bash
# Kiểm scripts/smoke-fail-open.sh (NS-111, đổi mục đích ở ADR-0017 / NS-79) với một smoke giả: không cần bản build,
# không mở cổng.
#
#   bash scripts/smoke-fail-open.test.sh
set -euo pipefail
cd "$(dirname "$0")/.."

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
fail() { echo "FAIL $1: $2" >&2; [ -f "$TMP/out" ] && sed 's/^/  | /' "$TMP/out" >&2; exit 1; }

mkdir -p "$TMP/pglite"
echo seeded > "$TMP/pglite/PG_VERSION"

# fake_smoke <exit code> <product 404 lines, one "<label>|<ms>" per line; empty: none>: records the env it was given.
fake_smoke() {
  local lines='' entry
  while IFS= read -r entry; do
    [ -n "$entry" ] || continue
    lines+="echo 'smoke: GET /products/khong-ton-tai-1 (${entry%|*}) → 404, ${entry#*|} ms'"$'\n'
  done <<< "$2"
  cat > "$TMP/smoke.sh" <<SMOKE
#!/usr/bin/env bash
{
  echo "NODE_OPTIONS=\${NODE_OPTIONS:-}"
  echo "PGLITE_DATA_DIR=\${PGLITE_DATA_DIR:-}"
  echo "SMOKE_PRODUCT_FAIL_OPEN=\${SMOKE_PRODUCT_FAIL_OPEN-<unset>}"
  echo "BASE_URL=\${BASE_URL:-}"
  echo "BYPASS=\${VERCEL_AUTOMATION_BYPASS_SECRET:-}"
  echo "copy=\$(cat "\$PGLITE_DATA_DIR/PG_VERSION" 2>/dev/null)"
} > "$TMP/env"
echo "smoke: GET / → 200"
echo "smoke: GET /blog/khong-ton-tai-1 (bài: slug mới) → 404, 900 ms"
$lines
exit $1
SMOKE
}
run() {
  CODE=0
  env SMOKE_FAIL_OPEN_SMOKE="$TMP/smoke.sh" SMOKE_FAIL_OPEN_PGLITE="$TMP/pglite" BASE_URL=https://should-be-unset.example \
    VERCEL_AUTOMATION_BYPASS_SECRET=abcdefghijklmnop0123 SMOKE_PRODUCT_FAIL_OPEN=warn \
    bash scripts/smoke-fail-open.sh > "$TMP/out" 2>&1 || CODE=$?
}

# pass: smoke passes on a far database and every unknown product slug got its 404 under SLOW_MS (450 ms) → 0; env as designed.
fake_smoke 0 $'slug sản phẩm lạ đầu tiên|35\nslug cố định của US-05|12\nảnh OG: slug sản phẩm lạ|199'
run
[ "$CODE" = 0 ] || fail pass "thoát $CODE, cần 0"
grep -qx 'NODE_OPTIONS=--import ./e2e/far-db.mjs' "$TMP/env" || fail pass "không preload far-db.mjs"
grep -qx 'SMOKE_PRODUCT_FAIL_OPEN=<unset>' "$TMP/env" || fail pass "SMOKE_PRODUCT_FAIL_OPEN không bị bỏ (cờ đã bỏ, ADR-0017)"
grep -qx 'BASE_URL=' "$TMP/env" || fail pass "BASE_URL không bị bỏ (smoke phải tự chạy next start)"
grep -qx 'BYPASS=' "$TMP/env" || fail pass "secret bypass lọt vào smoke cục bộ"
grep -qx 'copy=seeded' "$TMP/env" || fail pass "PGLITE_DATA_DIR không phải bản sao của DB đã seed"
! grep -qx "PGLITE_DATA_DIR=$TMP/pglite" "$TMP/env" || fail pass "dùng thẳng DB gốc thay vì bản sao"
grep -qF 'smoke-fail-open: qua (3 slug sản phẩm lạ trả 404, chậm nhất 199 ms' "$TMP/out" || fail pass "không có dòng qua kèm số đo"
echo "ok pass"

# slow-404: one unknown product slug took SLOW_MS (450 ms) or more → the proxy waited on the database → 1, naming the case.
fake_smoke 0 $'slug sản phẩm lạ đầu tiên|35\nrequest RSC|640'
run
[ "$CODE" = 1 ] || fail slow-404 "thoát $CODE, cần 1"
grep -qF '(request RSC) → 404 sau 640 ms' "$TMP/out" || fail slow-404 "không nêu ca chậm"
echo "ok slow-404"

# no-product-404: smoke passes but printed no 404 for the first unknown product slug → the run proves nothing → 1.
fake_smoke 0 ''
run
[ "$CODE" = 1 ] || fail no-product-404 "thoát $CODE, cần 1"
grep -qF 'không thấy dòng 404 của slug sản phẩm lạ đầu tiên' "$TMP/out" || fail no-product-404 "không nêu lý do"
fake_smoke 0 $'slug cố định của US-05|12'
run
[ "$CODE" = 1 ] || fail no-product-404 "thiếu slug đầu tiên: thoát $CODE, cần 1"
echo "ok no-product-404"

# smoke-fails: smoke fails (e.g. a 200 for an unknown slug, an OG 500) → 1, its output kept.
fake_smoke 1 $'slug sản phẩm lạ đầu tiên|35'
run
[ "$CODE" = 1 ] || fail smoke-fails "thoát $CODE, cần 1"
grep -qF 'smoke: GET / → 200' "$TMP/out" || fail smoke-fails "mất output của smoke"
echo "ok smoke-fails"

# no-database: no seeded PGlite directory (no build) → 1 before smoke runs.
fake_smoke 0 $'slug sản phẩm lạ đầu tiên|35'
rm -f "$TMP/env"
CODE=0
env SMOKE_FAIL_OPEN_SMOKE="$TMP/smoke.sh" SMOKE_FAIL_OPEN_PGLITE="$TMP/khong-co" bash scripts/smoke-fail-open.sh > "$TMP/out" 2>&1 || CODE=$?
[ "$CODE" = 1 ] || fail no-database "thoát $CODE, cần 1"
[ ! -f "$TMP/env" ] || fail no-database "smoke vẫn chạy"
echo "ok no-database"

echo "smoke-fail-open.test.sh: mọi ca qua"
