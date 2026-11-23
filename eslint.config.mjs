import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// e2e/*.spec.ts (M3 Task 17): ways around the read-only fixtures of e2e/test.ts.
const PLAYWRIGHT = "[source.value='@playwright/test']";
const E2E_NAMESPACE_IMPORTS = [
  {
    selector: `ImportDeclaration${PLAYWRIGHT} > ImportNamespaceSpecifier`,
    message: "Không import * từ '@playwright/test' trong spec: lấy test từ './test'.",
  },
  {
    selector: `ImportExpression${PLAYWRIGHT}`,
    message: "Không import() '@playwright/test' trong spec: lấy test từ './test'.",
  },
];
// NS-54 (audit PR #61 L1): a trace records the bypass secret; e2e/test.ts also refuses the bypass while it is on.
// Audit 2 L-B: the only trace a spec may set is the literal 'off', in an object literal whose keys lint can read.
const TEST_USE = "CallExpression[callee.type='MemberExpression'][callee.property.name='use']";
const TRACE_MESSAGE =
  "Không bật trace trong test.use của spec (chỉ được trace: 'off' viết thẳng): trace ghi lại header bypass Vercel (secret). Dùng --trace khi chạy tại máy.";
const E2E_TRACE = [
  {
    selector: `${TEST_USE} > ObjectExpression > Property:matches([key.name='trace'][computed=false], [key.value='trace']):not([value.value='off'])`,
    message: TRACE_MESSAGE,
  },
  {
    selector: `${TEST_USE} > ObjectExpression > Property[computed=true]:not([key.type='Literal'])`,
    message: "Không dùng khoá tính toán trong test.use của spec: lint không đọc được đó có phải 'trace' không.",
  },
  {
    selector: `${TEST_USE} > ObjectExpression > SpreadElement`,
    message: "Không spread trong test.use của spec: lint không thấy được khoá 'trace' bên trong.",
  },
  {
    selector: `${TEST_USE} > :not(ObjectExpression).arguments`,
    message: "test.use trong spec chỉ nhận object viết thẳng: lint không thấy được khoá 'trace' trong biến hay lời gọi.",
  },
];
const E2E_UNGUARDED_CLIENTS = [
  {
    selector: "MemberExpression[property.name='newContext']",
    message: "Không gọi browser.newContext / request.newContext trong spec: dùng fixture newContext hoặc request của './test'.",
  },
  {
    selector: "CallExpression[callee.name='fetch'], MemberExpression[object.name=/^(globalThis|window|self)$/][property.name='fetch']",
    message: "Không gọi fetch trong spec (kể cả trong page.evaluate): dùng page.goto, page.request hoặc fixture request.",
  },
];

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // M3 Task 17: specs take `test` from e2e/test.ts, whose fixtures keep a run on Production read-only, and get a
  // context or an HTTP client of their own only through those fixtures (`newContext`, `request`).
  {
    files: ["e2e/**/*.spec.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@playwright/test",
              importNames: ["test"],
              message: "Import test từ './test' (E2E trên Production chỉ được đọc; conventions §7).",
            },
          ],
        },
      ],
      "no-restricted-syntax": ["error", ...E2E_NAMESPACE_IMPORTS, ...E2E_TRACE, ...E2E_UNGUARDED_CLIENTS],
    },
  },
  // The guard's own spec (and the bypass spec, NS-54) build contexts and call fetch in the page on purpose, against
  // local servers.
  {
    files: ["e2e/production-guard.spec.ts", "e2e/vercel-bypass.spec.ts"],
    rules: { "no-restricted-syntax": ["error", ...E2E_NAMESPACE_IMPORTS, ...E2E_TRACE] },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
