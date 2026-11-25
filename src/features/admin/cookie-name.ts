// The one rule for the admin cookie's name, shared by cookie.ts (app) and proxy-api.ts (proxy), so both read the same
// cookie (audit PR #104 L1). Imports nothing: the proxy may use it (dependency-cruiser `admin-proxy-api-narrow`).
//
// __Host- makes the browser refuse the cookie unless it is Secure, Path=/ and has no Domain. The prefix needs HTTPS,
// hence the plain name locally and in CI (same rule as the cart cookie).

export type AdminCookieName = '__Host-ns_admin' | 'ns_admin'

/** `site` is getSiteUrl(): the scheme the site is served under, not that of one request. */
export const adminCookieNameFor = (site: URL): AdminCookieName =>
  site.protocol === 'https:' ? '__Host-ns_admin' : 'ns_admin'
