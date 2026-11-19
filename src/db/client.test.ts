import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import postgres from 'postgres'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  closeConnection,
  createConnection,
  describeError,
  describeTarget,
  parsePostgresUrl,
  resolveDatabaseTarget,
  resolveSsl,
} from '@/db/client'

// Spy on the real factory: tests assert both what we pass and what postgres-js 4.1.1 ends up with after merging.
vi.mock('postgres', async (importOriginal) => {
  const actual = (await importOriginal<{ default: typeof postgres }>()).default
  return { default: Object.assign(vi.fn(actual), actual) }
})
const postgresFactory = vi.mocked(postgres)

const SECRET_URL = 'postgres://shop:s3cr3t-pass@ep-x-pooler.neon.tech/neondb?sslmode=require&options=endpoint%3Dep-s3cr3t'
const REMOTE = 'postgres://shop:s3cr3t-pass@ep-x-pooler.eu-central-1.aws.neon.tech/neondb'
// What the client must receive for a verified connection: an object, so Node's process default
// (NODE_TLS_REJECT_UNAUTHORIZED) cannot turn verification off.
const VERIFIED = { rejectUnauthorized: true }
const UNPOOLED = 'DATABASE_URL_UNPOOLED'

beforeEach(() => postgresFactory.mockClear())
afterEach(() => vi.unstubAllEnvs())

// postgres-js connects lazily, so constructing the client and ending the pool never opens a socket.
const connect = async (url: string) => {
  const connection = createConnection({ kind: 'postgres', url })
  if (connection.kind !== 'postgres') throw new Error('expected a postgres connection')
  const passed = postgresFactory.mock.calls[0]
  const effective = connection.db.$client.options
  await closeConnection(connection)
  return { passed, effective }
}

describe('resolveDatabaseTarget', () => {
  it('uses PGlite at .data/pglite by default', () => {
    expect(resolveDatabaseTarget({})).toEqual({ kind: 'pglite', dataDir: '.data/pglite' })
  })
  it('uses PGLITE_DATA_DIR when set', () => {
    expect(resolveDatabaseTarget({ PGLITE_DATA_DIR: 'memory://' })).toEqual({ kind: 'pglite', dataDir: 'memory://' })
  })
  it('treats an empty DATABASE_URL as unset', () => {
    expect(resolveDatabaseTarget({ DATABASE_URL: '' }).kind).toBe('pglite')
  })
  it('uses Postgres when DATABASE_URL is set', () => {
    expect(resolveDatabaseTarget({ DATABASE_URL: 'postgres://u:p@h/db' })).toEqual({
      kind: 'postgres',
      url: 'postgres://u:p@h/db',
    })
  })
  it('trims whitespace around DATABASE_URL', () => {
    expect(resolveDatabaseTarget({ DATABASE_URL: '  postgresql://u:p@h/db\n' })).toEqual({
      kind: 'postgres',
      url: 'postgresql://u:p@h/db',
    })
  })
  it('requires DATABASE_URL on Vercel', () => {
    expect(() => resolveDatabaseTarget({ VERCEL: '1' })).toThrow(/DATABASE_URL/)
  })
  it('treats a whitespace-only DATABASE_URL on Vercel as missing', () => {
    expect(() => resolveDatabaseTarget({ VERCEL: '1', VERCEL_ENV: 'preview', DATABASE_URL: '  \t' })).toThrow(
      /DATABASE_URL is required/,
    )
  })
  it('treats any non-empty VERCEL as running on Vercel', () => {
    expect(() => resolveDatabaseTarget({ VERCEL: 'true', VERCEL_ENV: 'preview' })).toThrow(/DATABASE_URL/)
  })
  it.each([undefined, '', 'Production', 'prod', 'staging'])('rejects VERCEL_ENV=%j on Vercel', (vercelEnv) => {
    expect(() => resolveDatabaseTarget({ VERCEL: '1', VERCEL_ENV: vercelEnv, DATABASE_URL: SECRET_URL })).toThrow(
      /VERCEL_ENV must be one of/,
    )
  })
  it.each(['production', 'preview', 'development'])('accepts VERCEL_ENV=%s on Vercel', (vercelEnv) => {
    expect(resolveDatabaseTarget({ VERCEL: '1', VERCEL_ENV: vercelEnv, DATABASE_URL: SECRET_URL }).kind).toBe(
      'postgres',
    )
  })
  it.each([
    'mysql://shop:s3cr3t-pass@h/db',
    'postgres:///db?password=s3cr3t-pass',
    'shop:s3cr3t-pass@h/db',
    'http://shop:s3cr3t-pass@h/db',
  ])('rejects %s without echoing it', (url) => {
    expect(() => resolveDatabaseTarget({ DATABASE_URL: url })).toThrow(/DATABASE_URL is invalid/)
    expect(() => resolveDatabaseTarget({ DATABASE_URL: url })).not.toThrow(/s3cr3t/)
  })
  it.each([
    ['an empty database name', 'postgres://shop:s3cr3t-pass@h/'],
    ['no database name', 'postgres://shop:s3cr3t-pass@h'],
    ['@ in the database name', 'postgres://shop:s3cr3t-pass@h/db@x'],
    ['an encoded @ in the database name', 'postgres://shop:s3cr3t-pass@h/db%40x'],
    ['/ in the database name', 'postgres://shop:s3cr3t-pass@h/db/x'],
    ['an encoded / in the database name', 'postgres://shop:s3cr3t-pass@h/db%2Fx'],
    ['a host query parameter', 'postgres://shop:s3cr3t-pass@h/db?host=evil.example'],
    ['a hostaddr query parameter', 'postgres://shop:s3cr3t-pass@h/db?hostaddr=10.0.0.1'],
    ['a port query parameter', 'postgres://shop:s3cr3t-pass@h/db?port=6543'],
    ['port 0 (postgres-js would fall back to PGPORT)', 'postgres://shop:s3cr3t-pass@h:0/db'],
    ['several hosts', 'postgres://shop:s3cr3t-pass@h1,h2/db'],
    ['a percent-encoded host', 'postgres://shop:s3cr3t-pass@ev%69l/db'],
  ])('rejects %s without echoing the password', (_case, url) => {
    expect(() => resolveDatabaseTarget({ DATABASE_URL: url })).toThrow(/DATABASE_URL is invalid/)
    expect(() => resolveDatabaseTarget({ DATABASE_URL: url })).not.toThrow(/s3cr3t/)
  })
})

describe('parsePostgresUrl', () => {
  it('returns the decoded values the connection will use', () => {
    expect(parsePostgresUrl('  postgres://sh%40p:s3cr3t%20pass@Ep-X.neon.tech:6543/neon%64b?sslmode=require \n')).toEqual({
      host: 'Ep-X.neon.tech',
      port: 6543,
      database: 'neondb',
      username: 'sh@p',
      password: 's3cr3t pass',
      params: new URLSearchParams('sslmode=require'),
    })
  })
  it('defaults the port to 5432', () => {
    expect(parsePostgresUrl('postgres://u:p@h/db').port).toBe(5432)
  })
  it.each([
    ['[::1]', '::1'],
    ['[0:0:0:0:0:0:0:1]', '::1'],
  ])('unwraps the IPv6 literal %s', (host, expected) => {
    expect(parsePostgresUrl(`postgres://u:p@${host}:5432/db`).host).toBe(expected)
  })
  it.each([
    ['tab after the scheme (postgres-js read host "stgres")', 'postgres:/\t/shop:s3cr3t-pass@localhost/db'],
    ['tab in the host', 'postgres://shop:s3cr3t-pass@local\thost/db'],
    ['newline in the host', 'postgres://shop:s3cr3t-pass@local\nhost/db'],
    ['carriage return in the query', 'postgres://shop:s3cr3t-pass@h/db?sslmode=dis\rable'],
    ['NUL in the database name', 'postgres://shop:s3cr3t-pass@h/db\u0000x'],
    ['space in the password', 'postgres://shop:s3cr3t pass@h/db'],
    ['DEL in the user', 'postgres://sh\u007fop:s3cr3t-pass@h/db'],
    ['an encoded NUL in the database name', 'postgres://shop:s3cr3t-pass@h/db%00x'],
    ['an encoded newline in the password', 'postgres://shop:s3cr3t%0Apass@h/db'],
    ['an encoded NUL in options', 'postgres://shop:s3cr3t-pass@h/db?options=a%00user%00root'],
  ])('rejects %s without echoing it', (_case, url) => {
    expect(() => parsePostgresUrl(url)).toThrow(/DATABASE_URL is invalid/)
    expect(() => parsePostgresUrl(url)).not.toThrow(/s3cr3t|localhost/)
  })
  it.each([
    'sslmode=verify-full&sslmode=disable',
    'ssl=true&ssl=false',
    'sslmode=verify-full&sslmode=require',
    'ssl=verify-full&ssl=prefer',
    'sslmode=require&sslmode=require',
    'sslrootcert=system&sslrootcert=/tmp/ca.pem',
    'channel_binding=require&channel_binding=disable',
  ])('rejects the duplicate key in %s', (query) => {
    expect(() => parsePostgresUrl(`${REMOTE}?${query}`)).toThrow(/DATABASE_URL is invalid/)
    expect(() => parsePostgresUrl(`${REMOTE}?${query}`)).not.toThrow(/s3cr3t|neon\.tech/)
  })
  it('names the variable it was given', () => {
    expect(() => parsePostgresUrl('mysql://h/db', 'DATABASE_URL_UNPOOLED')).toThrow(/^DATABASE_URL_UNPOOLED is invalid/)
  })
  it.each(['endpoint%3Dep-x', 'endpoint%3Dep-cool-x-123', 'endpoint%3D0'])('accepts options=%s', (value) => {
    expect(parsePostgresUrl(`${REMOTE}?options=${value}`).params.get('options')).toBe(decodeURIComponent(value))
  })
  it.each([
    ['a server setting', '-c%20search_path%3Ds3cr3t'],
    ['an endpoint followed by a server setting', 'endpoint%3Dep-x%20-c%20role%3Ds3cr3t'],
    ['an upper-case endpoint id', 'endpoint%3DEP-S3CR3T'],
    ['an empty endpoint id', 'endpoint%3D'],
    ['an empty value', ''],
    ['an arbitrary value', 's3cr3t-opt'],
    ['an endpoint id with a dot', 'endpoint%3Dep-s3cr3t.x'],
  ])('refuses options with %s without echoing it', (_case, value) => {
    const run = () => parsePostgresUrl(`${REMOTE}?options=${value}`)
    expect(run).toThrow(/^DATABASE_URL is refused: the options parameter must be exactly endpoint=<id>/)
    expect(run).not.toThrow(/s3cr3t|search_path|neon\.tech/i)
  })
  it('refuses options on a local host as well', () => {
    expect(() => parsePostgresUrl('postgres://u:p@localhost/db?options=-c%20x%3Dy')).toThrow(
      /^DATABASE_URL is refused: the options parameter/,
    )
  })
  it('names the variable when refusing options', () => {
    expect(() => parsePostgresUrl(`${REMOTE}?options=x`, UNPOOLED)).toThrow(/^DATABASE_URL_UNPOOLED is refused: the options/)
  })
  it.each([
    ['no user', 'postgres://ep-x-pooler.eu-central-1.aws.neon.tech/neondb'],
    ['only a password', 'postgres://:s3cr3t-pass@ep-x-pooler.eu-central-1.aws.neon.tech/neondb'],
    ['an empty user before @', 'postgres://@ep-x-pooler.eu-central-1.aws.neon.tech/neondb'],
  ])('refuses %s on a non-local host without echoing it', (_case, url) => {
    expect(() => parsePostgresUrl(url)).toThrow(/^DATABASE_URL is refused: a non-local host needs a user name/)
    expect(() => parsePostgresUrl(url)).not.toThrow(/s3cr3t|neon\.tech/)
    expect(() => parsePostgresUrl(url, UNPOOLED)).toThrow(/^DATABASE_URL_UNPOOLED is refused: a non-local host/)
  })
  it.each(['postgres://localhost/db', 'postgres://127.0.0.1:5432/db', 'postgres://[::1]/db'])(
    'allows %s without a user name',
    (url) => {
      expect(parsePostgresUrl(url).username).toBe('')
    },
  )
})

describe('resolveSsl', () => {
  it.each([
    ['no TLS parameter', REMOTE],
    ['sslmode=require', `${REMOTE}?sslmode=require`],
    ['sslmode=REQUIRE', `${REMOTE}?sslmode=REQUIRE`],
    ['ssl=require', `${REMOTE}?ssl=require`],
    ['sslmode=verify-ca', `${REMOTE}?sslmode=verify-ca`],
    ['sslmode=verify-full', `${REMOTE}?sslmode=verify-full`],
    ['sslmode=VERIFY-FULL', `${REMOTE}?sslmode=VERIFY-FULL`],
    ['ssl=true', `${REMOTE}?ssl=true`],
    ['ssl=TRUE', `${REMOTE}?ssl=TRUE`],
    ['sslrootcert=system', `${REMOTE}?sslrootcert=system`],
    ['an empty sslmode with ssl=require', `${REMOTE}?sslmode=&ssl=require`],
  ])('uses verify-full for %s on a remote host', (_case, url) => {
    expect(resolveSsl(parsePostgresUrl(url))).toBe('verify-full')
  })
  it('keeps hostname verification with a custom sslrootcert', () => {
    expect(resolveSsl(parsePostgresUrl(`${REMOTE}?sslmode=verify-ca&sslrootcert=%2Fetc%2Fca.pem`))).toEqual({
      caFile: '/etc/ca.pem',
    })
  })
  it.each([
    ['no TLS parameter on localhost', 'postgres://u:p@localhost:5432/db', false],
    ['no TLS parameter on LOCALHOST', 'postgres://u:p@LOCALHOST/db', false],
    ['no TLS parameter on 127.0.0.1', 'postgres://u:p@127.0.0.1/db', false],
    ['no TLS parameter on [::1]', 'postgres://u:p@[::1]:5432/db', false],
    ['no TLS parameter on [0:0:0:0:0:0:0:1]', 'postgres://u:p@[0:0:0:0:0:0:0:1]/db', false],
    ['sslmode=disable on localhost', 'postgres://u:p@localhost/db?sslmode=disable', false],
    ['ssl=false on localhost', 'postgres://u:p@localhost/db?ssl=false', false],
    ['sslmode=prefer on localhost', 'postgres://u:p@localhost/db?sslmode=prefer', 'prefer'],
    ['sslmode=require on localhost', 'postgres://u:p@localhost/db?sslmode=require', 'require'],
    ['sslmode=VERIFY-FULL on localhost', 'postgres://u:p@localhost/db?sslmode=VERIFY-FULL', 'verify-full'],
    ['sslrootcert without sslmode on localhost (no TLS)', 'postgres://u:p@localhost/db?sslrootcert=%2Fetc%2Fca.pem', false],
  ])('honours %s', (_case, url, expected) => {
    expect(resolveSsl(parsePostgresUrl(url))).toBe(expected)
  })
  it.each([
    'sslmode=',
    'ssl=',
    'sslmode=bogus',
    'sslmode=constructor',
    'sslrootcert=',
  ])('refuses %s on localhost', (query) => {
    expect(() => resolveSsl(parsePostgresUrl(`postgres://u:s3cr3t@localhost/db?${query}`))).toThrow(
      /DATABASE_URL is refused/,
    )
  })
})

describe('connection options passed to postgres()', () => {
  it('builds the client from explicit options, never from the URL string', async () => {
    const { passed, effective } = await connect(
      'postgres://sh%40p:s3cr3t%20pass@ep-x-pooler.neon.tech/neon%64b' +
        '?sslmode=require&channel_binding=require&options=endpoint%3Dep-x&application_name=next-store',
    )
    expect(passed).toEqual([
      {
        host: ['ep-x-pooler.neon.tech'],
        port: [5432],
        database: 'neondb',
        username: 'sh@p',
        password: 's3cr3t pass',
        ssl: VERIFIED,
        channel_binding: 'require',
        connection: { options: 'endpoint=ep-x', application_name: 'next-store' },
        prepare: false,
        max: 5,
        idle_timeout: 20,
        connect_timeout: 10,
      },
    ])
    expect(effective).toMatchObject({
      host: ['ep-x-pooler.neon.tech'],
      port: [5432],
      database: 'neondb',
      user: 'sh@p',
      ssl: VERIFIED,
      channel_binding: 'require',
    })
  })
  it('passes ?options=endpoint%3Dep-x through to the startup parameters', async () => {
    const { passed, effective } = await connect(`${REMOTE}?options=endpoint%3Dep-x`)
    expect(passed?.[0]).toMatchObject({ connection: { options: 'endpoint=ep-x' } })
    expect(effective.connection).toMatchObject({ options: 'endpoint=ep-x' })
  })
  it('uses the port from the URL', async () => {
    const { passed, effective } = await connect(REMOTE.replace('.tech/', '.tech:6543/'))
    expect(passed?.[0]).toMatchObject({ port: [6543] })
    expect(effective.port).toEqual([6543])
  })
  it.each([
    ['database (overrides the startup database)', 'database=otherdb'],
    ['user (overrides the startup user)', 'user=root'],
    ['target_session_attrs', 'target_session_attrs=read-only'],
    ['a server setting', 'search_path=evil'],
    ['sslcert', 'sslcert=%2Ftmp%2Fclient.pem'],
    ['an upper-case SSLMODE', 'SSLMODE=disable'],
  ])('drops the unknown parameter %s', async (_case, query) => {
    const { passed, effective } = await connect(`${REMOTE}?${query}`)
    expect(passed?.[0]).toMatchObject({ connection: {}, ssl: VERIFIED, database: 'neondb' })
    expect(effective).toMatchObject({ database: 'neondb', ssl: VERIFIED })
    expect(effective.connection).toEqual({ application_name: 'postgres.js' })
  })
  it.each([
    ['no TLS parameter on a remote host', REMOTE, VERIFIED],
    ['sslmode=require', `${REMOTE}?sslmode=require`, VERIFIED],
    ['sslmode=verify-ca', `${REMOTE}?sslmode=verify-ca`, VERIFIED],
    ['ssl=true', `${REMOTE}?ssl=true`, VERIFIED],
    ['sslrootcert=system', `${REMOTE}?sslrootcert=system`, VERIFIED],
    ['no TLS parameter on localhost', 'postgres://u:p@localhost:5432/db', false],
    ['sslmode=disable on localhost', 'postgres://u:p@localhost/db?sslmode=disable', false],
    ['sslmode=require on localhost', 'postgres://u:p@localhost/db?sslmode=require', 'require'],
    ['sslmode=verify-full on localhost', 'postgres://u:p@localhost/db?sslmode=verify-full', VERIFIED],
  ])('passes and keeps ssl for %s', async (_case, url, ssl) => {
    const { passed, effective } = await connect(url)
    expect(passed?.[0]).toMatchObject({ ssl })
    expect(effective.ssl).toEqual(ssl)
  })
  it('ignores PGSSLMODE=disable for a remote connection', async () => {
    vi.stubEnv('PGSSLMODE', 'disable')
    const { passed, effective } = await connect(REMOTE)
    expect(passed?.[0]).toMatchObject({ ssl: VERIFIED })
    expect(effective.ssl).toEqual(VERIFIED)
  })
  it('keeps rejectUnauthorized: true for a remote connection when NODE_TLS_REJECT_UNAUTHORIZED=0', async () => {
    // vi.stubEnv writes process.env and afterEach(vi.unstubAllEnvs) restores the previous value.
    vi.stubEnv('NODE_TLS_REJECT_UNAUTHORIZED', '0')
    expect(process.env.NODE_TLS_REJECT_UNAUTHORIZED).toBe('0')
    const { passed, effective } = await connect(REMOTE)
    expect(passed?.[0]).toMatchObject({ ssl: VERIFIED })
    expect(effective.ssl).toEqual(VERIFIED)
    expect(effective.ssl).not.toHaveProperty('checkServerIdentity')
  })
  it('ignores PGSSLMODE=require for a local connection without TLS', async () => {
    vi.stubEnv('PGSSLMODE', 'require')
    const { effective } = await connect('postgres://u:p@localhost/db')
    expect(effective.ssl).toBe(false)
  })
  it('allows sslmode=disable on localhost', async () => {
    const { effective } = await connect('postgres://u:p@localhost/db?sslmode=disable')
    expect(effective.ssl).toBe(false)
  })
  it('verifies the hostname against a custom sslrootcert', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ns31-'))
    const caFile = join(dir, 'ca.pem')
    writeFileSync(caFile, 'test-ca')
    const { passed, effective } = await connect(`${REMOTE}?sslmode=verify-ca&sslrootcert=${encodeURIComponent(caFile)}`)
    expect(passed?.[0]).toMatchObject({ ssl: { ca: Buffer.from('test-ca'), rejectUnauthorized: true } })
    expect(effective.ssl).toEqual({ ca: Buffer.from('test-ca'), rejectUnauthorized: true })
  })

  // Every row is a URL that postgres-js 4.1.1, given the string, turned into plaintext or unverified TLS.
  it.each([
    ['sslmode=verify-full&sslmode=disable', 'invalid'],
    ['ssl=true&ssl=false', 'invalid'],
    ['sslmode=verify-full&sslmode=require', 'invalid'],
    ['ssl=verify-full&ssl=prefer', 'invalid'],
    ['sslmode=&ssl=disable', 'refused'],
    ['ssl=', 'refused'],
    ['sslmode=', 'refused'],
    ['sslmode=disable', 'refused'],
    ['sslmode=DISABLE', 'refused'],
    ['sslmode=allow', 'refused'],
    ['sslmode=prefer', 'refused'],
    ['sslmode=bogus', 'refused'],
    ['ssl=false', 'refused'],
    ['ssl=disable', 'refused'],
    ['ssl=prefer', 'refused'],
    ['ssl=1', 'refused'],
    ['sslrootcert=', 'refused'],
  ])('refuses %s on a remote host before constructing a client', (query, kind) => {
    const url = `${REMOTE}?${query}`
    const message = new RegExp(`^DATABASE_URL is ${kind}`)
    expect(() => resolveDatabaseTarget({ DATABASE_URL: url })).toThrow(message)
    expect(() => createConnection({ kind: 'postgres', url })).toThrow(message)
    expect(() => createConnection({ kind: 'postgres', url })).not.toThrow(/s3cr3t|neon\.tech|bogus/)
    expect(postgresFactory).not.toHaveBeenCalled()
  })
  it('refuses sslmode= even when PGSSLMODE=disable', () => {
    vi.stubEnv('PGSSLMODE', 'disable')
    expect(() => createConnection({ kind: 'postgres', url: `${REMOTE}?sslmode=` })).toThrow(/DATABASE_URL is refused/)
    expect(postgresFactory).not.toHaveBeenCalled()
  })
  it('refuses the tab URL that postgres-js read as host "stgres"', () => {
    const url = 'postgres:/\t/u:s3cr3t-pass@localhost/db'
    expect(() => createConnection({ kind: 'postgres', url })).toThrow(/DATABASE_URL is invalid/)
    expect(postgresFactory).not.toHaveBeenCalled()
  })
  it('refuses an unsupported channel_binding without echoing it', () => {
    const url = `${REMOTE}?channel_binding=s3cr3t-cb`
    expect(() => createConnection({ kind: 'postgres', url })).toThrow(/DATABASE_URL is invalid/)
    expect(() => createConnection({ kind: 'postgres', url })).not.toThrow(/s3cr3t/)
  })
  it('wraps an unreadable sslrootcert without echoing the path', () => {
    const url = `${REMOTE}?sslrootcert=%2Fnonexistent%2Fs3cr3t-ca.pem`
    expect(() => createConnection({ kind: 'postgres', url })).toThrow(/^DATABASE_URL sslrootcert could not be read/)
    expect(() => createConnection({ kind: 'postgres', url })).not.toThrow(/s3cr3t|nonexistent/)
    try {
      createConnection({ kind: 'postgres', url })
    } catch (error) {
      expect(error).toMatchObject({ code: 'ENOENT' })
      expect((error as Error).cause).toBeUndefined()
    }
  })
  it('names DATABASE_URL_UNPOOLED when an unreadable sslrootcert comes from that URL', () => {
    const url = `${REMOTE}?sslrootcert=%2Fnonexistent%2Fs3cr3t-ca.pem`
    const run = () => createConnection({ kind: 'postgres', url }, { name: UNPOOLED })
    expect(run).toThrow(/^DATABASE_URL_UNPOOLED sslrootcert could not be read/)
    expect(run).not.toThrow(/s3cr3t|nonexistent/)
  })
  it('names DATABASE_URL_UNPOOLED when the driver constructor fails for that URL', () => {
    vi.stubEnv('PGTARGETSESSIONATTRS', 's3cr3t-tsa')
    const run = () => createConnection({ kind: 'postgres', url: REMOTE }, { name: UNPOOLED })
    expect(run).toThrow(/^Could not create the Postgres client from DATABASE_URL_UNPOOLED/)
    expect(run).not.toThrow(/s3cr3t/)
  })
  it('names DATABASE_URL_UNPOOLED for URL and TLS refusals from createConnection', () => {
    const create = (url: string) => () => createConnection({ kind: 'postgres', url }, { name: UNPOOLED })
    expect(create('mysql://h/db')).toThrow(/^DATABASE_URL_UNPOOLED is invalid/)
    expect(create(`${REMOTE}?sslmode=disable`)).toThrow(/^DATABASE_URL_UNPOOLED is refused/)
    expect(postgresFactory).not.toHaveBeenCalled()
  })
  it('wraps a driver constructor error without echoing the value', () => {
    vi.stubEnv('PGTARGETSESSIONATTRS', 's3cr3t-tsa')
    const run = () => createConnection({ kind: 'postgres', url: REMOTE })
    expect(run).toThrow(/^Could not create the Postgres client from DATABASE_URL$/)
    expect(run).not.toThrow(/s3cr3t/)
    try {
      run()
    } catch (error) {
      expect((error as Error).cause).toBeUndefined()
      expect(describeError(error)).not.toMatch(/s3cr3t/)
    }
  })
})

describe('describeTarget', () => {
  it('shows host, port, database and user but never password or query', () => {
    const line = describeTarget({ kind: 'postgres', url: SECRET_URL })
    expect(line).toBe('postgres host=ep-x-pooler.neon.tech port=5432 db=neondb user=shop')
    expect(line).not.toMatch(/s3cr3t|sslmode|endpoint/)
  })
  it('shows the decoded user name', () => {
    expect(describeTarget({ kind: 'postgres', url: 'postgres://sh%40p:pw@h/db' })).toBe(
      'postgres host=h port=5432 db=db user=sh@p',
    )
  })
  it('shows the PGlite directory', () => {
    expect(describeTarget({ kind: 'pglite', dataDir: '.data/pglite' })).toBe('pglite dir=.data/pglite')
  })
})

describe('describeError', () => {
  it('keeps only the message and code', () => {
    const error = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:1'), {
      code: 'ECONNREFUSED',
      options: { pass: 's3cr3t-pass' },
    })
    expect(describeError(error)).toBe('connect ECONNREFUSED 127.0.0.1:1 (code ECONNREFUSED)')
  })
  it('includes the message and code of a wrapped cause', () => {
    const cause = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:1'), { code: 'ECONNREFUSED' })
    expect(describeError(new Error('Failed query: select 1', { cause }))).toBe(
      'Failed query: select 1; nguyên nhân: connect ECONNREFUSED 127.0.0.1:1 (code ECONNREFUSED)',
    )
  })
  it('does not stringify non-Error values', () => {
    expect(describeError({ password: 's3cr3t-pass' })).toBe('unknown error')
  })
})
