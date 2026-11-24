import createMDX from "@next/mdx";
import type { NextConfig } from "next";

// Site-wide security headers (NS-108, ADR-0016). Set here and not in src/proxy.ts: the proxy only runs for product and
// blog slugs, while `headers()` applies to every path, including the proxy's rewrite to the not-found page, image
// routes, the sitemap and robots.txt. The CSP is frame-ancestors only (clickjacking); a script-src policy needs nonces
// for the inline RSC payload and is not part of this decision. X-Frame-Options stays for browsers without CSP level 2.
const SECURITY_HEADERS = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
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
