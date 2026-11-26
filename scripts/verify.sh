#!/usr/bin/env bash
# Chạy kiểm tra của next-store, chịu được giới hạn ~180 giây mỗi lệnh shell của agent.
#
#   bash scripts/verify.sh quick   # typecheck, lint, check:deps, unit test
#   bash scripts/verify.sh full    # quick + build + check:bundle + smoke + e2e (nếu đã có)
#   bash scripts/verify.sh wait    # đợi tiếp lần chạy đang dở
#
# Chạy nền, ghi log vào .verify/<thời gian>.log. Mỗi lần gọi đợi tối đa VERIFY_WAIT giây (mặc định 160).
# Mã thoát: 0 = qua, 1 = lỗi, 2 = cách gọi / cổng sai, 3 = vẫn đang chạy (gọi lại `verify.sh wait`).
#
# Cổng: E2E_PORT (dùng E2E_PORT … E2E_PORT+4) và SMOKE_PORT; chỉ đặt một biến thì biến kia lấy cùng giá trị,
# không đặt gì thì 3100. Cổng đang bận bởi tiến trình khác → dừng với lỗi, không tắt hộ.
set -uo pipefail
cd "$(dirname "$0")/.."

STATE_DIR=.verify
mkdir -p "$STATE_DIR"
WAIT=${VERIFY_WAIT:-160}
# Ports (process.md §4: a second worktree runs on other ports). One base: setting only E2E_PORT or only
# SMOKE_PORT moves both, so a run never lands on another worktree's 3100 by default (audit PR #38 M2). Smoke and
# e2e run one after the other, so they may share the base. E2E uses five ports (playwright.config.ts): the app,
# a server with a dead database (M2 Task 15), a server whose database hangs, the silent listener (NS-55), and a
# server whose database answers slowly, like Neon from a far edge (NS-109; the proxy must not wait on it, ADR-0017).
port_ok() { [[ $1 =~ ^[0-9]{1,5}$ ]] && [ "$((10#$1))" -ge 1 ] && [ "$((10#$1))" -le "$2" ]; }

resolve_ports() {
  local e2e=${E2E_PORT:-} smoke=${SMOKE_PORT:-}
  [ -n "$e2e" ] || e2e=${smoke:-3100}
  [ -n "$smoke" ] || smoke=$e2e
  port_ok "$e2e" 65531 || { echo "verify: E2E_PORT không hợp lệ: cần số nguyên 1–65531 (dùng E2E_PORT … E2E_PORT+4)." >&2; return 1; }
  port_ok "$smoke" 65535 || { echo "verify: SMOKE_PORT không hợp lệ: cần số nguyên 1–65535." >&2; return 1; }
  # Base 10 and exported normalised: Playwright reads `08` as 8, bash arithmetic would read it as octal.
  export E2E_PORT=$((10#$e2e)) SMOKE_PORT=$((10#$smoke))
  E2E_PORTS=("$E2E_PORT" "$((E2E_PORT + 1))" "$((E2E_PORT + 2))" "$((E2E_PORT + 3))" "$((E2E_PORT + 4))")
}

has_script() { node -e "process.exit(require('./package.json').scripts?.['$1'] ? 0 : 1)" 2>/dev/null; }

run_step() {
  local name=$1; shift
  echo "::step $name"
  if "$@"; then echo "::pass $name"; else echo "::fail $name"; return 1; fi
}

# Only processes this run started are ever killed (audit PR #38 M2): smoke and e2e each run in their own
# process group, recorded in OWN_GROUP_FILE, and the whole group is stopped when the step ends — including a
# `next start` left behind by a crashed Playwright. A port held by anything else is refused, never killed: it
# may be another worktree's server.
OWN_GROUP_FILE=${VERIFY_OWN_GROUP_FILE:-$STATE_DIR/step.pgid}

# A recorded group counts as ours only while one of its processes still runs in this worktree, so a reused
# process-group id of an unrelated program is never signalled.
group_is_ours() {
  local pid
  for pid in $(pgrep -g "$1" 2>/dev/null); do
    [ "$(readlink "/proc/$pid/cwd" 2>/dev/null)" = "$PWD" ] && return 0
  done
  return 1
}

stop_own_group() {
  [ -f "$OWN_GROUP_FILE" ] || return 0
  local pgid; pgid=$(cat "$OWN_GROUP_FILE"); rm -f "$OWN_GROUP_FILE"
  [[ $pgid =~ ^[0-9]+$ ]] && group_is_ours "$pgid" || return 0
  kill -TERM -- "-$pgid" 2>/dev/null || return 0
  local waited=0
  while pgrep -g "$pgid" >/dev/null 2>&1 && [ $waited -lt 10 ]; do sleep 1; waited=$((waited + 1)); done
  kill -KILL -- "-$pgid" 2>/dev/null || true
}

# Job control gives the background job its own process group whose id is its pid.
in_own_group() {
  local pid rc
  set -m
  "$@" &
  pid=$!
  set +m
  echo "$pid" > "$OWN_GROUP_FILE"
  wait "$pid"; rc=$?
  stop_own_group
  return $rc
}

port_in_use() { (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; }

ports_free() {
  local port busy=()
  for port in "$SMOKE_PORT" "${E2E_PORTS[@]}"; do port_in_use "$port" && busy+=("$port"); done
  [ ${#busy[@]} -eq 0 ] && return 0
  echo "verify: cổng ${busy[*]} đang bận bởi tiến trình không do lần chạy này tạo; không tắt hộ." >&2
  echo "verify: chờ nó xong hoặc đặt E2E_PORT / SMOKE_PORT khác." >&2
  return 1
}

pipeline() {
  local mode=$1
  local steps=(typecheck lint check:deps test)
  # check:bundle right after build: reads .next (audit PR #108 M-1, scripts/check-admin-bundle.mjs).
  [ "$mode" = full ] && steps+=(build check:bundle smoke e2e)
  for s in "${steps[@]}"; do
    if ! has_script "$s"; then echo "::skip $s (chưa có script)"; continue; fi
    if [ "$s" = smoke ] || [ "$s" = e2e ]; then
      stop_own_group
      ports_free || { echo "::fail $s"; return 1; }
      run_step "$s" in_own_group npm run -s "$s" || {
        echo "::retry $s"
        ports_free || { echo "::fail $s"; return 1; }
        run_step "$s" in_own_group npm run -s "$s" || return 1
      }
    else
      run_step "$s" npm run -s "$s" || return 1
    fi
  done
}

start() {
  if [ -f "$STATE_DIR/pid" ] && kill -0 "$(cat "$STATE_DIR/pid")" 2>/dev/null; then
    echo "Đang có lần chạy dở. Dùng: bash scripts/verify.sh wait"; exit 1
  fi
  local log="$PWD/$STATE_DIR/$(date +%Y%m%d-%H%M%S)-$1.log"
  ln -sf "$(basename "$log")" "$STATE_DIR/latest.log"
  rm -f "$STATE_DIR/exit"
  # setsid + nohup: tiến trình nền sống sót khi lệnh shell của agent kết thúc
  setsid nohup bash "$0" __run "$1" "$log" > /dev/null 2>&1 < /dev/null &
  echo $! > "$STATE_DIR/pid"
  echo "Log: $log"
}

wait_result() {
  local waited=0
  while [ ! -f "$STATE_DIR/exit" ] && [ $waited -lt "$WAIT" ]; do sleep 2; waited=$((waited + 2)); done
  grep -E '^::(pass|fail|skip|retry)' "$STATE_DIR/latest.log" 2>/dev/null
  if [ ! -f "$STATE_DIR/exit" ]; then echo "VẪN ĐANG CHẠY — gọi lại: bash scripts/verify.sh wait"; exit 3; fi
  local code; code=$(cat "$STATE_DIR/exit")
  if [ "$code" != 0 ]; then echo "--- 60 dòng cuối log ---"; tail -n 60 "$STATE_DIR/latest.log"; echo "KẾT QUẢ: LỖI"; exit 1; fi
  echo "KẾT QUẢ: QUA ($(readlink "$STATE_DIR/latest.log"))"; exit 0
}

resolve_ports || exit 2

# Admin area for the local servers of smoke and e2e (ADR-0018, plan M5 Task 7): fresh fake values for every run,
# never printed and never written to a file. playwright.config.ts hands them to its server; the specs log in with
# E2E_ADMIN_PASSWORD (Task 14). Exported only into the background run, so the developer's shell keeps its own.
admin_env() {
  local password secret
  password=$(node -e "process.stdout.write(require('crypto').randomBytes(24).toString('base64'))") || return 1
  secret=$(node -e "process.stdout.write(require('crypto').randomBytes(32).toString('base64'))") || return 1
  export ADMIN_PASSWORD=$password SESSION_SECRET=$secret E2E_ADMIN_PASSWORD=$password E2E_SESSION_SECRET=$secret
}

case "${1:-}" in
  __run) { admin_env && pipeline "$2"; } > "$3" 2>&1; echo $? > "$STATE_DIR/exit" ;;
  # Test hooks for scripts/verify.test.sh.
  __ports) echo "SMOKE_PORT=$SMOKE_PORT E2E_PORTS=${E2E_PORTS[*]}" ;;
  # Lengths and equalities only, never the values.
  __admin-env) admin_env && node -e "const e = process.env; console.log([e.ADMIN_PASSWORD.length, e.SESSION_SECRET.length, e.ADMIN_PASSWORD === e.E2E_ADMIN_PASSWORD, e.SESSION_SECRET === e.E2E_SESSION_SECRET, e.ADMIN_PASSWORD !== e.SESSION_SECRET].join(' '))" ;;
  __ports-free) ports_free ;;
  __own) shift; in_own_group "$@" ;;
  __stop-stale) stop_own_group ;;
  quick|full) start "$1"; wait_result ;;
  wait) wait_result ;;
  *) echo "Dùng: bash scripts/verify.sh quick|full|wait"; exit 2 ;;
esac
