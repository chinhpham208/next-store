// ADR-0018: a missing or weak value closes the admin area; the disabled answer never carries a value.
export type AdminConfig =
  | { enabled: true; password: string; sessionSecret: string }
  | { enabled: false; reason: AdminConfigDisabledReason }

export type AdminConfigDisabledReason = 'missing' | 'weak'

/** The two variables the admin area reads; process.env fits it. */
export type AdminEnv = { ADMIN_PASSWORD?: string; SESSION_SECRET?: string }

/** Why loginAction refused (ADR-0018 8A). A right password never comes back: it redirects. */
export type LoginError = 'invalid' | 'wrong-password' | 'locked' | 'not-configured' | 'unavailable'

export type LoginState = { status: 'idle' } | { status: 'error'; error: LoginError }
