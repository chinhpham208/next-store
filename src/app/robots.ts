import type { MetadataRoute } from "next";
import { absoluteUrl } from "@/lib/site-url";

// The same file in every environment (owner decision 15, plan M3): Preview and Dev are behind Deployment Protection
// and Vercel adds `X-Robots-Tag: noindex` there; smoke checks that header on every non-production deployment
// (SMOKE_EXPECT_NOINDEX). No Disallow for /admin (M5): a blocked page is never fetched, so its noindex is never read.
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: "*", allow: "/" }, sitemap: absoluteUrl("/sitemap.xml") };
}
