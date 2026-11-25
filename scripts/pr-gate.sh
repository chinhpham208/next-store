#!/usr/bin/env bash
# Cổng trước khi merge (NS-111): Orchestrator chỉ merge một PR khi lệnh này thoát 0.
#
#   bash scripts/pr-gate.sh <số PR>
#
# Đọc PR và head sha qua REST (`gh api`, chỉ đọc), chờ mọi check-run và commit status của head sha xong, rồi chỉ cho
# qua khi:
#   - commit status `Vercel` = success (preview / Dev deploy được);
#   - check-run `check` = success (ci.yml) và check-run `e2e-preview` = success (preview-e2e.yml);
#   - PR vào `production` (release): thêm check-run `release-smoke` = success (release-gate.yml);
#   - không check-run nào khác kết thúc failure / timed_out / action_required / startup_failure, không commit status
#     nào khác failure / error;
#   - PR đang mở thì `mergeable == true`.
# skipped, neutral, cancelled, thiếu, hay còn chạy khi hết hạn đều là CHẶN. NS-111: #87 và #89 được merge khi preview
# Vercel fail, vì e2e-preview chỉ chạy khi deployment_status = success nên hiện ra là skipped.
# preview-e2e.yml không có điều kiện bỏ qua chủ ý nào (không lọc đường dẫn: PR chỉ đổi docs vẫn deploy và vẫn chạy
# e2e-preview), nên không có ngoại lệ nào cho e2e-preview skipped.
# Mỗi tên check lấy lần chạy mới nhất (id lớn nhất), nên một lần chạy lại xanh thay cho lần trước.
# PR đã merge thì chỉ kiểm lại các check (mergeable không còn ý nghĩa); PR đóng mà không merge thì chặn.
#
# Biến tuỳ chọn:
#   PR_GATE_REPO      owner/repo (mặc định chinhpham208/next-store)
#   PR_GATE_TIMEOUT   số giây chờ tối đa (mặc định 1200 = 20 phút)
#   PR_GATE_INTERVAL  số giây giữa hai lần đọc (mặc định 30)
#
# Mã thoát: 0 = qua, 1 = chặn, 2 = cách gọi sai hoặc không đọc được GitHub.
set -euo pipefail

REPO=${PR_GATE_REPO:-chinhpham208/next-store}
TIMEOUT=${PR_GATE_TIMEOUT:-1200}
INTERVAL=${PR_GATE_INTERVAL:-30}

usage() { echo "pr-gate: $*" >&2; echo "Dùng: bash scripts/pr-gate.sh <số PR>" >&2; exit 2; }

[ $# = 1 ] || usage "cần đúng một tham số"
[[ $1 =~ ^[1-9][0-9]{0,6}$ ]] || usage "số PR không hợp lệ"
[[ $TIMEOUT =~ ^[0-9]{1,6}$ ]] || usage "PR_GATE_TIMEOUT không hợp lệ: cần số giây"
[[ $INTERVAL =~ ^[1-9][0-9]{0,4}$ ]] || usage "PR_GATE_INTERVAL không hợp lệ: cần số giây ≥ 1"
[[ $REPO =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] || usage "PR_GATE_REPO không hợp lệ"
command -v jq > /dev/null || { echo "pr-gate: cần jq" >&2; exit 2; }
PR=$1

api() { gh api "$1"; }

# One verdict per line: `wait <lý do>` (còn chờ được), `block <lý do>` (chắc chắn chặn, không chờ nữa) or
# `ok <điều đã kiểm>`. Input: {pr, runs, status, required}.
# shellcheck disable=SC2016 # jq program, not shell
VERDICT='
  def bad_run: . as $c | ["failure", "timed_out", "action_required", "startup_failure"] | index($c);
  .pr as $pr
  | (.runs.check_runs | group_by(.name) | map(max_by(.id)) | INDEX(.name)) as $runs
  | (.status.statuses | INDEX(.context)) as $statuses
  | (if $pr.merged == true then "note PR đã merge: chỉ kiểm lại check, không kiểm mergeable"
     elif $pr.state != "open" then "block PR đã đóng mà không merge"
     elif $pr.mergeable == true then "ok PR merge được (mergeable = true)"
     elif $pr.mergeable == false then "block PR không merge được (mergeable = false)"
     else "wait GitHub chưa tính xong mergeable" end),
    (($statuses.Vercel // null) as $v
     | if $v == null then "wait thiếu commit status Vercel"
       elif $v.state == "success" then "ok commit status Vercel là success"
       elif $v.state == "pending" then "wait commit status Vercel chưa xong (pending)"
       else "block commit status Vercel là \($v.state), cần success" end),
    (.required[] as $name | ($runs[$name] // null) as $r
     | if $r == null then "wait thiếu check-run \($name)"
       elif $r.status != "completed" then "wait check-run \($name) chưa xong (\($r.status))"
       elif $r.conclusion == "success" then "ok check-run \($name) là success"
       else "block check-run \($name) là \($r.conclusion), cần success" end),
    ($runs | to_entries[] | .value | select(.name as $n | $required | index($n) | not)
     | if .status != "completed" then "wait check-run \(.name) chưa xong (\(.status))"
       elif (.conclusion | bad_run) then "block check-run \(.name) là \(.conclusion)"
       else empty end),
    ($statuses | to_entries[] | .value | select(.context != "Vercel")
     | if .state == "pending" then "wait commit status \(.context) chưa xong (pending)"
       elif .state == "success" then empty
       else "block commit status \(.context) là \(.state)" end)
'

pr_json=$(api "repos/$REPO/pulls/$PR") || { echo "pr-gate: không đọc được PR #$PR qua REST" >&2; exit 2; }
SHA=$(jq -r '.head.sha // empty' <<< "$pr_json")
BASE=$(jq -r '.base.ref // empty' <<< "$pr_json")
[[ $SHA =~ ^[0-9a-f]{40}$ ]] && [[ $BASE =~ ^[A-Za-z0-9._/-]+$ ]] || { echo "pr-gate: PR #$PR không có head sha / base hợp lệ" >&2; exit 2; }
REQUIRED=(check e2e-preview)
if [ "$BASE" = production ]; then REQUIRED+=(release-smoke); fi
echo "pr-gate: PR #$PR (head ${SHA:0:7}, base $BASE); cần: Vercel ${REQUIRED[*]}; chờ tối đa $TIMEOUT giây"

start=$SECONDS
while :; do
  runs_json=$(api "repos/$REPO/commits/$SHA/check-runs?per_page=100") || { echo "pr-gate: không đọc được check-runs của ${SHA:0:7}" >&2; exit 2; }
  status_json=$(api "repos/$REPO/commits/$SHA/status") || { echo "pr-gate: không đọc được commit status của ${SHA:0:7}" >&2; exit 2; }
  required_json=$(printf '%s\n' "${REQUIRED[@]}" | jq -R . | jq -s .)
  verdict=$(jq -rn --argjson pr "$pr_json" --argjson runs "$runs_json" --argjson status "$status_json" \
    --argjson required "$required_json" '{pr: $pr, runs: $runs, status: $status, required: $required}' |
    jq -r --argjson required "$required_json" "$VERDICT") || { echo "pr-gate: dữ liệu REST không đúng dạng" >&2; exit 2; }

  if grep -q '^block ' <<< "$verdict"; then break; fi
  if ! grep -q '^wait ' <<< "$verdict"; then break; fi
  elapsed=$((SECONDS - start))
  if [ "$elapsed" -ge "$TIMEOUT" ]; then
    # shellcheck disable=SC2001 # per line, on a multi-line value
    verdict=$(sed 's/^wait /block /' <<< "$verdict")
    echo "pr-gate: quá hạn chờ $TIMEOUT giây"
    break
  fi
  echo "pr-gate: đang chờ ($elapsed/$TIMEOUT giây): $(sed -n 's/^wait //p' <<< "$verdict" | paste -sd ';' - | sed 's/;/; /g')"
  sleep "$INTERVAL"
  pr_json=$(api "repos/$REPO/pulls/$PR") || { echo "pr-gate: không đọc được PR #$PR qua REST" >&2; exit 2; }
  if [ "$(jq -r '.head.sha' <<< "$pr_json")" != "$SHA" ]; then
    echo "pr-gate: CHẶN PR #$PR: head đổi trong lúc chờ (có commit mới); chạy lại pr-gate" >&2
    exit 1
  fi
done

sed -n 's/^ok /pr-gate: ok: /p; s/^note /pr-gate: ghi chú: /p' <<< "$verdict"
if grep -q '^block ' <<< "$verdict"; then
  sed -n 's/^block /pr-gate: CHẶN: /p' <<< "$verdict"
  echo "pr-gate: CHẶN PR #$PR: không merge (skipped / neutral / cancelled / thiếu / quá hạn đều không phải qua)"
  exit 1
fi
echo "pr-gate: QUA PR #$PR (head ${SHA:0:7})"
