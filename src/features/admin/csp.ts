// The strict Content-Security-Policy of /admin/* (ADR-0020, plan M5 Task 12). Imports nothing: the proxy builds it
// through proxy-api.ts (dependency-cruiser `admin-proxy-api-narrow`).
//
// src/proxy.ts sets it on the request, so Next.js 16.4.6 reads the nonce back from script-src
// (server/app-render/get-script-nonce-from-header.js) and puts it on every script and inline style it renders, and on
// the response, so the browser enforces it. 'strict-dynamic': a script with the nonce may load the page's chunks, any
// other script (inline or not) is refused. A nonce needs a page rendered per request, and a prerendered shell would
// carry scripts without it (D3, audit PR #105 L3). The admin root layout (src/app/admin/layout.tsx) does nothing for
// that: src/app/admin/login/page.tsx and src/app/admin/(protected)/layout.tsx await `connection()` first (with
// `instant = false`), and (protected)/[...rest] keeps unknown /admin URLs off the static /_not-found (NS-133).
// scripts/check-admin-bundle.mjs fails the build check when an /admin route has a prerendered shell; the only static
// one is the /admin redirect (a 307, no page rendered).
// Shop pages never get this policy: they keep the baseline of next.config.ts and stay prerendered.

// What Next.js accepts as a nonce (same file, CSP_NONCE_SOURCE_REGEX). Anything else could close the source and add
// directives of its own, so it is refused rather than written into the policy.
const NONCE = /^[A-Za-z0-9+/_-]+={0,2}$/

/** The policy for one admin request. `nonce` comes from newNonce(). */
export const buildAdminCsp = (nonce: string): string => {
  if (!NONCE.test(nonce)) throw new Error('admin csp: invalid nonce')
  // The dev server of Next.js needs eval (React rebuilds server error stacks in the browser); never in a build.
  const evalSource = process.env.NODE_ENV === 'development' ? " 'unsafe-eval'" : ''
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${evalSource}`,
    `style-src 'self' 'nonce-${nonce}'`,
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ')
}

/** A fresh nonce per request: base64 of 16 random bytes (24 characters), unguessable by an injected script. */
export const newNonce = (): string => {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return btoa(String.fromCharCode(...bytes))
}
