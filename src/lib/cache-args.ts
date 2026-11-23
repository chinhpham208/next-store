// Next registers every 'use cache' function as a Server Function with an action id, exported or not, whether or not a
// client component imports it (NS-105). Anyone can POST that id with arguments of their choice, and the arguments are
// the cache key. So a cached function with parameters checks them itself, first thing (conventions §2):
// - a value of the wrong shape → rejectCacheArguments: no query, and a fill that throws stores no entry;
// - a well-formed key that names nothing (unknown slug, category or page) → cacheLife(SKIP_CACHE_ENTRY) and an
//   empty result, so the key never becomes an entry.

export const rejectCacheArguments = (name: string): never => {
  throw new Error(`invalid arguments for cached ${name}`)
}

// cacheLife keeps the shortest lifetime set in the scope, and the default cache handler does not store an entry
// with expire 0 in production (next/dist/server/lib/cache-handlers/default.js).
export const SKIP_CACHE_ENTRY = { revalidate: 0, expire: 0 } as const

/** A whole number from 1 to max; strings and objects that coerce to a number are refused. */
export const isCacheCount = (value: unknown, max: number): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 1 && value <= max
