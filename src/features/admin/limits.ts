// The failed-login limit of ADR-0018 8A. Imports nothing, so messages.ts (read by the client login form) can name
// the same window the store counts in.

export const LOGIN_WINDOW_MINUTES = 15
// Per IPv4 address or IPv6 /64 (client-ip.ts clientLimitKey, NS-132).
export const MAX_FAILURES_PER_IP = 5
// Not a lock (NS-132, audit M5 M1): past this many rows in the window, a wrong password is no longer written, so a
// flood from many addresses cannot grow the table without bound. Nobody is refused because of it.
export const MAX_RECORDED_FAILURES = 1000
export const FAILURE_RETENTION_HOURS = 24

// The longest password accepted (ADR-0018 5A): actions.ts refuses longer form input, password.ts refuses it before
// hashing. One constant so the two never drift (audit PR #105 N3).
export const MAX_PASSWORD_LENGTH = 256
