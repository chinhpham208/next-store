#!/usr/bin/env bash
# Kiểm scripts/wait-vercel-deploy.sh (NS-111). Không ra mạng: `gh` giả trả JSON giả cho deployments và statuses.
#
#   bash scripts/wait-vercel-deploy.test.sh
set -euo pipefail
cd "$(dirname "$0")/.."

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
SHA=0123456789abcdef0123456789abcdef01234567
URL=https://next-store-abc123def-chinhpham208s-projects.vercel.app

fail() { echo "FAIL $1: $2" >&2; [ -f "$TMP/out" ] && sed 's/^/  | /' "$TMP/out" >&2; exit 1; }

mkdir -p "$TMP/bin"
cat > "$TMP/bin/gh" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$FIXTURE/calls"
[ "$1" = api ] && [ $# = 2 ] || { echo "gh giả: cách gọi lạ: $*" >&2; exit 64; }
case $2 in
  "repos/chinhpham208/next-store/deployments?sha=$SHA&per_page=100") name=deployments ;;
  repos/chinhpham208/next-store/deployments/*/statuses\?per_page=100) id=${2#repos/chinhpham208/next-store/deployments/}; name=statuses-${id%%/*} ;;
  *) echo "gh giả: đường dẫn lạ: $2" >&2; exit 64 ;;
esac
count=$(( $(cat "$FIXTURE/$name.count" 2>/dev/null || echo 0) + 1 ))
echo "$count" > "$FIXTURE/$name.count"
file=$FIXTURE/$name.json; k=$count
while [ "$k" -ge 1 ]; do [ -f "$FIXTURE/$name.$k.json" ] && { file=$FIXTURE/$name.$k.json; break; }; k=$((k - 1)); done
[ -f "$file" ] || { echo "gh giả: thiếu $file" >&2; exit 64; }
cat "$file"
EOF
chmod +x "$TMP/bin/gh"
export SHA

# deployment <id> <environment> [creator]
deployment() { jq -n --argjson id "$1" --arg env "$2" --arg c "${3:-vercel[bot]}" --arg sha "$SHA" '{id: $id, sha: $sha, environment: $env, creator: {login: $c}}'; }
# status <state> [url] [creator]: newest first, like the REST API.
status() { jq -n --arg s "$1" --arg u "${2:-}" --arg c "${3:-vercel[bot]}" '{state: $s, environment_url: $u, creator: {login: $c}}'; }
case_dir() { FIXTURE=$TMP/$1; mkdir -p "$FIXTURE"; export FIXTURE; }
wait_deploy() {
  CODE=0
  env PATH="$TMP/bin:$PATH" WAIT_DEPLOY_TIMEOUT="${TIMEOUT:-3}" WAIT_DEPLOY_INTERVAL=1 bash scripts/wait-vercel-deploy.sh "$@" > "$TMP/out" 2> "$TMP/err" || CODE=$?
  cat "$TMP/err" >> "$TMP/out"
}

# success: Preview deployment of the sha by vercel[bot] → prints the URL on stdout, exit 0.
case_dir success
deployment 5 Preview | jq -s . > "$FIXTURE/deployments.json"
status success "$URL" | jq -s . > "$FIXTURE/statuses-5.json"
wait_deploy "$SHA"
[ "$CODE" = 0 ] || fail success "thoát $CODE, cần 0"
[ "$(grep -v '^wait-vercel-deploy:' "$TMP/out" | head -n 1)" = "$URL" ] || fail success "stdout không phải URL"
echo "ok success"

# pending-then-success: không có deployment, rồi pending, rồi success → chờ rồi in URL.
case_dir pending-then-success
echo '[]' > "$FIXTURE/deployments.1.json"
deployment 5 Preview | jq -s . > "$FIXTURE/deployments.2.json"
status pending | jq -s . > "$FIXTURE/statuses-5.1.json"
{ status success "$URL"; status pending; } | jq -s . > "$FIXTURE/statuses-5.2.json"
TIMEOUT=10 wait_deploy "$SHA"
[ "$CODE" = 0 ] || fail pending-then-success "thoát $CODE, cần 0"
grep -qxF "$URL" "$TMP/out" || fail pending-then-success "không in URL"
echo "ok pending-then-success"

# failure: deploy lỗi (ca #87 / #89) → thoát 1 ngay.
case_dir failure
deployment 5 Preview | jq -s . > "$FIXTURE/deployments.json"
status failure | jq -s . > "$FIXTURE/statuses-5.json"
TIMEOUT=30 wait_deploy "$SHA"
[ "$CODE" = 1 ] || fail failure "thoát $CODE, cần 1"
grep -qF 'deployment Vercel của 0123456 là failure' "$TMP/out" || fail failure "không nêu failure"
[ "$(cat "$FIXTURE/statuses-5.count")" = 1 ] || fail failure "vẫn chờ sau failure"
echo "ok failure"

# timeout: còn pending khi hết hạn → 1.
case_dir timeout
deployment 5 Preview | jq -s . > "$FIXTURE/deployments.json"
status in_progress | jq -s . > "$FIXTURE/statuses-5.json"
TIMEOUT=1 wait_deploy "$SHA"
[ "$CODE" = 1 ] || fail timeout "thoát $CODE, cần 1"
grep -qF 'quá hạn chờ 1 giây' "$TMP/out" || fail timeout "không nêu quá hạn"
echo "ok timeout"

# ignored: deployment Production, hay không do vercel[bot] tạo, hay status không do vercel[bot] → không dùng.
case_dir ignored
{ deployment 6 Production; deployment 7 Preview someone; deployment 8 Preview; } | jq -s . > "$FIXTURE/deployments.json"
status success https://next-store-iota-silk.vercel.app | jq -s . > "$FIXTURE/statuses-6.json"
status success "$URL" | jq -s . > "$FIXTURE/statuses-7.json"
status success "$URL" someone | jq -s . > "$FIXTURE/statuses-8.json"
TIMEOUT=1 wait_deploy "$SHA"
[ "$CODE" = 1 ] || fail ignored "thoát $CODE, cần 1"
! grep -qxF "$URL" "$TMP/out" || fail ignored "đã in URL của deployment / status không tin được"
echo "ok ignored"

# bad-url: environment_url ngoài allowlist → 1, không in URL.
case_dir bad-url
deployment 5 Preview | jq -s . > "$FIXTURE/deployments.json"
status success 'https://evil.example.com' | jq -s . > "$FIXTURE/statuses-5.json"
wait_deploy "$SHA"
[ "$CODE" = 1 ] || fail bad-url "thoát $CODE, cần 1"
! grep -qF 'evil.example.com' "$TMP/out" || fail bad-url "in giá trị không tin được"
echo "ok bad-url"

# dev-url: Dev domain cũng được nhận.
case_dir dev-url
deployment 5 Preview | jq -s . > "$FIXTURE/deployments.json"
status success https://next-store-dev-ginpham.vercel.app | jq -s . > "$FIXTURE/statuses-5.json"
wait_deploy "$SHA"
[ "$CODE" = 0 ] || fail dev-url "thoát $CODE, cần 0"
echo "ok dev-url"

# bad-args: sha sai dạng → 2, không gọi gh.
case_dir bad-args
wait_deploy abc
[ "$CODE" = 2 ] || fail bad-args "thoát $CODE, cần 2"
[ ! -s "$FIXTURE/calls" ] || fail bad-args "đã gọi gh"
echo "ok bad-args"

echo "wait-vercel-deploy.test.sh: mọi ca qua"
