// The failed-login limit of ADR-0018 8A. Imports nothing, so messages.ts (read by the client login form) can name
// the same window the store counts in.

export const LOGIN_WINDOW_MINUTES = 15
export const MAX_FAILURES_PER_IP = 5
export const MAX_FAILURES_GLOBAL = 50
export const FAILURE_RETENTION_HOURS = 24
