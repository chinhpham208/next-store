#!/usr/bin/env bash
# Kiểm scripts/smoke-fail-open.sh (NS-111) với một smoke giả: không cần bản build, không mở cổng.
#
#   bash scripts/smoke-fail-open.test.sh
set -euo pipefail
cd "$(dirname "$0")/.."

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
fail() { echo "FAIL $1: $2" >&2; [ -f "$TMP/out" ] && sed 's/^/  | /' "$TMP/out" >&2; exit 1; }

mkdir -p "$TMP/pglite"
echo seeded > "$TMP/pglite/PG_VERSION"

# fake_smoke <exit code> <print warm-up warning: 1|''>: records the env it was given.
fake_smoke() {
  cat > "$TMP/smoke.sh" <<EOF
#!/usr/bin/env bash
{
  echo "NODE_OPTIONS=\${NODE_OPTIONS:-}"
  echo "PGLITE_DATA_DIR=\${PGLITE_DATA_DIR:-}"
  echo "SMOKE_PRODUCT_FAIL_OPEN=\${SMOKE_PRODUCT_FAIL_OPEN:-}"
  echo "BASE_URL=\${BASE_URL:-}"
  echo "BYPASS=\${VERCEL_AUTOMATION_BYPASS_SECRET:-}"
  echo "copy=\$(cat "\$PGLITE_DATA_DIR/PG_VERSION" 2>/dev/null)"
} > "$TMP/env"
echo "smoke: GET / → 200"
if [ -n "$2" ]; then
  echo "::warning::smoke: 3 slug lạ warm-up đều trả 200, lần cuối sau 430 ms: lookup DB của proxy fail-open (SMOKE_PRODUCT_FAIL_OPEN=warn, NS-79)"
fi
exit $1
EOF
}
run() {
  CODE=0
  env SMOKE_FAIL_OPEN_SMOKE="$TMP/smoke.sh" SMOKE_FAIL_OPEN_PGLITE="$TMP/pglite" BASE_URL=https://should-be-unset.example \
    VERCEL_AUTOMATION_BYPASS_SECRET=abcdefghijklmnop0123 bash scripts/smoke-fail-open.sh > "$TMP/out" 2>&1 || CODE=$?
}

# pass: smoke passes and proves every lookup failed open → 0; env as designed.
fake_smoke 0 1
run
[ "$CODE" = 0 ] || fail pass "thoát $CODE, cần 0"
grep -qx 'NODE_OPTIONS=--import ./e2e/far-db.mjs' "$TMP/env" || fail pass "không preload far-db.mjs"
grep -qx 'SMOKE_PRODUCT_FAIL_OPEN=warn' "$TMP/env" || fail pass "không đặt SMOKE_PRODUCT_FAIL_OPEN=warn"
grep -qx 'BASE_URL=' "$TMP/env" || fail pass "BASE_URL không bị bỏ (smoke phải tự chạy next start)"
grep -qx 'BYPASS=' "$TMP/env" || fail pass "secret bypass lọt vào smoke cục bộ"
grep -qx 'copy=seeded' "$TMP/env" || fail pass "PGLITE_DATA_DIR không phải bản sao của DB đã seed"
! grep -qx "PGLITE_DATA_DIR=$TMP/pglite" "$TMP/env" || fail pass "dùng thẳng DB gốc thay vì bản sao"
grep -qF 'smoke-fail-open: qua' "$TMP/out" || fail pass "không có dòng qua"
echo "ok pass"

# no-fail-open: smoke passes but the lookups never failed open → the run proves nothing → 1.
fake_smoke 0 ''
run
[ "$CODE" = 1 ] || fail no-fail-open "thoát $CODE, cần 1"
grep -qF 'proxy không fail-open' "$TMP/out" || fail no-fail-open "không nêu lý do"
echo "ok no-fail-open"

# smoke-fails: smoke fails (e.g. OG 500 of v0.4.0) → 1, its output kept.
fake_smoke 1 1
run
[ "$CODE" = 1 ] || fail smoke-fails "thoát $CODE, cần 1"
grep -qF 'smoke: GET / → 200' "$TMP/out" || fail smoke-fails "mất output của smoke"
echo "ok smoke-fails"

# no-database: no seeded PGlite directory (no build) → 1 before smoke runs.
fake_smoke 0 1
rm -f "$TMP/env"
CODE=0
env SMOKE_FAIL_OPEN_SMOKE="$TMP/smoke.sh" SMOKE_FAIL_OPEN_PGLITE="$TMP/khong-co" bash scripts/smoke-fail-open.sh > "$TMP/out" 2>&1 || CODE=$?
[ "$CODE" = 1 ] || fail no-database "thoát $CODE, cần 1"
[ ! -f "$TMP/env" ] || fail no-database "smoke vẫn chạy"
echo "ok no-database"

echo "smoke-fail-open.test.sh: mọi ca qua"
