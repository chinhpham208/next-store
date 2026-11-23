/**
 * The longest a caller ever waits for one query: the upper bound of dbQuery's limit (ADR-0011). The client gives
 * a retired pool and a queued job the same time, so nothing a caller still waits on is cut short (ADR-0013).
 */
export const MAX_QUERY_WAIT_MS = 10_000
