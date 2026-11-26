// The failed-login limit of ADR-0018 8A. Imports nothing, so messages.ts (read by the client login form) can name
// the same window the store counts in.

export const LOGIN_WINDOW_MINUTES = 15
export const MAX_FAILURES_PER_IP = 5
export const MAX_FAILURES_GLOBAL = 50
export const FAILURE_RETENTION_HOURS = 24

// The longest password accepted (ADR-0018 5A): actions.ts refuses longer form input, password.ts refuses it before
// hashing. One constant so the two never drift (audit PR #105 N3).
export const MAX_PASSWORD_LENGTH = 256
