import type { MetadataRoute } from "next";
import { absoluteUrl, isProductionDeployment } from "@/lib/site-url";

// Owner decision 15 (plan M3) relied on Vercel's `X-Robots-Tag: noindex` for Preview / Dev; NS-65 found Dev answers
// without it, so the decision's fallback applies: only a Vercel production build may be crawled, everything else
// (Preview, Dev, local, any host off Vercel) says Disallow: /. Prerendered, so this is the environment at build time.
// No Disallow for /admin (M5): a blocked page is never fetched, so its noindex would never be read.
export default function robots(): MetadataRoute.Robots {
  const rules = isProductionDeployment() ? { userAgent: "*", allow: "/" } : { userAgent: "*", disallow: "/" };
  return { rules, sitemap: absoluteUrl("/sitemap.xml") };
}
