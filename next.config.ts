import createMDX from "@next/mdx";
import type { NextConfig } from "next";

// Site-wide security headers (NS-108, ADR-0016; CSP from ADR-0020, plan M5 Task 12). Set here and not in
// src/proxy.ts: the proxy only runs for product, blog and admin paths, while `headers()` applies to every path,
// including the proxy's rewrite to the not-found page, image routes, the sitemap and robots.txt.
//
// The baseline CSP follows "Without Nonces" of the Next.js 16.4.6 guide (02-guides/content-security-policy.md): shop
// pages are prerendered (Cache Components), so their inline RSC scripts cannot carry a per-request nonce and
// 'unsafe-inline' stays in script-src. It still refuses scripts from other origins, <object>, a changed <base>, forms
// posted to another site and framing. /admin/* gets a strict nonce policy from the proxy on top of this one
// (src/features/admin/csp.ts). Every new outside source (analytics, a font CDN, the payment gateway of M6, which
// `form-action 'self'` would block) is added here in the same PR. X-Frame-Options stays for browsers without CSP 2.
const isDev = process.env.NODE_ENV === "development";
// The Vercel Toolbar (comments, feedback) that Vercel injects on Preview and Dev loads a script from vercel.live,
// which then adds an iframe, inline styles, images, fonts and a websocket. Measured on the preview of this PR (C4):
// all of it is refused by the baseline. These are the sources Vercel's docs list for it ("Managing the visibility of
// the Vercel Toolbar", section "Using a Content Security Policy", read 2026-11-26), added only to a Vercel Preview
// build (ADR-0020), never to Production. VERCEL_ENV is trusted only with VERCEL set, as in src/lib/site-url.ts.
// The admin nonce policy gets none of them: with a nonce, 'unsafe-inline' no longer applies to styles, so the toolbar
// does not work on /admin/* of a preview (accepted: the admin policy stays the one Production enforces).
const isVercelPreview = Boolean(process.env.VERCEL?.trim()) && process.env.VERCEL_ENV === "preview";
const toolbar = (sources: string) => (isVercelPreview ? ` ${sources}` : "");
const BASELINE_CSP = [
  "default-src 'self'",
  // The dev server of Next.js needs eval (React rebuilds server error stacks in the browser).
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}${toolbar("https://vercel.live")}`,
  `style-src 'self' 'unsafe-inline'${toolbar("https://vercel.live")}`,
  `img-src 'self' data: blob:${toolbar("https://vercel.live https://vercel.com")}`,
  `font-src 'self'${toolbar("https://vercel.live https://assets.vercel.com")}`,
  `connect-src 'self'${toolbar("https://vercel.live wss://ws-us3.pusher.com")}`,
  ...(isVercelPreview ? ["frame-src https://vercel.live"] : []),
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  // Not on the dev server: it serves http://localhost, and Safari would upgrade every asset request to https.
  ...(isDev ? [] : ["upgrade-insecure-requests"]),
].join("; ");

const SECURITY_HEADERS = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: BASELINE_CSP },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
];

// The cart's real action payloads ({ slug, quantity }) are a few dozen bytes; the default 1 MB let any public POST
// make the server read and parse a megabyte (audit NS-96, ADR-0016). Next.js 16.4.6 refuses a fetch action over the
// limit before decoding it (413 on Vercel, 500 under `next start`), so the action never runs.
const SERVER_ACTION_BODY_LIMIT = "16kb";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  // PGlite loads its WASM/data files from its own package directory; bundled by Turbopack it fails at prerender.
  serverExternalPackages: ["@electric-sql/pglite"],
  // PGlite has no cross-process lock, so local builds (no DATABASE_URL) prerender in a single worker
  // as a safety net. With Postgres (Vercel/Neon) the default worker count is kept.
  experimental: {
    ...(process.env.DATABASE_URL?.trim() ? {} : { cpus: 1 }),
    serverActions: { bodySizeLimit: SERVER_ACTION_BODY_LIMIT },
  },
  headers: async () => [{ source: "/:path*", headers: SECURITY_HEADERS }],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

// No `pageExtensions` change: posts are imported by src/features/blog/content.ts, so an .mdx file never becomes a
// route of its own (M3 K1). No remark / rehype plugins (owner decision 5): posts are CommonMark only.
const withMDX = createMDX({});

export default withMDX(nextConfig);
