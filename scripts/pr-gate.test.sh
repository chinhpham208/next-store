#!/usr/bin/env bash
# Kiểm scripts/pr-gate.sh (NS-111). Không ra mạng: một `gh` giả đứng trước PATH trả JSON giả cho từng đường dẫn REST.
#
#   bash scripts/pr-gate.test.sh
#
# Mỗi ca dựng một thư mục fixture: pr.json (GET pulls/<n>), runs.json (check-runs của head sha), status.json (commit
# status tổng hợp). Một file <tên>.<k>.json, nếu có, được trả ở lần gọi thứ k tới đường dẫn đó (lần sau cùng lặp lại),
# để giả lập check đang chạy rồi xong.
set -euo pipefail
cd "$(dirname "$0")/.."

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
SHA=0123456789abcdef0123456789abcdef01234567

fail() { echo "FAIL $1: $2" >&2; [ -f "$TMP/out" ] && sed 's/^/  | /' "$TMP/out" >&2; exit 1; }

mkdir -p "$TMP/bin"
cat > "$TMP/bin/gh" <<'EOF'
#!/usr/bin/env bash
# gh api <path>: chỉ hỗ trợ đúng cách pr-gate.sh gọi; mọi cách gọi khác là lỗi để test thấy.
printf '%s\n' "$*" >> "$FIXTURE/calls"
[ "$1" = api ] && [ $# = 2 ] || { echo "gh giả: cách gọi lạ: $*" >&2; exit 64; }
case $2 in
  repos/chinhpham208/next-store/pulls/*) name=pr ;;
  repos/chinhpham208/next-store/commits/*/check-runs\?per_page=100) name=runs ;;
  repos/chinhpham208/next-store/commits/*/status) name=status ;;
  *) echo "gh giả: đường dẫn lạ: $2" >&2; exit 64 ;;
esac
count=$(( $(cat "$FIXTURE/$name.count" 2>/dev/null || echo 0) + 1 ))
echo "$count" > "$FIXTURE/$name.count"
file=$FIXTURE/$name.json
k=$count
while [ "$k" -ge 1 ]; do
  if [ -f "$FIXTURE/$name.$k.json" ]; then file=$FIXTURE/$name.$k.json; break; fi
  k=$((k - 1))
done
[ -f "$file" ] || { echo "gh giả: thiếu $file" >&2; exit 64; }
cat "$file"
EOF
chmod +x "$TMP/bin/gh"

# pr <base> <mergeable: true|false|null> [state] [merged]
pr() { jq -n --arg sha "$SHA" --arg base "$1" --argjson m "$2" --arg state "${3:-open}" --argjson merged "${4:-false}" \
  '{number: 7, state: $state, merged: $merged, mergeable: $m, head: {sha: $sha, ref: "NS-1-x"}, base: {ref: $base}}'; }
# run <id> <name> <status> <conclusion|null>
run() { jq -n --argjson id "$1" --arg name "$2" --arg status "$3" --argjson c "$4" \
  '{id: $id, name: $name, status: $status, conclusion: $c, app: {slug: "github-actions"}}'; }
runs() { jq -s '{total_count: length, check_runs: .}'; }
# status <context> <state> ... (cặp)
status() {
  local items=()
  while [ $# -ge 2 ]; do items+=("$(jq -n --arg c "$1" --arg s "$2" '{context: $c, state: $s, description: "mô tả"}')"); shift 2; done
  printf '%s\n' "${items[@]+"${items[@]}"}" | jq -s '{state: (if length == 0 then "pending" else .[0].state end), statuses: .}'
}
green_runs() {
  { run 10 check completed '"success"'; run 11 e2e-preview completed '"success"'; run 12 production-e2e completed '"skipped"'; } | runs
}

# case_dir <name>: a fresh fixture directory, exported as FIXTURE.
case_dir() { FIXTURE=$TMP/$1; mkdir -p "$FIXTURE"; export FIXTURE; }
gate() { # gate <args...>: chạy pr-gate với timeout ngắn; CODE = mã thoát, output ở $TMP/out
  CODE=0
  env PATH="$TMP/bin:$PATH" PR_GATE_TIMEOUT="${GATE_TIMEOUT:-3}" PR_GATE_INTERVAL=1 bash scripts/pr-gate.sh "$@" > "$TMP/out" 2>&1 || CODE=$?
}

# vercel-failure-e2e-skipped: đúng ca #87 / #89. Preview Vercel fail nên e2e-preview bị skipped; check xanh.
case_dir vercel-failure
pr develop true > "$FIXTURE/pr.json"
{ run 10 check completed '"success"'; run 11 e2e-preview completed '"skipped"'; run 12 production-e2e completed '"skipped"'; } | runs > "$FIXTURE/runs.json"
status Vercel failure > "$FIXTURE/status.json"
gate 7
[ "$CODE" = 1 ] || fail vercel-failure-e2e-skipped "thoát $CODE, cần 1"
grep -qF 'commit status Vercel là failure, cần success' "$TMP/out" || fail vercel-failure-e2e-skipped "không nêu Vercel failure"
grep -qF 'check-run e2e-preview là skipped, cần success' "$TMP/out" || fail vercel-failure-e2e-skipped "không nêu e2e-preview skipped"
grep -qF 'pr-gate: CHẶN PR #7' "$TMP/out" || fail vercel-failure-e2e-skipped "không có dòng kết luận CHẶN"
echo "ok vercel-failure-e2e-skipped"

# all-green: mọi check success, mergeable → qua. production-e2e skipped (check khác) không chặn.
case_dir all-green
pr develop true > "$FIXTURE/pr.json"
green_runs > "$FIXTURE/runs.json"
status Vercel success > "$FIXTURE/status.json"
gate 7
[ "$CODE" = 0 ] || fail all-green "thoát $CODE, cần 0"
grep -qF 'pr-gate: QUA PR #7' "$TMP/out" || fail all-green "không có dòng QUA"
grep -qF "head ${SHA:0:7}" "$TMP/out" || fail all-green "không in head sha"
echo "ok all-green"

# pending-timeout: e2e-preview vẫn chạy khi hết hạn → chặn, nêu check còn dở.
case_dir pending-timeout
pr develop true > "$FIXTURE/pr.json"
{ run 10 check completed '"success"'; run 11 e2e-preview in_progress null; } | runs > "$FIXTURE/runs.json"
status Vercel success > "$FIXTURE/status.json"
GATE_TIMEOUT=2 gate 7
[ "$CODE" = 1 ] || fail pending-timeout "thoát $CODE, cần 1"
grep -qF 'quá hạn chờ 2 giây' "$TMP/out" || fail pending-timeout "không nêu quá hạn"
grep -qF 'check-run e2e-preview chưa xong (in_progress)' "$TMP/out" || fail pending-timeout "không nêu e2e-preview còn dở"
[ "$(grep -c 'check-runs' "$FIXTURE/calls")" -ge 2 ] || fail pending-timeout "không poll lại"
echo "ok pending-timeout"

# pending-status-timeout: commit status Vercel còn pending (đang build) khi hết hạn → chặn.
case_dir pending-status
pr develop true > "$FIXTURE/pr.json"
green_runs > "$FIXTURE/runs.json"
status Vercel pending > "$FIXTURE/status.json"
GATE_TIMEOUT=1 gate 7
[ "$CODE" = 1 ] || fail pending-status-timeout "thoát $CODE, cần 1"
grep -qF 'commit status Vercel chưa xong (pending)' "$TMP/out" || fail pending-status-timeout "không nêu Vercel pending"
echo "ok pending-status-timeout"

# missing-vercel: không có commit status Vercel (chưa từng deploy) → chờ rồi chặn, nêu thiếu.
case_dir missing-vercel
pr develop true > "$FIXTURE/pr.json"
green_runs > "$FIXTURE/runs.json"
status > "$FIXTURE/status.json"
GATE_TIMEOUT=1 gate 7
[ "$CODE" = 1 ] || fail missing-vercel "thoát $CODE, cần 1"
grep -qF 'thiếu commit status Vercel' "$TMP/out" || fail missing-vercel "không nêu thiếu Vercel"
echo "ok missing-vercel"

# missing-e2e: không có check-run e2e-preview → chặn.
case_dir missing-e2e
pr develop true > "$FIXTURE/pr.json"
run 10 check completed '"success"' | runs > "$FIXTURE/runs.json"
status Vercel success > "$FIXTURE/status.json"
GATE_TIMEOUT=1 gate 7
[ "$CODE" = 1 ] || fail missing-e2e "thoát $CODE, cần 1"
grep -qF 'thiếu check-run e2e-preview' "$TMP/out" || fail missing-e2e "không nêu thiếu e2e-preview"
echo "ok missing-e2e"

# pending-then-green: lần đầu còn chạy, lần sau xong xanh → chờ rồi qua.
case_dir pending-then-green
pr develop true > "$FIXTURE/pr.json"
{ run 10 check completed '"success"'; run 11 e2e-preview queued null; } | runs > "$FIXTURE/runs.1.json"
green_runs > "$FIXTURE/runs.2.json"
status Vercel pending > "$FIXTURE/status.1.json"
status Vercel success > "$FIXTURE/status.2.json"
GATE_TIMEOUT=10 gate 7
[ "$CODE" = 0 ] || fail pending-then-green "thoát $CODE, cần 0"
grep -qF 'đang chờ' "$TMP/out" || fail pending-then-green "không in trạng thái chờ"
echo "ok pending-then-green"

# neutral / cancelled e2e-preview: không phải success → chặn.
for c in neutral cancelled; do
  case_dir "e2e-$c"
  pr develop true > "$FIXTURE/pr.json"
  { run 10 check completed '"success"'; run 11 e2e-preview completed "\"$c\""; } | runs > "$FIXTURE/runs.json"
  status Vercel success > "$FIXTURE/status.json"
  gate 7
  [ "$CODE" = 1 ] || fail "e2e-$c" "thoát $CODE, cần 1"
  grep -qF "check-run e2e-preview là $c, cần success" "$TMP/out" || fail "e2e-$c" "không nêu $c"
  echo "ok e2e-$c"
done

# check-failure: check fail → chặn ngay, không chờ hết hạn (Vercel vẫn đang build).
case_dir check-failure
pr develop true > "$FIXTURE/pr.json"
{ run 10 check completed '"failure"'; run 11 e2e-preview queued null; } | runs > "$FIXTURE/runs.json"
status Vercel pending > "$FIXTURE/status.json"
GATE_TIMEOUT=30 gate 7
[ "$CODE" = 1 ] || fail check-failure "thoát $CODE, cần 1"
grep -qF 'check-run check là failure, cần success' "$TMP/out" || fail check-failure "không nêu check failure"
[ "$(cat "$FIXTURE/runs.count")" = 1 ] || fail check-failure "đã chờ dù có lỗi chắc chắn"
echo "ok check-failure"

# other-failure: một check-run khác (không bắt buộc) fail → chặn.
case_dir other-failure
pr develop true > "$FIXTURE/pr.json"
{ run 10 check completed '"success"'; run 11 e2e-preview completed '"success"'; run 13 'Vercel Preview Comments' completed '"failure"'; } | runs > "$FIXTURE/runs.json"
status Vercel success > "$FIXTURE/status.json"
gate 7
[ "$CODE" = 1 ] || fail other-failure "thoát $CODE, cần 1"
grep -qF 'check-run Vercel Preview Comments là failure' "$TMP/out" || fail other-failure "không nêu check khác"
echo "ok other-failure"

# rerun: lần chạy e2e-preview cũ fail, lần chạy lại (id lớn hơn) success → tính lần mới nhất, qua.
case_dir rerun
pr develop true > "$FIXTURE/pr.json"
{ run 10 check completed '"success"'; run 11 e2e-preview completed '"failure"'; run 14 e2e-preview completed '"success"'; } | runs > "$FIXTURE/runs.json"
status Vercel success > "$FIXTURE/status.json"
gate 7
[ "$CODE" = 0 ] || fail rerun "thoát $CODE, cần 0"
echo "ok rerun"

# not-mergeable: mergeable false (xung đột) → chặn.
case_dir not-mergeable
pr develop false > "$FIXTURE/pr.json"
green_runs > "$FIXTURE/runs.json"
status Vercel success > "$FIXTURE/status.json"
gate 7
[ "$CODE" = 1 ] || fail not-mergeable "thoát $CODE, cần 1"
grep -qF 'PR không merge được (mergeable = false)' "$TMP/out" || fail not-mergeable "không nêu mergeable"
echo "ok not-mergeable"

# mergeable-unknown: GitHub chưa tính xong (null) tới hết hạn → chặn.
case_dir mergeable-unknown
pr develop null > "$FIXTURE/pr.json"
green_runs > "$FIXTURE/runs.json"
status Vercel success > "$FIXTURE/status.json"
GATE_TIMEOUT=1 gate 7
[ "$CODE" = 1 ] || fail mergeable-unknown "thoát $CODE, cần 1"
grep -qF 'GitHub chưa tính xong mergeable' "$TMP/out" || fail mergeable-unknown "không nêu mergeable chưa tính"
echo "ok mergeable-unknown"

# merged: PR đã merge (mergeable null) chỉ được kiểm lại check; không đòi mergeable.
case_dir merged
pr develop null closed true > "$FIXTURE/pr.json"
green_runs > "$FIXTURE/runs.json"
status Vercel success > "$FIXTURE/status.json"
gate 7
[ "$CODE" = 0 ] || fail merged "thoát $CODE, cần 0"
grep -qF 'PR đã merge' "$TMP/out" || fail merged "không ghi chú PR đã merge"
echo "ok merged"

# closed: PR đóng mà không merge → chặn.
case_dir closed
pr develop null closed false > "$FIXTURE/pr.json"
green_runs > "$FIXTURE/runs.json"
status Vercel success > "$FIXTURE/status.json"
gate 7
[ "$CODE" = 1 ] || fail closed "thoát $CODE, cần 1"
grep -qF 'PR đã đóng mà không merge' "$TMP/out" || fail closed "không nêu PR đóng"
echo "ok closed"

# release-without-smoke: PR vào production cần release-smoke; thiếu → chặn.
case_dir release-missing
pr production true > "$FIXTURE/pr.json"
green_runs > "$FIXTURE/runs.json"
status Vercel success > "$FIXTURE/status.json"
GATE_TIMEOUT=1 gate 7
[ "$CODE" = 1 ] || fail release-without-smoke "thoát $CODE, cần 1"
grep -qF 'thiếu check-run release-smoke' "$TMP/out" || fail release-without-smoke "không nêu release-smoke"
echo "ok release-without-smoke"

# release-smoke-skipped: skipped không phải qua.
case_dir release-skipped
pr production true > "$FIXTURE/pr.json"
{ run 10 check completed '"success"'; run 11 e2e-preview completed '"success"'; run 15 release-smoke completed '"skipped"'; } | runs > "$FIXTURE/runs.json"
status Vercel success > "$FIXTURE/status.json"
gate 7
[ "$CODE" = 1 ] || fail release-smoke-skipped "thoát $CODE, cần 1"
grep -qF 'check-run release-smoke là skipped, cần success' "$TMP/out" || fail release-smoke-skipped "không nêu skipped"
echo "ok release-smoke-skipped"

# release-green: PR release với release-smoke success → qua.
case_dir release-green
pr production true > "$FIXTURE/pr.json"
{ run 10 check completed '"success"'; run 11 e2e-preview completed '"success"'; run 15 release-smoke completed '"success"'; } | runs > "$FIXTURE/runs.json"
status Vercel success > "$FIXTURE/status.json"
gate 7
[ "$CODE" = 0 ] || fail release-green "thoát $CODE, cần 0"
grep -qF 'release-smoke' "$TMP/out" || fail release-green "không nêu release-smoke đã kiểm"
echo "ok release-green"

# develop-ignores-release-smoke: PR vào develop không cần release-smoke.
case_dir develop-no-release
pr develop true > "$FIXTURE/pr.json"
green_runs > "$FIXTURE/runs.json"
status Vercel success > "$FIXTURE/status.json"
gate 7
[ "$CODE" = 0 ] || fail develop-ignores-release-smoke "thoát $CODE, cần 0"
echo "ok develop-ignores-release-smoke"

# other-status-error: một commit status khác error → chặn.
case_dir other-status
pr develop true > "$FIXTURE/pr.json"
green_runs > "$FIXTURE/runs.json"
status Vercel success other-ci error > "$FIXTURE/status.json"
gate 7
[ "$CODE" = 1 ] || fail other-status-error "thoát $CODE, cần 1"
grep -qF 'commit status other-ci là error' "$TMP/out" || fail other-status-error "không nêu status khác"
echo "ok other-status-error"

# bad-args: số PR sai dạng hay timeout sai → thoát 2, không gọi gh.
for args in "" "abc" "7 8" "-1"; do
  case_dir "bad-args-${args// /_}"
  # shellcheck disable=SC2086 # tách tham số có chủ ý
  gate $args
  [ "$CODE" = 2 ] || fail bad-args "'$args': thoát $CODE, cần 2"
  [ ! -s "$FIXTURE/calls" ] || fail bad-args "'$args': đã gọi gh"
done
case_dir bad-timeout
CODE=0
env PATH="$TMP/bin:$PATH" PR_GATE_TIMEOUT=x bash scripts/pr-gate.sh 7 > "$TMP/out" 2>&1 || CODE=$?
[ "$CODE" = 2 ] || fail bad-args "PR_GATE_TIMEOUT=x: thoát $CODE, cần 2"
echo "ok bad-args"

# gh-error: REST lỗi (ví dụ 404) → thoát 2 với thông báo, không coi là qua.
case_dir gh-error
GATE_TIMEOUT=1 gate 7
[ "$CODE" = 2 ] || fail gh-error "thoát $CODE, cần 2"
grep -qF 'không đọc được PR #7' "$TMP/out" || fail gh-error "không nêu lỗi đọc PR"
echo "ok gh-error"

echo "pr-gate.test.sh: mọi ca qua"
