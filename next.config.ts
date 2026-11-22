import createMDX from "@next/mdx";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  // PGlite loads its WASM/data files from its own package directory; bundled by Turbopack it fails at prerender.
  serverExternalPackages: ["@electric-sql/pglite"],
  // PGlite has no cross-process lock, so local builds (no DATABASE_URL) prerender in a single worker
  // as a safety net. With Postgres (Vercel/Neon) the default worker count is kept.
  experimental: process.env.DATABASE_URL?.trim() ? {} : { cpus: 1 },
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
