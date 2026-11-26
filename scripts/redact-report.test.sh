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
# The report data embedded in index.html: a zip, base64 in a data: URI. Python's zipfile checks every CRC. With a
# third argument `ansi`, ANSI colour codes (the byte and JSON's \u001b) are taken out before searching.
embedded() {
  python3 - "$1" "$2" "${3:-}" <<'PY'
import base64, io, re, sys, zipfile
html = open(sys.argv[1], encoding='utf-8').read()
data = base64.b64decode(re.search(r'data:application/zip;base64,([A-Za-z0-9+/=]+)', html).group(1))
archive = zipfile.ZipFile(io.BytesIO(data))
assert archive.testzip() is None
text = ''.join(archive.read(name).decode('utf-8') for name in archive.namelist())
if sys.argv[3] == 'ansi':
    text = re.sub(r'(?:\x1b|\\u001b)\[[0-9;]*m', '', text)
print('có' if sys.argv[2] in text else 'không')
PY
}

# 1. M1 as it happens in the suite: the fixtures of e2e/test.ts with the bypass pointed at a local server.
# PW_CHANNEL as in playwright.config.ts, for a machine without Playwright's Chromium (the L-B hooks open a browser).
cat > "$TMP/pw.config.mjs" <<'JS'
export default {
  testDir: '.',
  outputDir: 'test-results',
  reporter: [['html', { open: 'never', outputFolder: 'playwright-report' }]],
  // In CI on a pull request Playwright puts the PR's git diff into report.json; this file's own fake secrets (the
  // tests of NS-129 build fake session tokens) are in that diff, and a report that was never masked would "leak" them.
  captureGitInfo: { commit: false, diff: false },
  use: { channel: process.env.PW_CHANNEL || undefined },
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

# L-A (audit 2 PR #61): expect's diff puts ANSI codes inside the received string, here inside the secret. The report
# keeps them (Playwright starts its workers with FORCE_COLOR=1), so the secret is only whole once they are taken out.
mkdir -p "$TMP/la"
cat > "$TMP/la/la.spec.ts" <<'TS'
import { expect, test } from '../../../e2e/test'

test('diff cắt secret', () => {
  const secret = process.env.FAKE_SECRET ?? ''
  expect(`h: ${secret} t`).toBe(`h: ${secret.slice(0, 9)}XXXXXX${secret.slice(15)} t`)
})
TS
LA_OUT=$(cd "$TMP/la" && FAKE_SECRET=$SECRET FORCE_COLOR=0 NO_COLOR=1 PLAYWRIGHT_HTML_OUTPUT_DIR="$PWD/playwright-report" \
  npx playwright test --config ../pw.config.mjs --output "$PWD/test-results" --reporter list,html la.spec.ts 2>&1 || true)
LA_REPORT=$TMP/la/playwright-report
check 'la-secret-split-in-embedded-zip' 'không' "$(embedded "$LA_REPORT/index.html" "$SECRET")"
check 'la-secret-whole-without-ansi' 'có' "$(embedded "$LA_REPORT/index.html" "$SECRET" ansi)"
check 'la-check-finds-it' 'exit 1' "$(REDACT_SECRET=$SECRET run node $REDACT check "$LA_REPORT")"
check 'la-redact' 'exit 0' "$(REDACT_SECRET=$SECRET run node $REDACT redact "$LA_REPORT")"
check 'la-check-clean' 'exit 0' "$(REDACT_SECRET=$SECRET run node $REDACT check "$LA_REPORT")"
check 'la-no-secret-without-ansi' 'không' "$(embedded "$LA_REPORT/index.html" "$SECRET" ansi)"
check 'la-masked' 'có' "$(embedded "$LA_REPORT/index.html" 'h: *** t' ansi)"
# The job log: with FORCE_COLOR=0 the runner strips every ANSI code from what it prints, so the secret stays whole
# and GitHub's log masking sees it. The workflow sets it (and NO_COLOR) on the e2e step.
check 'la-log-no-ansi' 'không' "$(grep -q $'\x1b' <<< "$LA_OUT" && echo có || echo không)"
check 'la-log-secret-whole' 'có' "$(grep -qF "$SECRET" <<< "$LA_OUT" && echo có || echo không)"
E2E_STEP=$(sed -n '/- name: e2e$/,/^      - /p' .github/workflows/preview-e2e.yml)
check 'la-workflow-no-color' 'có' "$(grep -qF "FORCE_COLOR: '0'" <<< "$E2E_STEP" && grep -qF "NO_COLOR: '1'" <<< "$E2E_STEP" && echo có || echo không)"

# L-B (audit 2 PR #61): hooks get the same fixtures as the test body. With tracing back on, no hook may get a client
# carrying the bypass: nothing with the secret may reach test-results (trace.zip included) or the report.
mkdir -p "$TMP/lb"
lb_spec() {
  cat > "$TMP/lb/lb-$1.spec.ts" <<TS
import { test } from '../../../e2e/test'

test.use({ vercelBypass: { origin: 'http://127.0.0.1:9', secret: process.env.FAKE_SECRET ?? '' }, trace: 'on' })
$2
test('thân test không dùng client', () => {})
TS
}
lb_spec request "test.beforeAll(async ({ request }) => {
  await request.get('http://127.0.0.1:9/beforeAll').catch(() => {})
})
test.afterEach(async ({ request }) => {
  await request.get('http://127.0.0.1:9/afterEach').catch(() => {})
})
test.afterAll(async ({ request }) => {
  await request.get('http://127.0.0.1:9/afterAll').catch(() => {})
})"
lb_spec page "test.afterEach(async ({ page }) => {
  await page.request.get('http://127.0.0.1:9/afterEach-page').catch(() => {})
})"
lb_spec new-context "test.afterEach(async ({ newContext }) => {
  const context = await newContext()
  await context.request.get('http://127.0.0.1:9/afterEach-newContext').catch(() => {})
})"
LB_OUT=$(cd "$TMP/lb" && FAKE_SECRET=$SECRET PLAYWRIGHT_HTML_OUTPUT_DIR="$PWD/playwright-report" \
  npx playwright test --config ../pw.config.mjs --output "$PWD/test-results" --reporter line,html lb- 2>&1 || true)
# Without a browser the page / newContext hooks would prove nothing.
check 'lb-browser-launched' 'có' "$(grep -qF 'browserType.launch' <<< "$LB_OUT" && echo không || echo có)"
check 'lb-hooks-fail' 'có' "$(grep -qF 'Không bật trace khi có header bypass Vercel' <<< "$LB_OUT" && echo có || echo không)"
for spec in request page new-context; do
  check "lb-$spec-trace-written" 'có' "$(find "$TMP/lb/test-results" -path "*lb-$spec-*" -name 'trace.zip' | grep -q . && echo có || echo không)"
done
check 'lb-no-secret-in-results' 'exit 0' "$(REDACT_SECRET=$SECRET run node $REDACT check "$TMP/lb/test-results")"
check 'lb-no-secret-in-report' 'exit 0' "$(REDACT_SECRET=$SECRET run node $REDACT check "$TMP/lb/playwright-report")"

# The run's own bypass (VERCEL_AUTOMATION_BYPASS_SECRET for an https BASE_URL), the one a real secret comes from.
mkdir -p "$TMP/lw"
cat > "$TMP/lw/lw.spec.ts" <<'TS'
import { test } from '../../../e2e/test'

test.use({ trace: 'on' })
test.afterEach(async ({ request }) => {
  await request.get('/afterEach', { timeout: 2000 }).catch(() => {})
})
test('không dùng client', () => {})
TS
LW_OUT=$(cd "$TMP/lw" && BASE_URL=https://next-store-gia.invalid VERCEL_AUTOMATION_BYPASS_SECRET=$SECRET \
  npx playwright test --config ../pw.config.mjs --output "$PWD/test-results" --reporter line lw.spec.ts 2>&1 || true)
check 'lw-run-bypass-trace-fails' 'có' "$(grep -qF 'Không bật trace khi có header bypass Vercel' <<< "$LW_OUT" && echo có || echo không)"
check 'lw-no-secret-in-results' 'exit 0' "$(REDACT_SECRET=$SECRET run node $REDACT check "$TMP/lw/test-results")"

# L-B, lint: in a spec, test.use may only set trace to the literal 'off', and only with an object literal whose keys
# can be read (no spread, no computed key). One ESLint run, each case linted as if it were e2e/x.spec.ts.
LINT=$(node --input-type=module - <<'JS'
import { ESLint } from 'eslint'
const header = "import { test } from './test'\n"
const cases = {
  'trace-on': "test.use({ trace: 'on' })",
  'trace-object': "test.use({ trace: { mode: 'on' } })",
  'trace-string-key': "test.use({ 'trace': 'on' })",
  'trace-computed-key': "test.use({ ['trace']: 'on' })",
  'trace-template-key': 'test.use({ [`trace`]: "on" })',
  'trace-variable-key': "const k = 'trace'\ntest.use({ [k]: 'on' })",
  'trace-shorthand': "const trace = 'on'\ntest.use({ trace })",
  'trace-template-value': 'test.use({ trace: `off` })',
  'spread': "test.use({ ...{ trace: 'on' } })",
  'variable': "const opts = { trace: 'on' } as const\ntest.use(opts)",
  'call': "const opts = () => ({ trace: 'on' }) as const\ntest.use(opts())",
  'describe-variable': "const opts = { trace: 'on' } as const\ntest.describe('x', () => { test.use(opts) })",
  'ok-trace-off': "test.use({ trace: 'off' })",
  'ok-string-key-off': "test.use({ 'trace': 'off' })",
  'ok-other-options': "test.use({ baseURL: 'http://127.0.0.1:9', viewport: { width: 1, height: 1 } })",
}
const eslint = new ESLint()
for (const [name, code] of Object.entries(cases)) {
  const [result] = await eslint.lintText(header + code + '\n', { filePath: 'e2e/x.spec.ts' })
  const hits = result.messages.filter((message) => message.ruleId === 'no-restricted-syntax').length
  console.log(`${name} ${hits > 0 ? 'chặn' : 'qua'}`)
}
JS
)
while read -r name verdict; do
  expected=chặn; [[ $name == ok-* ]] && expected=qua
  check "lint-$name" "$expected" "$verdict"
done <<< "$LINT"
check 'lint-ran-all' 15 "$(grep -c . <<< "$LINT")"

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

# ANSI codes inside the secret, in every encoding a report or log carries ESC: the byte, JSON (\u001b, also escaped
# twice), \x1b, caret notation and an HTML reference. Found, masked with the codes inside, the text around kept.
ANSI_DIR=$TMP/ansi
mkdir -p "$ANSI_DIR"
node -e '
const fs = require("fs"), zlib = require("zlib"), s = process.argv[1], d = process.argv[2], odd = process.argv[3]
const cut = (esc, text = s, at = 9) => "h: " + text.slice(0, at) + esc + "[7m" + text.slice(at, at + 6) + esc + "[27m" + text.slice(at + 6) + " t"
const files = {
  "byte.txt": cut("\x1b"),
  "json.json": JSON.stringify({ message: cut("\x1b") }),
  "json2.json": JSON.stringify({ inner: JSON.stringify({ message: cut("\x1b") }) }),
  "hex.txt": cut("\\x1b"),
  "caret.txt": cut("^["),
  "html.html": cut("&#27;"),
  "odd.json": JSON.stringify({ message: cut("\x1b", odd, 3) }),
}
for (const [name, text] of Object.entries(files)) {
  fs.mkdirSync(d + "/" + name + ".d")
  fs.writeFileSync(d + "/" + name + ".d/" + name, text)
}
fs.mkdirSync(d + "/log.gz.d")
fs.writeFileSync(d + "/log.gz.d/log.gz", zlib.gzipSync(cut("\x1b")))
' "$SECRET" "$ANSI_DIR" "$ODD"
for one in "$ANSI_DIR"/*.d; do
  name=$(basename "$one" .d)
  key=$SECRET; [ "$name" = odd.json ] && key=$ODD
  check "ansi-$name-found" 'exit 1' "$(REDACT_SECRET=$key run node $REDACT check "$one")"
  check "ansi-$name-redact" 'exit 0' "$(REDACT_SECRET=$key run node $REDACT redact "$one")"
  check "ansi-$name-clean" 'exit 0' "$(REDACT_SECRET=$key run node $REDACT check "$one")"
done
check 'ansi-byte-masked' 'h: *** t' "$(cat "$ANSI_DIR/byte.txt.d/byte.txt")"
check 'ansi-json-masked' '{"message":"h: *** t"}' "$(cat "$ANSI_DIR/json.json.d/json.json")"
check 'ansi-odd-masked' '{"message":"h: *** t"}' "$(cat "$ANSI_DIR/odd.json.d/odd.json")"
check 'ansi-gz-masked' 'h: *** t' "$(gzip -dc "$ANSI_DIR/log.gz.d/log.gz")"
# Colour codes that do not cut a secret are left alone, byte for byte.
mkdir -p "$ANSI_DIR/plain"
printf 'a \033[31mđỏ\033[39m b' > "$ANSI_DIR/plain/a.txt"
REDACT_SECRET=$SECRET node $REDACT redact "$ANSI_DIR/plain" > /dev/null
check 'ansi-other-codes-kept' "$(printf 'a \033[31mđỏ\033[39m b' | od -An -tx1)" "$(od -An -tx1 < "$ANSI_DIR/plain/a.txt")"

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

# NS-129 (plan M5 Task 14, audit PR #105 N1, audit PR #106 L3): the Preview admin password and the admin session
# token are secrets too. The password is a known value (REDACT_SECRETS carries several secrets, one per line); the
# session token is made at login, so it is found by its shape: the value after `__Host-ns_admin=` / `ns_admin=` and
# any `v1.<exp>.<43 characters>`.
PASSWORD=gia-NS129-mat_khau-0123456789xyz
TOKEN=v1.1999999999.AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-AbCdE
SECRETS=$(printf '%s\n%s' "$SECRET" "$PASSWORD")

# A fill step records the typed value in the report and in the trace (the reason specs type it another way).
mkdir -p "$TMP/ad"
cat > "$TMP/ad/ad.spec.ts" <<'TS'
import { expect, test } from '../../../e2e/test'

test.use({ trace: 'on' })
test('fill ghi mật khẩu', async ({ page }) => {
  await page.setContent('<input id="p" type="password">')
  await page.locator('#p').fill(process.env.FAKE_PASSWORD ?? '')
  expect(1).toBe(2)
})
TS
AD_OUT=$(cd "$TMP/ad" && FAKE_PASSWORD=$PASSWORD PLAYWRIGHT_HTML_OUTPUT_DIR="$PWD/playwright-report" \
  npx playwright test --config ../pw.config.mjs --output "$PWD/test-results" --reporter list,html ad.spec.ts 2>&1 || true)
AD_REPORT=$TMP/ad/playwright-report
check 'ad-browser-launched' 'có' "$(grep -qF 'browserType.launch' <<< "$AD_OUT" && echo không || echo có)"
check 'ad-check-finds-password' 'exit 1' "$(REDACT_SECRETS=$SECRETS run node $REDACT check "$AD_REPORT" "$TMP/ad/test-results")"
check 'ad-redact' 'exit 0' "$(REDACT_SECRETS=$SECRETS run node $REDACT redact "$AD_REPORT" "$TMP/ad/test-results")"
check 'ad-check-clean' 'exit 0' "$(REDACT_SECRETS=$SECRETS run node $REDACT check "$AD_REPORT" "$TMP/ad/test-results")"
check 'ad-no-password-left' 'không' "$(has_secret "$TMP/ad" "$PASSWORD")"
check 'ad-embedded-zip-no-password' 'không' "$(embedded "$AD_REPORT/index.html" "$PASSWORD")"

# A request that fails on the network: Playwright puts every request header into the error, the session cookie
# included (audit PR #106 L3), here in the report's embedded zip.
mkdir -p "$TMP/ak"
cat > "$TMP/ak/ak.spec.ts" <<'TS'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { test } from '../../../e2e/test'

let server: Server
let base = ''
test.beforeAll(async () => {
  server = createServer(() => {})
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
test.afterAll(() => {
  server.closeAllConnections()
  server.close()
})
test('cookie phiên trong lỗi mạng', async ({ request }) => {
  await request.get(`${base}/treo`, { headers: { cookie: `__Host-ns_admin=${process.env.FAKE_TOKEN}` }, timeout: 1000 })
})
TS
AK_OUT=$(cd "$TMP/ak" && FAKE_TOKEN=$TOKEN PLAYWRIGHT_HTML_OUTPUT_DIR="$PWD/playwright-report" \
  npx playwright test --config ../pw.config.mjs --output "$PWD/test-results" --reporter list,html ak.spec.ts 2>&1 || true)
AK_REPORT=$TMP/ak/playwright-report
check 'ak-token-in-embedded-zip' 'có' "$(embedded "$AK_REPORT/index.html" "$TOKEN")"
check 'ak-check-finds-token' 'exit 1' "$(REDACT_SECRETS=$SECRETS run node $REDACT check "$AK_REPORT")"
check 'ak-redact' 'exit 0' "$(REDACT_SECRETS=$SECRETS run node $REDACT redact "$AK_REPORT")"
check 'ak-check-clean' 'exit 0' "$(REDACT_SECRETS=$SECRETS run node $REDACT check "$AK_REPORT")"
check 'ak-embedded-zip-no-token' 'không' "$(embedded "$AK_REPORT/index.html" "$TOKEN")"
check 'ak-embedded-zip-keeps-cookie-name' 'có' "$(embedded "$AK_REPORT/index.html" '__Host-ns_admin=***')"

# The token in every place it can turn up, on files made here: a Cookie header, a Set-Cookie header, URL encoded, JSON,
# gzip, cut by ANSI codes, and bare. Found, masked, the name kept.
TOKEN_DIR=$TMP/token
mkdir -p "$TOKEN_DIR"
node -e '
const fs = require("fs"), zlib = require("zlib"), t = process.argv[1], d = process.argv[2]
const dir = (name, data) => { fs.mkdirSync(d + "/" + name); fs.writeFileSync(d + "/" + name + "/f", data) }
dir("cookie", "cookie: __Host-ns_admin=" + t + "; ns_cart=x")
dir("plain-name", "cookie: ns_admin=" + t)
dir("set-cookie", "set-cookie: ns_admin=" + t + "; Path=/; HttpOnly; SameSite=Strict")
dir("url", "?c=ns_admin%3D" + t)
dir("json", JSON.stringify({ message: "cookie: ns_admin=" + t }))
dir("bare", "Authorization failed for " + t + " today")
dir("gz", zlib.gzipSync("cookie: __Host-ns_admin=" + t))
dir("ansi", "h: ns_admin=" + t.slice(0, 20) + "\x1b[7m" + t.slice(20, 30) + "\x1b[27m" + t.slice(30) + " t")
dir("ansi-json", JSON.stringify({ message: "h: " + t.slice(0, 25) + "\x1b[7m" + t.slice(25, 33) + "\x1b[27m" + t.slice(33) + " t" }))
' "$TOKEN" "$TOKEN_DIR"
for one in "$TOKEN_DIR"/*; do
  name=$(basename "$one")
  check "token-$name-found" 'exit 1' "$(REDACT_SECRET=$SECRET run node $REDACT check "$one")"
  check "token-$name-redact" 'exit 0' "$(REDACT_SECRET=$SECRET run node $REDACT redact "$one")"
  check "token-$name-clean" 'exit 0' "$(REDACT_SECRET=$SECRET run node $REDACT check "$one")"
done
check 'token-cookie-masked' 'cookie: __Host-ns_admin=***; ns_cart=x' "$(cat "$TOKEN_DIR/cookie/f")"
check 'token-set-cookie-masked' 'set-cookie: ns_admin=***; Path=/; HttpOnly; SameSite=Strict' "$(cat "$TOKEN_DIR/set-cookie/f")"
check 'token-url-masked' '?c=ns_admin%3D***' "$(cat "$TOKEN_DIR/url/f")"
check 'token-bare-masked' 'Authorization failed for *** today' "$(cat "$TOKEN_DIR/bare/f")"
check 'token-gz-masked' 'cookie: __Host-ns_admin=***' "$(gzip -dc "$TOKEN_DIR/gz/f")"
check 'token-ansi-masked' 'h: ns_admin=*** t' "$(cat "$TOKEN_DIR/ansi/f")"
check 'token-ansi-json-masked' '{"message":"h: *** t"}' "$(cat "$TOKEN_DIR/ansi-json/f")"
# What is not a session stays as it is, byte for byte: the cleared cookie, a short signature, a version with no token.
NOT_TOKEN_DIR=$TMP/not-token
mkdir -p "$NOT_TOKEN_DIR"
printf 'set-cookie: ns_admin=; Path=/; Max-Age=0\nset-cookie: __Host-ns_admin=; Path=/; Max-Age=0\nv1.1999999999.tooShort v1.2.3 ns_adminx=1 my_ns_admin=1\n' > "$NOT_TOKEN_DIR/a.txt"
EXPECTED=$(cat "$NOT_TOKEN_DIR/a.txt")
check 'not-token-check-clean' 'exit 0' "$(REDACT_SECRET=$SECRET run node $REDACT check "$NOT_TOKEN_DIR")"
REDACT_SECRET=$SECRET node $REDACT redact "$NOT_TOKEN_DIR" > /dev/null
check 'not-token-left-alone' "$EXPECTED" "$(cat "$NOT_TOKEN_DIR/a.txt")"

# Several secrets: REDACT_SECRETS (one per line, empty lines ignored) and the older REDACT_SECRET together.
MULTI=$TMP/multi
mkdir -p "$MULTI"
printf 'a %s b %s c %s d\n' "$SECRET" "$PASSWORD" 'gia-NS129-thu-ba-0123456789' > "$MULTI/a.txt"
check 'multi-found' 'exit 1' "$(REDACT_SECRET=gia-NS129-thu-ba-0123456789 REDACT_SECRETS=$(printf '\n%s\n\n%s\n' "$SECRET" "$PASSWORD") run node $REDACT check "$MULTI")"
check 'multi-one-missing-still-found' 'exit 1' "$(REDACT_SECRETS=$SECRETS run node $REDACT check "$MULTI")"
REDACT_SECRET=gia-NS129-thu-ba-0123456789 REDACT_SECRETS=$SECRETS node $REDACT redact "$MULTI" > /dev/null
check 'multi-masked' 'a *** b *** c *** d' "$(cat "$MULTI/a.txt")"
check 'multi-clean' 'exit 0' "$(REDACT_SECRET=gia-NS129-thu-ba-0123456789 REDACT_SECRETS=$SECRETS run node $REDACT check "$MULTI")"
check 'multi-short-secret-refused' 'exit 2' "$(REDACT_SECRETS=$(printf '%s\nabc' "$SECRET") run node $REDACT check "$MULTI")"
check 'multi-only-empty-lines-refused' 'exit 2' "$(REDACT_SECRETS=$(printf '\n\n') run node $REDACT check "$MULTI")"

# The workflows: Preview masks both secrets before it uploads; Production never gets the password (ADR-0018 16A).
REDACT_STEP=$(sed -n '/- name: redact Playwright report$/,/^      - name: upload/p' .github/workflows/preview-e2e.yml)
check 'ad-workflow-redacts-bypass' 'có' "$(grep -qF 'secrets.VERCEL_AUTOMATION_BYPASS_SECRET' <<< "$REDACT_STEP" && echo có || echo không)"
check 'ad-workflow-redacts-password' 'có' "$(grep -qF 'secrets.E2E_ADMIN_PASSWORD' <<< "$REDACT_STEP" && echo có || echo không)"
check 'ad-workflow-uses-redact-secrets' 'có' "$(grep -qE '^ +REDACT_SECRETS: \|' <<< "$REDACT_STEP" && echo có || echo không)"
check 'ad-production-has-no-password' 'không' "$(grep -qE '^ +E2E_ADMIN_PASSWORD:' .github/workflows/production-e2e.yml && echo có || echo không)"

[ "$FAILED" -eq 0 ] && echo "redact-report.test: QUA" || { echo "redact-report.test: LỖI"; exit 1; }
