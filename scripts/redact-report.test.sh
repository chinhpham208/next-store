#!/usr/bin/env bash
# Kiểm scripts/redact-report.mjs (NS-54, audit PR #61 M1). Tái hiện lỗi thật: một request API tới origin có bypass
# fail, Playwright ghi header bypass (secret giả) vào report HTML; rồi che và kiểm. Không cần trình duyệt, không ra mạng.
#
#   bash scripts/redact-report.test.sh
set -euo pipefail
cd "$(dirname "$0")/.."

# Inside the repo, so the spec resolves @playwright/test and e2e/test.ts.
mkdir -p .verify
TMP=$(mktemp -d .verify/redact-test.XXXXXX)
trap 'rm -rf "$TMP"' EXIT
FAILED=0
SECRET=gia-NS54-secret_0123456789abcdef
REDACT=scripts/redact-report.mjs

check() {
  local name=$1 expected=$2 actual=$3
  if [ "$actual" = "$expected" ]; then echo "ok   $name"; else echo "FAIL $name: mong '$expected', được '$actual'"; FAILED=1; fi
}
run() { "$@" > /dev/null 2>&1 && echo "exit 0" || echo "exit $?"; }
has_secret() { grep -rqF -- "$2" "$1" && echo có || echo không; }
# The report data embedded in index.html: a zip, base64 in a data: URI. Python's zipfile checks every CRC.
embedded() {
  python3 - "$1" "$2" <<'PY'
import base64, io, re, sys, zipfile
html = open(sys.argv[1], encoding='utf-8').read()
data = base64.b64decode(re.search(r'data:application/zip;base64,([A-Za-z0-9+/=]+)', html).group(1))
archive = zipfile.ZipFile(io.BytesIO(data))
assert archive.testzip() is None
text = ''.join(archive.read(name).decode('utf-8') for name in archive.namelist())
print('có' if sys.argv[2] in text else 'không')
PY
}

# 1. M1 as it happens in the suite: the fixtures of e2e/test.ts with the bypass pointed at a local server.
cat > "$TMP/pw.config.mjs" <<'JS'
export default {
  testDir: '.',
  outputDir: 'test-results',
  reporter: [['html', { open: 'never', outputFolder: 'playwright-report' }]],
}
JS
cat > "$TMP/m1.spec.ts" <<'TS'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { expect, test } from '../../e2e/test'

let server: Server
let base = ''
test.beforeAll(async () => {
  // /500 answers 500; anything else never answers.
  server = createServer((request, response) => {
    if (request.url === '/500') response.writeHead(500).end('lỗi')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
test.afterAll(() => {
  server.closeAllConnections()
  server.close()
})
test.use({ vercelBypass: async ({}, provide) => provide({ origin: new URL(base).origin, secret: process.env.FAKE_SECRET ?? '' }) })

test('toBeOK fail ghi fetch log', async ({ request }) => {
  await expect(await request.get(`${base}/500`)).toBeOK()
})
test('timeout ghi call log', async ({ request }) => {
  await request.get(`${base}/treo`, { timeout: 1000 })
})
TS
check 'm1-e2e-fails' 'exit 1' "$(cd "$TMP" && FAKE_SECRET=$SECRET run npx playwright test -c pw.config.mjs)"
REPORT=$TMP/playwright-report
check 'm1-secret-in-report-md' 'có' "$(has_secret "$REPORT/data" "$SECRET")"
check 'm1-secret-in-embedded-zip' 'có' "$(embedded "$REPORT/index.html" "$SECRET")"
check 'm1-check-finds-it' 'exit 1' "$(REDACT_SECRET=$SECRET run node $REDACT check "$REPORT" "$TMP/test-results")"
check 'm1-redact' 'exit 0' "$(REDACT_SECRET=$SECRET run node $REDACT redact "$REPORT" "$TMP/test-results")"
check 'm1-check-clean' 'exit 0' "$(REDACT_SECRET=$SECRET run node $REDACT check "$REPORT" "$TMP/test-results")"
check 'm1-no-secret-left' 'không' "$(has_secret "$TMP" "$SECRET")"
check 'm1-embedded-zip-valid-and-clean' 'không' "$(embedded "$REPORT/index.html" "$SECRET")"
check 'm1-embedded-zip-masked' 'có' "$(embedded "$REPORT/index.html" "x-vercel-protection-bypass: ***")"

# L1 (audit PR #61): a spec that turns tracing back on while the bypass is set fails before any request is sent.
mkdir -p "$TMP/l1"
cat > "$TMP/l1/l1.spec.ts" <<'TS'
import { test } from '../../../e2e/test'

test.use({ vercelBypass: { origin: 'http://127.0.0.1:9', secret: 'gia-l1-secret-0123' }, trace: 'on' })
test('trace bật lại', async ({ request }) => {
  await request.get('http://127.0.0.1:9/')
})
TS
L1_OUT=$(cd "$TMP/l1" && npx playwright test --config ../pw.config.mjs --reporter line l1.spec.ts 2>&1 || true)
check 'l1-trace-with-bypass-fails' 'có' "$(grep -qF 'Không bật trace khi có header bypass Vercel' <<< "$L1_OUT" && echo có || echo không)"

# 2. Encoded forms, on files made here. A secret with characters that JSON, URL and HTML encode differently.
ODD='gia"NS54<sec>ret/+&x'
FORMS=$TMP/forms
mkdir -p "$FORMS"
node -e '
const fs = require("fs"), zlib = require("zlib"), s = process.argv[1], d = process.argv[2]
fs.writeFileSync(d + "/json.json", JSON.stringify({ log: "x-vercel-protection-bypass: " + s }))
fs.writeFileSync(d + "/url.txt", "?x=" + encodeURIComponent(s))
fs.writeFileSync(d + "/html.html", "<p>" + s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;") + "</p>")
fs.writeFileSync(d + "/log.gz", zlib.gzipSync("header: " + s))
' "$ODD" "$FORMS"
check 'forms-found' 'exit 1' "$(REDACT_SECRET=$ODD run node $REDACT check "$FORMS")"
check 'forms-redact' 'exit 0' "$(REDACT_SECRET=$ODD run node $REDACT redact "$FORMS")"
check 'forms-clean' 'exit 0' "$(REDACT_SECRET=$ODD run node $REDACT check "$FORMS")"

# Base64 cannot be masked in place: found at every byte alignment, and still found after redact.
for shift in 0 1 2; do
  B64=$TMP/b64-$shift
  mkdir -p "$B64"
  node -e 'process.stdout.write("data:text/plain;base64," + Buffer.from("ab".slice(0, +process.argv[2]) + "h: " + process.argv[1] + " t").toString("base64"))' \
    "$SECRET" "$shift" > "$B64/a.txt"
  check "base64-shift-$shift-found" 'exit 1' "$(REDACT_SECRET=$SECRET run node $REDACT check "$B64")"
  REDACT_SECRET=$SECRET node $REDACT redact "$B64" > /dev/null
  check "base64-shift-$shift-still-fails" 'exit 1' "$(REDACT_SECRET=$SECRET run node $REDACT check "$B64")"
done

# A zip that cannot be read is not proven clean.
BROKEN=$TMP/broken
mkdir -p "$BROKEN"
printf 'PK\003\004rác' > "$BROKEN/trace.zip"
check 'unreadable-zip-fails' 'exit 1' "$(REDACT_SECRET=$SECRET run node $REDACT check "$BROKEN")"

# Without a usable secret nothing is proven: refuse.
check 'no-secret' 'exit 2' "$(env -u REDACT_SECRET node $REDACT check "$FORMS" > /dev/null 2>&1 && echo 'exit 0' || echo "exit $?")"
check 'short-secret' 'exit 2' "$(REDACT_SECRET=abc run node $REDACT check "$FORMS")"
check 'missing-folder-is-empty' 'exit 0' "$(REDACT_SECRET=$SECRET run node $REDACT check "$TMP/khong-co")"

[ "$FAILED" -eq 0 ] && echo "redact-report.test: QUA" || { echo "redact-report.test: LỖI"; exit 1; }
