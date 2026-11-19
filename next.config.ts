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

export default nextConfig;
