import { connect, createServer, type Server, type Socket } from 'node:net'
import { PGlite } from '@electric-sql/pglite'
import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest'
import { createRuntimeConnection, MIN_RECYCLE_AGE_MS, type Connection } from '@/db/client'
import * as schema from '@/db/schema'

// NS-73 / ADR-0013: a network that swallows packets on open connections. postgres-js has no read limit for a
// connected socket, so before the fix every pool slot stayed stuck and every later query timed out.
//
// The "database" is PGlite behind a local TCP bridge that feeds the wire protocol to execProtocolRaw. One PGlite
// session serves every socket, so the bridge forwards whole messages one batch at a time, and the test sends only
// parameterless queries (postgres-js uses the simple protocol for them: one message, one answer).
type BridgedSocket = { socket: Socket; frozen: boolean; pending: Buffer; started: boolean }

const LIMIT_MS = 300
const POOL_SIZE = 5

let pglite: PGlite
let server: Server
let port = 0
// Same bridge, but a FIN from the client is never answered (audit PR #44 L4): a network that swallows packets
// swallows the FIN too, so a retired client must let go of its sockets on its own.
let halfOpenServer: Server
let halfOpenPort = 0
const sockets = new Set<BridgedSocket>()
let backend: Promise<void> = Promise.resolve()

// Startup has no type byte (int32 length first); every later message is a type byte, then an int32 length.
const takeMessages = (peer: BridgedSocket): Buffer[] => {
  const messages: Buffer[] = []
  for (;;) {
    const head = peer.started ? 1 : 0
    if (peer.pending.length < head + 4) return messages
    const size = head + peer.pending.readInt32BE(head)
    if (peer.pending.length < size) return messages
    messages.push(peer.pending.subarray(0, size))
    peer.pending = peer.pending.subarray(size)
    peer.started = true
  }
}

const listen = async (target: Server): Promise<number> => {
  await new Promise<void>((resolve) => target.listen(0, '127.0.0.1', resolve))
  const address = target.address()
  if (address === null || typeof address === 'string') throw new Error('expected a TCP address')
  return address.port
}

const bridge = (socket: Socket) => {
  const peer: BridgedSocket = { socket, frozen: false, pending: Buffer.alloc(0), started: false }
  sockets.add(peer)
  socket.on('close', () => sockets.delete(peer))
  socket.on('error', () => {})
  socket.on('data', (chunk) => {
    // Blackhole: the bytes arrive (TCP still ACKs them) and nothing ever comes back.
    if (peer.frozen) return
    peer.pending = Buffer.concat([peer.pending, chunk])
    const messages = takeMessages(peer)
    if (messages.length === 0) return
    const input = new Uint8Array(Buffer.concat(messages))
    backend = backend.then(async () => {
      const output = await pglite.execProtocolRaw(input)
      if (!peer.frozen && output.length > 0) socket.write(output)
    })
  })
}

/** Freezes every connection open right now; connections opened later are served normally. */
const blackholeOpenConnections = () => {
  for (const peer of sockets) peer.frozen = true
}

beforeAll(async () => {
  pglite = new PGlite('memory://')
  await pglite.waitReady
  server = createServer(bridge)
  port = await listen(server)
  halfOpenServer = createServer({ allowHalfOpen: true }, bridge)
  halfOpenPort = await listen(halfOpenServer)
}, 60_000)

afterAll(async () => {
  for (const peer of sockets) peer.socket.destroy()
  await new Promise<void>((resolve) => server.close(() => resolve()))
  await new Promise<void>((resolve) => halfOpenServer.close(() => resolve()))
  await pglite.close()
})

const saved = globalThis.nextStoreDbRuntime
let cleanup: (() => Promise<void>) | undefined

afterEach(async () => {
  await cleanup?.()
  cleanup = undefined
  globalThis.nextStoreDbRuntime = saved
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

// A fresh runtime connection (default options, so the real pool size of 5) pointed at the bridge.
const loadRuntime = async () => {
  vi.resetModules()
  vi.stubEnv('DATABASE_URL', `postgres://postgres@127.0.0.1:${port}/postgres`)
  vi.stubEnv('DB_QUERY_TIMEOUT_MS', String(LIMIT_MS))
  globalThis.nextStoreDbRuntime = undefined
  const { dbQuery } = await import('@/db/query')
  const { closeConnection } = await import('@/db/client')
  cleanup = async () => {
    // Dropping the server side closes the frozen sockets, so retired clients finish ending at once.
    for (const peer of sockets) peer.socket.destroy()
    const runtime = globalThis.nextStoreDbRuntime
    if (runtime) await closeConnection(runtime.current)
  }
  const ping = () => dbQuery({ name: 'test.ping', run: (db) => db.execute(sql`select 1 as ok`) })
  // Each connection is busy while it sleeps, so the pool opens all of its slots.
  const warmPool = async () => {
    const sleeps = Array.from({ length: POOL_SIZE }, () =>
      // A first connection (startup, type lookup) can take longer than LIMIT_MS on a busy CI machine.
      dbQuery({ name: 'test.warm', run: (db) => db.execute(sql`select pg_sleep(0.05)`), timeoutMs: 10_000 }),
    )
    await Promise.all(sleeps)
    expect(sockets.size).toBe(POOL_SIZE)
  }
  // The client was opened by loadRuntime; a younger one is never replaced (audit PR #44 L2).
  const ageClient = () => new Promise((resolve) => setTimeout(resolve, MIN_RECYCLE_AGE_MS))
  return { ping, warmPool, ageClient }
}

const outcome = (promise: Promise<unknown>): Promise<string> =>
  promise.then(
    () => 'ok',
    (error: unknown) => (error instanceof Error && 'code' in error ? String(error.code) : 'error'),
  )

it('answers again right after the first timeout when every warm connection is blackholed', async () => {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  const { ping, warmPool, ageClient } = await loadRuntime()
  await warmPool()
  await ageClient()
  blackholeOpenConnections()

  expect(await outcome(ping())).toBe('DB_QUERY_TIMEOUT')
  // Before NS-73 all eight timed out: five took a dead idle connection, the rest queued behind them.
  const later = []
  for (let attempt = 0; attempt < 8; attempt++) later.push(await outcome(ping()))
  expect(later).toEqual(Array.from({ length: 8 }, () => 'ok'))
}, 30_000)

it('recycles the client once when several queries on it time out together', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  const { ping, warmPool, ageClient } = await loadRuntime()
  await warmPool()
  await ageClient()
  blackholeOpenConnections()

  const together = await Promise.all(Array.from({ length: POOL_SIZE }, () => outcome(ping())))
  expect(together).toEqual(Array.from({ length: POOL_SIZE }, () => 'DB_QUERY_TIMEOUT'))
  expect(warn.mock.calls).toEqual([['database client recycled after a query timeout']])
  expect(await outcome(ping())).toBe('ok')
}, 30_000)

// postgres-js reads only these members; net.Socket's overloaded `end` does not match its SocketLike type as is.
const socketLike = (socket: Socket): postgres.SocketLike => ({
  write: (data) => socket.write(data),
  end: (data) => (data === undefined ? socket.end() : socket.end(data)),
  destroy: (error) => socket.destroy(error),
  pause: () => socket.pause(),
  resume: () => socket.resume(),
  on: (event: string, fn: Parameters<postgres.SocketLike['off']>[1]) => socket.on(event, fn),
  off: (event, fn) => socket.off(event, fn),
  setKeepAlive: (enable, delay) => socket.setKeepAlive(enable, delay),
})

const waitUntil = async (condition: () => boolean, withinMs: number) => {
  const deadline = Date.now() + withinMs
  while (!condition() && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20))
}

it('destroys the sockets of a retired client although its FIN is never answered', async () => {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  // The real client keeps them for RETIRE_TIMEOUT_SECONDS (10 s); the path is the same at 0.3 s.
  const retireTimeoutSeconds = 0.3
  const opened: Socket[] = []
  const open = (): Connection => {
    const client = postgres({
      host: '127.0.0.1',
      port: halfOpenPort,
      username: 'postgres',
      database: 'postgres',
      ssl: false,
      max: 2,
      // A socket of our own, only to see whether the client let go of it.
      socket: (_options, host, socketPort) =>
        new Promise<postgres.SocketLike>((resolve, reject) => {
          const socket = connect(socketPort, host)
          opened.push(socket)
          socket.once('connect', () => resolve(socketLike(socket)))
          socket.once('error', reject)
        }),
    })
    const target = { kind: 'postgres', url: `postgres://postgres@127.0.0.1:${halfOpenPort}/postgres` } as const
    return { kind: 'postgres', target, appRole: undefined, db: drizzle({ client, schema }) } as const
  }
  let time = 0
  const runtime = createRuntimeConnection(open, { now: () => time, retireTimeoutSeconds })
  const retired = runtime.current
  cleanup = async () => {
    for (const peer of sockets) peer.socket.destroy()
    if (runtime.current.kind === 'postgres') await runtime.current.db.$client.end({ timeout: 0 })
  }

  // Two connections: one idle (gets Terminate + FIN) and one waiting on an answer that never comes.
  await Promise.all([1, 2].map(() => retired.db.execute(sql`select pg_sleep(0.05)`)))
  expect(opened).toHaveLength(2)
  blackholeOpenConnections()
  // Straight on the client, not through dbQuery: Drizzle keeps the driver error in `cause`.
  const stuck = retired.db.execute(sql`select 1`).then(
    () => 'ok',
    (error: unknown) => (error instanceof Error && error.cause instanceof Error && 'code' in error.cause ? error.cause.code : 'error'),
  )

  time += MIN_RECYCLE_AGE_MS
  runtime.recycle(retired)
  expect(runtime.current).not.toBe(retired)

  // No FIN comes back, so ending alone would keep both sockets: the precondition of this test.
  await new Promise((resolve) => setTimeout(resolve, 100))
  expect(opened.map((socket) => socket.destroyed)).toEqual([false, false])

  await waitUntil(() => opened.every((socket) => socket.destroyed), 5_000)
  expect(opened.map((socket) => socket.destroyed)).toEqual([true, true])
  expect(await stuck).toBe('CONNECTION_DESTROYED')
}, 30_000)
