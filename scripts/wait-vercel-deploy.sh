#!/usr/bin/env bash
# Chờ deployment Vercel (không phải Production) của đúng một commit thành công, rồi in URL của nó ra stdout (NS-111).
#
#   url=$(bash scripts/wait-vercel-deploy.sh <sha 40 ký tự>)
#
# Dùng cho release-smoke: head của PR release là đỉnh `develop`, và deployment Vercel của commit đó là bản Dev (cùng
# biến môi trường và Neon `preview/develop`; alias next-store-dev-ginpham.vercel.app trỏ tới bản `develop` mới nhất,
# nên URL riêng của deployment mới chắc chắn là đúng commit). Như preview-e2e.yml: deployment và status phải do
# vercel[bot] tạo (ai có quyền ghi cũng thêm được status), environment không chứa "production", URL thuộc allowlist
# của preview-e2e.yml. Giá trị không tin được không bao giờ được in.
#
# Biến: WAIT_DEPLOY_REPO (mặc định chinhpham208/next-store), WAIT_DEPLOY_TIMEOUT (giây, mặc định 1200),
# WAIT_DEPLOY_INTERVAL (giây, mặc định 20). Mã thoát: 0 = URL trên stdout, 1 = deploy lỗi / quá hạn, 2 = cách gọi sai.
set -euo pipefail

REPO=${WAIT_DEPLOY_REPO:-chinhpham208/next-store}
TIMEOUT=${WAIT_DEPLOY_TIMEOUT:-1200}
INTERVAL=${WAIT_DEPLOY_INTERVAL:-20}
SHA=${1:-}
log() { echo "wait-vercel-deploy: $*" >&2; }

[ $# = 1 ] && [[ $SHA =~ ^[0-9a-f]{40}$ ]] || { log "cần đúng một sha 40 ký tự hex"; exit 2; }
[[ $TIMEOUT =~ ^[0-9]{1,6}$ ]] && [[ $INTERVAL =~ ^[1-9][0-9]{0,4}$ ]] || { log "WAIT_DEPLOY_TIMEOUT / WAIT_DEPLOY_INTERVAL không hợp lệ"; exit 2; }
[[ $REPO =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] || { log "WAIT_DEPLOY_REPO không hợp lệ"; exit 2; }

# Same allowlist as preview-e2e.yml.
PREVIEW_RE='^https://next-store-[a-z0-9-]+-chinhpham208s-projects\.vercel\.app$'
DEV_RE='^https://next-store-dev-ginpham\.vercel\.app$'

start=$SECONDS
while :; do
  # Newest first by id: a redeploy of the same commit supersedes the earlier one.
  ids=$(gh api "repos/$REPO/deployments?sha=$SHA&per_page=100" | jq -r '
    map(select(.creator.login == "vercel[bot]" and (.environment | ascii_downcase | contains("production") | not)))
    | sort_by(-.id) | .[].id')
  state=none
  for id in $ids; do
    [[ $id =~ ^[0-9]+$ ]] || continue
    statuses=$(gh api "repos/$REPO/deployments/$id/statuses?per_page=100" | jq 'map(select(.creator.login == "vercel[bot]"))')
    # A success stays usable after a later `inactive` (a newer deployment of the branch): the URL is immutable.
    url=$(jq -r 'map(select(.state == "success")) | .[0].environment_url // empty' <<< "$statuses")
    if [ -n "$url" ]; then
      url=${url%/}
      if [[ $url =~ $PREVIEW_RE || $url =~ $DEV_RE ]]; then
        log "deployment $id của ${SHA:0:7} thành công"
        echo "$url"
        exit 0
      fi
      log "deployment $id của ${SHA:0:7}: environment_url không thuộc preview của next-store hay Dev; không dùng"
      exit 1
    fi
    state=$(jq -r '.[0].state // "pending"' <<< "$statuses")
    case $state in
      failure | error) log "deployment Vercel của ${SHA:0:7} là $state"; exit 1 ;;
    esac
    break
  done
  elapsed=$((SECONDS - start))
  if [ "$elapsed" -ge "$TIMEOUT" ]; then
    log "quá hạn chờ $TIMEOUT giây: deployment Vercel của ${SHA:0:7} chưa thành công (trạng thái: $(tr -cd 'a-z_' <<< "$state"))"
    exit 1
  fi
  log "đang chờ deployment Vercel của ${SHA:0:7} ($elapsed/$TIMEOUT giây, trạng thái: $(tr -cd 'a-z_' <<< "$state"))"
  sleep "$INTERVAL"
done
