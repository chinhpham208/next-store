#!/usr/bin/env bash
# Kiểm cổng và việc dọn tiến trình của scripts/verify.sh (audit PR #38 M2). Không cần bản build, không ra mạng.
#
#   bash scripts/verify.test.sh
set -euo pipefail
cd "$(dirname "$0")/.."

TMP=$(mktemp -d)
PIDS=()
cleanup() {
  local pid
  for pid in "${PIDS[@]+"${PIDS[@]}"}"; do kill "$pid" 2>/dev/null || true; done
  rm -rf "$TMP"
}
trap cleanup EXIT
export VERIFY_OWN_GROUP_FILE=$TMP/step.pgid
FAILED=0

check() {
  local name=$1 expected=$2 actual=$3
  if [ "$actual" = "$expected" ]; then echo "ok   $name"; else echo "FAIL $name: mong '$expected', được '$actual'"; FAILED=1; fi
}
ports() { env -u E2E_PORT -u SMOKE_PORT "$@" bash scripts/verify.sh __ports 2>/dev/null || echo "exit $?"; }

check 'default-3100' 'SMOKE_PORT=3100 E2E_PORTS=3100 3101 3102 3103' "$(ports)"
check 'e2e-only-moves-smoke' 'SMOKE_PORT=3200 E2E_PORTS=3200 3201 3202 3203' "$(ports E2E_PORT=3200)"
check 'smoke-only-moves-e2e' 'SMOKE_PORT=3300 E2E_PORTS=3300 3301 3302 3303' "$(ports SMOKE_PORT=3300)"
check 'both-set' 'SMOKE_PORT=3570 E2E_PORTS=3560 3561 3562 3563' "$(ports SMOKE_PORT=3570 E2E_PORT=3560)"
check 'leading-zero-is-decimal' 'SMOKE_PORT=8 E2E_PORTS=8 9 10 11' "$(ports E2E_PORT=08)"
check 'e2e-top-of-range' 'SMOKE_PORT=65532 E2E_PORTS=65532 65533 65534 65535' "$(ports E2E_PORT=65532)"
check 'e2e-past-range' 'exit 2' "$(ports E2E_PORT=65533)"
check 'e2e-not-a-number' 'exit 2' "$(ports E2E_PORT=31a0)"
check 'e2e-zero' 'exit 2' "$(ports E2E_PORT=0)"
check 'smoke-too-long' 'exit 2' "$(ports SMOKE_PORT=310000)"

# A port held by someone else is refused and left running.
BUSY=3189
node -e "require('net').createServer(() => {}).listen($BUSY, '127.0.0.1')" &
PIDS+=($!)
for _ in $(seq 1 50); do (exec 3<>"/dev/tcp/127.0.0.1/$BUSY") 2>/dev/null && break; sleep 0.1; done
rc=0; E2E_PORT=$((BUSY - 2)) SMOKE_PORT=3180 bash scripts/verify.sh __ports-free 2>"$TMP/busy.err" || rc=$?
check 'busy-port-refused' '1' "$rc"
check 'busy-port-named' '1' "$(grep -c "cổng $BUSY đang bận" "$TMP/busy.err")"
check 'foreign-listener-alive' 'alive' "$(kill -0 "${PIDS[0]}" 2>/dev/null && echo alive || echo dead)"

# Whatever the step leaves behind in its own group is stopped when it ends; its exit code is kept.
rc=0; bash scripts/verify.sh __own bash -c "sleep 300 & echo \$! > '$TMP/child'; exit 7" || rc=$?
check 'own-exit-code' '7' "$rc"
child=$(cat "$TMP/child")
for _ in $(seq 1 20); do kill -0 "$child" 2>/dev/null || break; sleep 0.2; done
check 'own-leftover-stopped' 'dead' "$(kill -0 "$child" 2>/dev/null && echo alive || echo dead)"
check 'own-group-file-removed' 'gone' "$([ -f "$VERIFY_OWN_GROUP_FILE" ] && echo present || echo gone)"

# A group left by an aborted run of this worktree is stopped before the next step; a recorded id whose processes
# run elsewhere (the id was reused by an unrelated program) is never signalled.
setsid sleep 300 &
ours=$!
PIDS+=($ours)
(cd /tmp && exec setsid sleep 300) &
foreign=$!
PIDS+=($foreign)
sleep 0.3
echo "$ours" > "$VERIFY_OWN_GROUP_FILE"
bash scripts/verify.sh __stop-stale
for _ in $(seq 1 20); do kill -0 "$ours" 2>/dev/null || break; sleep 0.2; done
check 'stale-own-group-stopped' 'dead' "$(kill -0 "$ours" 2>/dev/null && echo alive || echo dead)"
echo "$foreign" > "$VERIFY_OWN_GROUP_FILE"
bash scripts/verify.sh __stop-stale
check 'stale-foreign-group-untouched' 'alive' "$(kill -0 "$foreign" 2>/dev/null && echo alive || echo dead)"

exit $FAILED
