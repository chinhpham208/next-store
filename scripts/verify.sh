#!/usr/bin/env bash
# Chạy kiểm tra của next-store, chịu được giới hạn ~180 giây mỗi lệnh shell của agent.
#
#   bash scripts/verify.sh quick   # typecheck, lint, check:deps, unit test
#   bash scripts/verify.sh full    # quick + build + smoke + e2e (nếu đã có)
#   bash scripts/verify.sh wait    # đợi tiếp lần chạy đang dở
#
# Chạy nền, ghi log vào .verify/<thời gian>.log. Mỗi lần gọi đợi tối đa VERIFY_WAIT giây (mặc định 160).
# Mã thoát: 0 = qua, 1 = lỗi, 3 = vẫn đang chạy (gọi lại `verify.sh wait`).
set -uo pipefail
cd "$(dirname "$0")/.."

STATE_DIR=.verify
mkdir -p "$STATE_DIR"
WAIT=${VERIFY_WAIT:-160}
SMOKE_PORT=3100
# E2E also starts a second server with a dead database on the next port (playwright.config.ts, M2 Task 15).
BROKEN_DB_PORT=3101

has_script() { node -e "process.exit(require('./package.json').scripts?.['$1'] ? 0 : 1)" 2>/dev/null; }

run_step() {
  local name=$1; shift
  echo "::step $name"
  if "$@"; then echo "::pass $name"; else echo "::fail $name"; return 1; fi
}

free_port() { (command -v fuser >/dev/null && fuser -k "$SMOKE_PORT/tcp" "$BROKEN_DB_PORT/tcp" >/dev/null 2>&1) || true; }

pipeline() {
  local mode=$1
  local steps=(typecheck lint check:deps test)
  [ "$mode" = full ] && steps+=(build smoke e2e)
  for s in "${steps[@]}"; do
    if ! has_script "$s"; then echo "::skip $s (chưa có script)"; continue; fi
    if [ "$s" = smoke ] || [ "$s" = e2e ]; then
      free_port
      run_step "$s" npm run -s "$s" || { echo "::retry $s"; free_port; run_step "$s" npm run -s "$s" || return 1; }
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

case "${1:-}" in
  __run) pipeline "$2" > "$3" 2>&1; echo $? > "$STATE_DIR/exit" ;;
  quick|full) start "$1"; wait_result ;;
  wait) wait_result ;;
  *) echo "Dùng: bash scripts/verify.sh quick|full|wait"; exit 2 ;;
esac
