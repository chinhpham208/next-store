export type SiteUrlEnv = {
  SITE_URL?: string
  VERCEL_ENV?: string
  VERCEL_PROJECT_PRODUCTION_URL?: string
  VERCEL_BRANCH_URL?: string
  VERCEL_URL?: string
}

const LOCAL_SITE_URL = 'http://localhost:3000'

// One DNS label: letters, digits, inner hyphens. Case-insensitive for SITE_URL (URL lower-cases it); Vercel sends
// lower case only.
const LABEL = '[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?'
const HOSTNAME = `${LABEL}(?:\\.${LABEL})*`
const PORT = '(?::[0-9]{1,5})?'
// Origin only, optional trailing slash: a path would be dropped by metadataBase's join rules for "/…" paths, and
// credentials, a query or a fragment have no place in a canonical URL.
const HTTPS_ORIGIN = new RegExp(`^https://${HOSTNAME}${PORT}/?$`, 'i')
const LOCAL_ORIGIN = new RegExp(`^http://(?:localhost|127\\.0\\.0\\.1)${PORT}/?$`)
const BARE_HOSTNAME = new RegExp(`^${HOSTNAME}$`)

// Fixed text naming the variable, never its value: a mistyped value may hold credentials and ends up in build logs.
const INVALID_SITE_URL =
  'SITE_URL must be https://<host>[:port], or http://localhost|127.0.0.1[:port] outside a Vercel production build, ' +
  'with no path, query, fragment or credentials'

type VercelHostVariable = 'VERCEL_PROJECT_PRODUCTION_URL' | 'VERCEL_BRANCH_URL' | 'VERCEL_URL'

const present = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

const parseSiteUrl = (raw: string, env: SiteUrlEnv): URL => {
  const local = LOCAL_ORIGIN.test(raw)
  if (!HTTPS_ORIGIN.test(raw) && !local) throw new Error(INVALID_SITE_URL)
  // A production build with a local SITE_URL would put http://localhost into every og:image and the sitemap (K6).
  if (local && env.VERCEL_ENV === 'production') throw new Error(INVALID_SITE_URL)
  try {
    return new URL(raw)
  } catch {
    // Only the port can still be out of range here (e.g. :99999).
    throw new Error(INVALID_SITE_URL)
  }
}

// Vercel sets these to a hostname without scheme or path (next-store-git-develop-<team>.<vercel domain>).
const vercelHost = (name: VercelHostVariable, env: SiteUrlEnv): URL | undefined => {
  const value = present(env[name])
  if (value === undefined) return undefined
  if (!BARE_HOSTNAME.test(value)) throw new Error(`${name} must be a bare hostname`)
  return new URL(`https://${value}`)
}

/**
 * The site's origin for absolute URLs (metadataBase, sitemap, robots), read once per call from `env`:
 * SITE_URL (custom domain, or a host outside Vercel), then the production domain on a production build, then the
 * branch URL (stable across commits of one branch), then the deployment URL, then localhost. Same order as
 * Next.js's own fallback for social images (lib/metadata/resolvers/resolve-url.js). Robots and the sitemap are
 * prerendered, so on Vercel this is the value at build time (K12).
 */
// Named reads, not `process.env` as a whole: the type has no index signature, and only these five ever matter.
const processEnv = (): SiteUrlEnv => ({
  SITE_URL: process.env.SITE_URL,
  VERCEL_ENV: process.env.VERCEL_ENV,
  VERCEL_PROJECT_PRODUCTION_URL: process.env.VERCEL_PROJECT_PRODUCTION_URL,
  VERCEL_BRANCH_URL: process.env.VERCEL_BRANCH_URL,
  VERCEL_URL: process.env.VERCEL_URL,
})

export const getSiteUrl = (env: SiteUrlEnv = processEnv()): URL => {
  const siteUrl = present(env.SITE_URL)
  if (siteUrl !== undefined) return parseSiteUrl(siteUrl, env)
  const production = env.VERCEL_ENV === 'production' ? vercelHost('VERCEL_PROJECT_PRODUCTION_URL', env) : undefined
  return production ?? vercelHost('VERCEL_BRANCH_URL', env) ?? vercelHost('VERCEL_URL', env) ?? new URL(LOCAL_SITE_URL)
}

/** `path` is site-relative (`/products/x`); anything that would resolve to another origin throws. */
export const absoluteUrl = (path: string, env?: SiteUrlEnv): string => {
  // '//host' and '/\host' are protocol-relative to the URL parser: they would replace the site's host.
  if (!path.startsWith('/') || path.startsWith('//') || path.includes('\\')) {
    throw new Error('absoluteUrl: path must start with a single "/"')
  }
  const base = getSiteUrl(env)
  const url = new URL(path, base)
  if (url.origin !== base.origin) throw new Error('absoluteUrl: path must stay on the site origin')
  return url.toString()
}
