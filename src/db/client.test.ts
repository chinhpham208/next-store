import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sql } from 'drizzle-orm'
import postgres from 'postgres'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  APP_ROLE_NAME,
  APP_ROLE_REQUIRED_ON_VERCEL,
  assertDbLogAllowed,
  buildPostgresOptions,
  isDbLogOn,
  closeConnection,
  createConnection,
  type DatabaseTarget,
  describeError,
  describeTarget,
  neonEndpointIds,
  parsePostgresUrl,
  resolveAppRole,
  resolveDatabaseTarget,
  type RoleCredentials,
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
    // Production may omit the variable; preview and development must name an endpoint other than theirs.
    const NEON_PRODUCTION_ENDPOINT = vercelEnv === 'production' ? undefined : 'ep-unrelated-main'
    expect(
      resolveDatabaseTarget({ VERCEL: '1', VERCEL_ENV: vercelEnv, DATABASE_URL: SECRET_URL, NEON_PRODUCTION_ENDPOINT }).kind,
    ).toBe('postgres')
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

// Fake ids only: the real production endpoint lives in Vercel, never in the repo.
const PROD = 'ep-prod-main-a1b2c3d4'
const BRANCH = 'ep-fake-dew-a1b2c3d4'
const neon = (id: string, query = 'sslmode=require') =>
  `postgresql://neondb_owner:npg_FakePass123@${id}.ap-southeast-1.aws.neon.tech/neondb?${query}`
const onVercel = (VERCEL_ENV: string, DATABASE_URL: string, NEON_PRODUCTION_ENDPOINT?: string) => () =>
  resolveDatabaseTarget({ VERCEL: '1', VERCEL_ENV, DATABASE_URL, NEON_PRODUCTION_ENDPOINT })

describe('production endpoint guard (NS-36)', () => {
  it('lets a preview use its own branch endpoint', () => {
    expect(onVercel('preview', neon(`${BRANCH}-pooler`), PROD)()).toMatchObject({ kind: 'postgres' })
  })
  it.each([
    ['the pooled production host', neon(`${PROD}-pooler`)],
    ['the direct production host', neon(PROD)],
    ['an upper-case production host', neon(PROD.toUpperCase())],
    ['an upper-case pooled production host', neon(`${PROD}-POOLER`)],
    ['options=endpoint on another host', neon(BRANCH, `sslmode=require&options=endpoint%3D${PROD}`)],
    ['options=endpoint with -pooler on another host', neon(BRANCH, `sslmode=require&options=endpoint%3D${PROD}-pooler`)],
  ])('refuses a preview that points at %s', (_label, url) => {
    expect(onVercel('preview', url, PROD)).toThrow(/NEON_PRODUCTION_ENDPOINT/)
  })
  it('refuses a preview when NEON_PRODUCTION_ENDPOINT is missing or blank', () => {
    expect(onVercel('preview', neon(`${BRANCH}-pooler`))).toThrow(/NEON_PRODUCTION_ENDPOINT/)
    expect(onVercel('preview', neon(`${BRANCH}-pooler`), '')).toThrow(/NEON_PRODUCTION_ENDPOINT/)
    expect(onVercel('preview', neon(`${BRANCH}-pooler`), '   ')).toThrow(/NEON_PRODUCTION_ENDPOINT/)
  })
  it('refuses a preview on a non-Neon host when NEON_PRODUCTION_ENDPOINT is missing', () => {
    expect(onVercel('preview', 'postgres://u:p@db.example.com/app?sslmode=require')).toThrow(/NEON_PRODUCTION_ENDPOINT/)
  })
  it('treats VERCEL_ENV=development like preview', () => {
    expect(onVercel('development', neon(PROD), PROD)).toThrow(/NEON_PRODUCTION_ENDPOINT/)
    expect(onVercel('development', neon(BRANCH))).toThrow(/NEON_PRODUCTION_ENDPOINT/)
    expect(onVercel('development', neon(`${BRANCH}-pooler`), PROD)()).toMatchObject({ kind: 'postgres' })
  })
  it.each([`${PROD}-pooler`, `${PROD}.ap-southeast-1.aws.neon.tech`, 'main', 'ep-prod main', 'EP-PROD', 'ep-', 'ep-prod-'])(
    'refuses a malformed NEON_PRODUCTION_ENDPOINT %j in every environment',
    (value) => {
      expect(onVercel('preview', neon(BRANCH), value)).toThrow(/NEON_PRODUCTION_ENDPOINT/)
      expect(onVercel('production', neon(PROD), value)).toThrow(/NEON_PRODUCTION_ENDPOINT/)
    },
  )
  it('accepts production on the declared endpoint and trims the value', () => {
    expect(onVercel('production', neon(`${PROD}-pooler`), ` ${PROD} `)()).toMatchObject({ kind: 'postgres' })
    expect(onVercel('production', neon(PROD.toUpperCase()), PROD)()).toMatchObject({ kind: 'postgres' })
  })
  it.each([
    ['another endpoint', neon(`${BRANCH}-pooler`)],
    ['a non-Neon host', 'postgres://u:p@db.example.com/app?sslmode=require'],
    ['options=endpoint naming another endpoint', neon(`${PROD}-pooler`, `sslmode=require&options=endpoint%3D${BRANCH}`)],
  ])('refuses production on %s', (_label, url) => {
    expect(onVercel('production', url, PROD)).toThrow(/NEON_PRODUCTION_ENDPOINT/)
  })
  it('does not require the variable on production', () => {
    expect(onVercel('production', neon(`${PROD}-pooler`))()).toMatchObject({ kind: 'postgres' })
    expect(onVercel('production', neon(`${PROD}-pooler`), '  ')()).toMatchObject({ kind: 'postgres' })
  })
  it('does not check outside Vercel', () => {
    expect(resolveDatabaseTarget({ DATABASE_URL: neon(PROD), NEON_PRODUCTION_ENDPOINT: PROD })).toMatchObject({
      kind: 'postgres',
    })
    expect(resolveDatabaseTarget({ DATABASE_URL: neon(PROD), NEON_PRODUCTION_ENDPOINT: 'main' })).toMatchObject({
      kind: 'postgres',
    })
  })
  it('does not check PGlite fallbacks outside Vercel', () => {
    expect(resolveDatabaseTarget({ NEON_PRODUCTION_ENDPOINT: 'main' })).toMatchObject({ kind: 'pglite' })
  })
  it.each([
    ['production endpoint on preview', () => onVercel('preview', neon(`${PROD}-pooler`), PROD)()],
    ['options endpoint on preview', () => onVercel('preview', neon(BRANCH, `sslmode=require&options=endpoint%3D${PROD}`), PROD)()],
    ['missing variable on preview', () => onVercel('preview', neon(`${BRANCH}-pooler`))()],
    ['malformed variable', () => onVercel('preview', neon(BRANCH), `${PROD}.ap-southeast-1.aws.neon.tech`)()],
    ['mismatch on production', () => onVercel('production', neon(`${BRANCH}-pooler`), PROD)()],
  ])('never echoes the URL, host, endpoint or password (%s)', (_label, run) => {
    try {
      run()
    } catch (error) {
      expect(String(error)).toMatch(/NEON_PRODUCTION_ENDPOINT/)
      expect(String(error)).not.toMatch(/npg_FakePass123|neondb_owner|neon\.tech|ep-prod|ep-fake/)
      return
    }
    throw new Error('expected a refusal')
  })
  it('explains the refusal in Vietnamese', () => {
    expect(onVercel('preview', neon(`${PROD}-pooler`), PROD)).toThrow(/Từ chối/)
    expect(onVercel('preview', neon(BRANCH))).toThrow(/Từ chối/)
    expect(onVercel('production', neon(BRANCH), PROD)).toThrow(/Từ chối/)
    expect(onVercel('preview', neon(BRANCH), 'main')).toThrow(/Từ chối/)
  })
  it('forwards NEON_PRODUCTION_ENDPOINT from process.env to the runtime connection', async () => {
    vi.resetModules()
    vi.stubEnv('VERCEL', '1')
    vi.stubEnv('VERCEL_ENV', 'preview')
    vi.stubEnv('NEON_PRODUCTION_ENDPOINT', PROD)
    vi.stubEnv('DATABASE_URL', neon(`${BRANCH}-pooler`))
    const saved = globalThis.nextStoreDbConnection
    globalThis.nextStoreDbConnection = undefined
    try {
      // postgres-js connects lazily: loading the module builds the client without opening a socket.
      const fresh = await import('@/db/client')
      expect(fresh.connection.target).toEqual({ kind: 'postgres', url: neon(`${BRANCH}-pooler`) })
      await fresh.closeConnection()
    } finally {
      globalThis.nextStoreDbConnection = saved
    }
  })
  // Audit PR #15 L1: Neon reads the endpoint from the password for clients without SNI, so the connection could
  // reach an endpoint other than the host we checked.
  const withPassword = (id: string, password: string) =>
    `postgresql://neondb_owner:${encodeURIComponent(password)}@${id}.ap-southeast-1.aws.neon.tech/neondb?sslmode=require`
  it.each(['endpoint=ep-prod-main-a1b2c3d4;x', 'ENDPOINT=ep-x$y', 'project=ep-prod-main-a1b2c3d4;x', 'Project=p$y'])(
    'refuses a password that carries an endpoint (%s) in every environment',
    (password) => {
      expect(onVercel('preview', withPassword(BRANCH, password), PROD)).toThrow(/NEON_PRODUCTION_ENDPOINT/)
      expect(onVercel('development', withPassword(BRANCH, password), PROD)).toThrow(/NEON_PRODUCTION_ENDPOINT/)
      expect(onVercel('production', withPassword(PROD, password), PROD)).toThrow(/NEON_PRODUCTION_ENDPOINT/)
      expect(onVercel('production', withPassword(PROD, password))).toThrow(/NEON_PRODUCTION_ENDPOINT/)
    },
  )
  it.each([' endpoint=ep-prod-main-a1b2c3d4;x', '   project=ep-prod-main-a1b2c3d4$x'])(
    'refuses a password that carries an endpoint after leading spaces (%j)',
    (password) => {
      expect(onVercel('preview', withPassword(BRANCH, password), PROD)).toThrow(/NEON_PRODUCTION_ENDPOINT/)
      expect(onVercel('production', withPassword(PROD, password), PROD)).toThrow(/NEON_PRODUCTION_ENDPOINT/)
    },
  )
  it.each([
    ['the host', neon(`${PROD}-pooler-pooler`)],
    ['an upper-case host', neon(`${PROD}-POOLER-pooler`)],
    ['options=endpoint', neon(BRANCH, `sslmode=require&options=endpoint%3D${PROD}-pooler-pooler`)],
  ])('refuses a preview that reaches production through a repeated -pooler suffix in %s', (_label, url) => {
    expect(onVercel('preview', url, PROD)).toThrow(/NEON_PRODUCTION_ENDPOINT/)
  })
  it('never echoes a password that carries an endpoint', () => {
    expect(onVercel('preview', withPassword(BRANCH, 'endpoint=ep-prod-main-a1b2c3d4;npg_FakePass123'), PROD)).not.toThrow(
      /npg_FakePass123|neondb_owner|neon\.tech|ep-prod|ep-fake/,
    )
  })
  it('still accepts a password that only contains the word endpoint', () => {
    expect(onVercel('preview', withPassword(BRANCH, 'my-endpoint=x'), PROD)()).toMatchObject({ kind: 'postgres' })
  })
  it.each(['pg.neon.tech', 'proxy.ap-southeast-1.aws.neon.tech', 'PG.NEON.TECH', 'api.c-2.ap-southeast-1.aws.neon.tech.'])(
    'refuses a preview on the Neon host %s that names no endpoint',
    (host) => {
      expect(onVercel('preview', `postgresql://u:p@${host}/neondb?sslmode=require`, PROD)).toThrow(/NEON_PRODUCTION_ENDPOINT/)
      expect(onVercel('development', `postgresql://u:p@${host}/neondb?sslmode=require`, PROD)).toThrow(
        /NEON_PRODUCTION_ENDPOINT/,
      )
    },
  )
  it('still lets a preview use a non-Neon host', () => {
    expect(onVercel('preview', 'postgres://u:p@db.example.com/app?sslmode=require', PROD)()).toMatchObject({
      kind: 'postgres',
    })
  })
  it('refuses options with an upper-case key or endpoint id', () => {
    expect(() => parsePostgresUrl(neon(BRANCH, 'sslmode=require&options=ENDPOINT%3Dep-x'))).toThrow(/options/)
    expect(() => parsePostgresUrl(neon(BRANCH, 'sslmode=require&options=endpoint%3DEP-X'))).toThrow(/options/)
    expect(onVercel('preview', neon(BRANCH, `sslmode=require&options=endpoint%3D${PROD.toUpperCase()}`), PROD)).toThrow(
      /options/,
    )
  })
  it('neonEndpointIds lists the host endpoint and the options endpoint once each', () => {
    expect(
      neonEndpointIds(parsePostgresUrl(neon(`${BRANCH}-pooler`, `sslmode=require&options=endpoint%3D${PROD}`))),
    ).toEqual([BRANCH, PROD])
    expect(neonEndpointIds(parsePostgresUrl(neon(`${PROD}-pooler`, `sslmode=require&options=endpoint%3D${PROD}`)))).toEqual([
      PROD,
    ])
    expect(neonEndpointIds(parsePostgresUrl(neon(PROD.toUpperCase())))).toEqual([PROD])
    expect(neonEndpointIds(parsePostgresUrl('postgres://u:p@db.example.com/app?sslmode=require'))).toEqual([])
  })
})

// ADR-0008: DB_LOG=1 prints every statement with its parameters, i.e. customer data, to the function log.
describe('DB_LOG guard (NS-36 L3)', () => {
  const pg = (url: string): DatabaseTarget => ({ kind: 'postgres', url })
  it.each([
    ['production', 'production'],
    ['an unset VERCEL_ENV (VPS)', undefined],
    ['a misspelt VERCEL_ENV', 'Production'],
    ['a padded VERCEL_ENV', 'preview '],
  ])('refuses DB_LOG=1 on %s', (_label, vercelEnv) => {
    expect(() => assertDbLogAllowed({ dbLog: '1', target: pg(neon(PROD)), vercel: '1', vercelEnv })).toThrow(/DB_LOG/)
  })
  it('refuses DB_LOG=1 on a remote non-Neon Postgres outside Vercel', () => {
    expect(() =>
      assertDbLogAllowed({ dbLog: '1', target: pg('postgres://u:p@db.example.com/app'), vercel: undefined, vercelEnv: undefined }),
    ).toThrow(/DB_LOG/)
  })
  it.each(['preview', 'development'])('allows DB_LOG=1 on a Vercel %s database', (vercelEnv) => {
    expect(() => assertDbLogAllowed({ dbLog: '1', target: pg(neon(BRANCH)), vercel: '1', vercelEnv })).not.toThrow()
  })
  // Audit PR #35 M1: off Vercel the endpoint guard never ran, so a hand-set VERCEL_ENV proves nothing.
  it.each([
    ['unset', undefined],
    ['empty', ''],
  ])('refuses DB_LOG=1 on a remote Postgres when VERCEL is %s, whatever VERCEL_ENV says', (_label, vercel) => {
    for (const vercelEnv of ['preview', 'development']) {
      for (const url of [neon(BRANCH), 'postgres://u:p@db.example.com/app']) {
        expect(() => assertDbLogAllowed({ dbLog: '1', target: pg(url), vercel, vercelEnv })).toThrow(/DB_LOG/)
      }
    }
  })
  it('keeps PGlite and a local Postgres loggable without VERCEL', () => {
    expect(() =>
      assertDbLogAllowed({ dbLog: '1', target: { kind: 'pglite', dataDir: 'memory://' }, vercel: undefined, vercelEnv: 'preview' }),
    ).not.toThrow()
    expect(() =>
      assertDbLogAllowed({ dbLog: '1', target: pg('postgres://u:p@localhost/app'), vercel: undefined, vercelEnv: 'preview' }),
    ).not.toThrow()
  })
  it('refuses DB_LOG=1 through createConnection when VERCEL_ENV=preview is set by hand off Vercel', () => {
    vi.stubEnv('DB_LOG', '1')
    vi.stubEnv('VERCEL', '')
    vi.stubEnv('VERCEL_ENV', 'preview')
    expect(() => createConnection(pg(neon(PROD)))).toThrow(/DB_LOG/)
    expect(postgresFactory).not.toHaveBeenCalled()
  })
  it('allows DB_LOG=1 on PGlite and on a local Postgres', () => {
    expect(() =>
      assertDbLogAllowed({ dbLog: '1', target: { kind: 'pglite', dataDir: 'memory://' }, vercel: '1', vercelEnv: 'production' }),
    ).not.toThrow()
    for (const host of ['localhost', '127.0.0.1', '[::1]', 'LOCALHOST']) {
      expect(() =>
        assertDbLogAllowed({ dbLog: '1', target: pg(`postgres://u:p@${host}/app`), vercel: undefined, vercelEnv: undefined }),
      ).not.toThrow()
    }
  })
  it.each([undefined, '', '0', 'true'])('ignores DB_LOG=%j', (dbLog) => {
    expect(() => assertDbLogAllowed({ dbLog, target: pg(neon(PROD)), vercel: '1', vercelEnv: 'production' })).not.toThrow()
  })
  it('never echoes the URL, host or password', () => {
    expect(() => assertDbLogAllowed({ dbLog: '1', target: pg(neon(PROD)), vercel: '1', vercelEnv: 'production' })).toThrow(/DB_LOG/)
    expect(() => assertDbLogAllowed({ dbLog: '1', target: pg(neon(PROD)), vercel: '1', vercelEnv: 'production' })).not.toThrow(
      /npg_FakePass123|neondb_owner|neon\.tech|ep-prod/,
    )
  })
  it('refuses DB_LOG=1 on a production database before constructing a client', () => {
    vi.stubEnv('DB_LOG', '1')
    vi.stubEnv('VERCEL_ENV', 'production')
    expect(() => createConnection(pg(neon(PROD)))).toThrow(/DB_LOG/)
    expect(postgresFactory).not.toHaveBeenCalled()
  })
  it('still builds a logging client for a preview database', async () => {
    vi.stubEnv('DB_LOG', '1')
    vi.stubEnv('VERCEL', '1')
    vi.stubEnv('VERCEL_ENV', 'preview')
    const connection = createConnection(pg(neon(`${BRANCH}-pooler`)))
    expect(postgresFactory).toHaveBeenCalledOnce()
    await closeConnection(connection)
  })
  // Audit PR #35 L3: if the logger ever accepted a value the guard ignores, production would log unguarded.
  it.each(['1', '', '0', 'true', 'TRUE', ' 1', '1 ', '01', 'yes', undefined])(
    'guard and logger agree on DB_LOG=%j',
    async (value) => {
      const remote = () =>
        assertDbLogAllowed({ dbLog: value, target: pg(neon(PROD)), vercel: '1', vercelEnv: 'production' })
      if (isDbLogOn(value)) expect(remote).toThrow(/DB_LOG/)
      else expect(remote).not.toThrow()
      vi.stubEnv('DB_LOG', value)
      const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
      const local = createConnection({ kind: 'pglite', dataDir: 'memory://' })
      try {
        await local.db.execute(sql`select 1`)
        const logged = log.mock.calls.some((call) => String(call[0]).startsWith('Query:'))
        expect(logged).toBe(isDbLogOn(value))
      } finally {
        log.mockRestore()
        await closeConnection(local)
      }
    },
  )
  it('isDbLogOn is true only for exactly "1"', () => {
    expect(isDbLogOn('1')).toBe(true)
    for (const value of [undefined, '', '0', 'true', ' 1', '1 ']) expect(isDbLogOn(value)).toBe(false)
  })
  it('refuses to load the runtime connection with DB_LOG=1 on production', async () => {
    vi.resetModules()
    vi.stubEnv('DB_LOG', '1')
    vi.stubEnv('VERCEL', '1')
    vi.stubEnv('VERCEL_ENV', 'production')
    vi.stubEnv('NEON_PRODUCTION_ENDPOINT', PROD)
    vi.stubEnv('DATABASE_URL', neon(`${PROD}-pooler`))
    const saved = globalThis.nextStoreDbConnection
    globalThis.nextStoreDbConnection = undefined
    try {
      await expect(import('@/db/client')).rejects.toThrow(/DB_LOG/)
      expect(postgresFactory).not.toHaveBeenCalled()
    } finally {
      globalThis.nextStoreDbConnection = saved
    }
  })
})

// ADR-0010 decision A: runtime, prerender and db:seed log in as next_store_app; db:migrate keeps the URL's owner role.
describe('app role (NS-60)', () => {
  const url = parsePostgresUrl(neon(BRANCH))
  const APP = { DATABASE_APP_USER: 'next_store_app', DATABASE_APP_PASSWORD: 'npg_AppFake456' }
  const VERCEL_ENVS = ['production', 'preview', 'development']

  it('returns nothing when neither variable is set', () => {
    expect(resolveAppRole({ env: {}, url })).toBeUndefined()
    expect(resolveAppRole({ env: { DATABASE_APP_USER: ' ', DATABASE_APP_PASSWORD: '' }, url })).toBeUndefined()
  })
  it('returns the credentials when both are set, trimmed', () => {
    expect(resolveAppRole({ env: APP, url })).toEqual({ username: 'next_store_app', password: 'npg_AppFake456' })
    expect(
      resolveAppRole({ env: { DATABASE_APP_USER: ' next_store_app\n', DATABASE_APP_PASSWORD: ' npg_AppFake456 ' }, url }),
    ).toEqual({ username: 'next_store_app', password: 'npg_AppFake456' })
  })
  it('refuses half-configured app role credentials', () => {
    expect(() => resolveAppRole({ env: { DATABASE_APP_USER: 'next_store_app' }, url })).toThrow(/^DATABASE_APP_PASSWORD/)
    expect(() => resolveAppRole({ env: { DATABASE_APP_USER: 'next_store_app', DATABASE_APP_PASSWORD: ' ' }, url })).toThrow(
      /^DATABASE_APP_PASSWORD/,
    )
    expect(() => resolveAppRole({ env: { DATABASE_APP_PASSWORD: 'x' }, url })).toThrow(/^DATABASE_APP_USER/)
  })
  it.each([
    'neondb_owner',
    'NEONDB_OWNER',
    'Next_Store_App',
    'NEXT_STORE_APP',
    'next_store_app2',
    'next_store',
    'other_app',
    'next_store_app;x',
    'app role',
    'a;b',
    '1app',
    'app-role',
    ''.padEnd(64, 'a'),
  ])(
    'refuses the user name %j',
    (user) => {
      expect(() => resolveAppRole({ env: { DATABASE_APP_USER: user, DATABASE_APP_PASSWORD: 'x' }, url })).toThrow(
        /^DATABASE_APP_USER/,
      )
    },
  )
  // Audit PR #39 L7: a valid name of another role (possibly with wider rights) must not be accepted.
  it('accepts exactly next_store_app, the role the SQL scripts grant to', () => {
    expect(APP_ROLE_NAME).toBe('next_store_app')
    expect(readFileSync('scripts/sql/app-role.sql', 'utf8')).toContain(`TO ${APP_ROLE_NAME};`)
    expect(readFileSync('scripts/sql/app-role-check.sql', 'utf8')).toContain(`rolname = '${APP_ROLE_NAME}'`)
    expect(resolveAppRole({ env: { DATABASE_APP_USER: 'next_store_app', DATABASE_APP_PASSWORD: 'x' }, url })?.username).toBe(
      'next_store_app',
    )
  })
  it('refuses next_store_app when it is also the user of DATABASE_URL', () => {
    const own = parsePostgresUrl(neon(BRANCH).replace('neondb_owner', 'next_store_app'))
    expect(() => resolveAppRole({ env: { DATABASE_APP_USER: 'next_store_app', DATABASE_APP_PASSWORD: 'x' }, url: own })).toThrow(
      /^DATABASE_APP_USER/,
    )
  })
  it.each(['a\u0000b', 'a\u001bb', 'a\u007fb', 'endpoint=ep-x;y', 'project=ep-x$y', 'ENDPOINT=ep-x;y', ' endpoint=ep-x;y'])(
    'refuses the password %j without echoing it',
    (password) => {
      const run = () => resolveAppRole({ env: { DATABASE_APP_USER: 'next_store_app', DATABASE_APP_PASSWORD: password }, url })
      expect(run).toThrow(/^DATABASE_APP_PASSWORD/)
      expect(run).toThrow(expect.objectContaining({ message: expect.not.stringContaining(password.trim()) }))
    },
  )
  it('never echoes the user name, password or URL in a refusal', () => {
    const run = () => resolveAppRole({ env: { DATABASE_APP_USER: 'Bad_S3cr3t', DATABASE_APP_PASSWORD: 'npg_AppFake456' }, url })
    expect(run).toThrow(/DATABASE_APP_USER/)
    expect(run).not.toThrow(/Bad_S3cr3t|npg_|neondb_owner|neon\.tech/)
  })

  // Expand step (Task 4): missing variables keep the owner role everywhere. Task 5 (contract) flips
  // APP_ROLE_REQUIRED_ON_VERCEL and turns this test into the refusal below for the default.
  it('falls back to the owner role on every Vercel environment while the app role is optional', () => {
    expect(APP_ROLE_REQUIRED_ON_VERCEL).toBe(false)
    for (const VERCEL_ENV of VERCEL_ENVS) {
      expect(resolveAppRole({ env: { VERCEL: '1', VERCEL_ENV }, url })).toBeUndefined()
    }
  })
  it('refuses every Vercel environment without the app role once it is required', () => {
    for (const VERCEL_ENV of VERCEL_ENVS) {
      for (const VERCEL of ['1', 'true']) {
        const run = () => resolveAppRole({ env: { VERCEL, VERCEL_ENV }, url, requiredOnVercel: true })
        expect(run).toThrow(/^DATABASE_APP_USER/)
        expect(run).not.toThrow(/npg_|neondb_owner|neon\.tech/)
      }
    }
  })
  it('keeps the app role optional outside Vercel even once it is required', () => {
    expect(resolveAppRole({ env: {}, url, requiredOnVercel: true })).toBeUndefined()
    expect(resolveAppRole({ env: { VERCEL: '', VERCEL_ENV: 'production' }, url, requiredOnVercel: true })).toBeUndefined()
  })
  it('still validates the pair on Vercel once it is required', () => {
    expect(resolveAppRole({ env: { ...APP, VERCEL: '1', VERCEL_ENV: 'production' }, url, requiredOnVercel: true })).toEqual({
      username: 'next_store_app',
      password: 'npg_AppFake456',
    })
  })

  it('swaps only user and password, keeping host, database, TLS and options', () => {
    const base = buildPostgresOptions(neon(BRANCH, `sslmode=require&channel_binding=require&options=endpoint%3D${BRANCH}`))
    const app = buildPostgresOptions(neon(BRANCH, `sslmode=require&channel_binding=require&options=endpoint%3D${BRANCH}`), {
      credentials: { username: 'next_store_app', password: 'npg_AppFake456' },
    })
    expect(app).toMatchObject({ username: 'next_store_app', password: 'npg_AppFake456' })
    expect({ ...app, username: base.username, password: base.password }).toEqual(base)
  })
  it('passes the app role to postgres() and keeps only its name on the connection', async () => {
    const connection = createConnection(
      { kind: 'postgres', url: neon(BRANCH) },
      { credentials: { username: 'next_store_app', password: 'npg_AppFake456' } },
    )
    expect(postgresFactory.mock.calls[0]?.[0]).toMatchObject({
      host: [`${BRANCH}.ap-southeast-1.aws.neon.tech`],
      username: 'next_store_app',
      password: 'npg_AppFake456',
      ssl: VERIFIED,
    })
    // The password stays inside the driver options; the connection keeps only the role name for log lines.
    expect(connection.appRole).toStrictEqual({ username: 'next_store_app' })
    expect(JSON.stringify({ ...connection, db: undefined })).not.toMatch(/npg_AppFake456/)
    await closeConnection(connection)
  })
  it('describes the role actually used and never a password', () => {
    // A full credential pair is accepted too (structural typing); only the name may reach the line.
    const credentials: RoleCredentials = { username: 'next_store_app', password: 'npg_AppFake456' }
    const line = describeTarget({ kind: 'postgres', url: neon(BRANCH) }, credentials)
    expect(line).toBe(`postgres host=${BRANCH}.ap-southeast-1.aws.neon.tech port=5432 db=neondb user=next_store_app`)
    expect(line).not.toMatch(/npg_/)
  })
  it('describes the URL role when there are no app credentials', () => {
    expect(describeTarget({ kind: 'postgres', url: neon(BRANCH) }, undefined)).toMatch(/ user=neondb_owner$/)
  })

  const loadRuntime = async (env: Record<string, string>) => {
    vi.resetModules()
    for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value)
    const saved = globalThis.nextStoreDbConnection
    globalThis.nextStoreDbConnection = undefined
    try {
      return await import('@/db/client')
    } finally {
      globalThis.nextStoreDbConnection = saved
    }
  }
  const PREVIEW = { VERCEL: '1', VERCEL_ENV: 'preview', NEON_PRODUCTION_ENDPOINT: PROD, DATABASE_URL: neon(`${BRANCH}-pooler`) }

  it('connects the runtime as the app role from process.env', async () => {
    const fresh = await loadRuntime({ ...PREVIEW, ...APP })
    expect(postgresFactory.mock.calls[0]?.[0]).toMatchObject({ username: 'next_store_app', password: 'npg_AppFake456' })
    expect(fresh.connection.appRole).toEqual({ username: 'next_store_app' })
    await fresh.closeConnection()
  })
  it('keeps the runtime on the URL role while the variables are absent', async () => {
    const fresh = await loadRuntime({ ...PREVIEW, DATABASE_APP_USER: '', DATABASE_APP_PASSWORD: '' })
    expect(postgresFactory.mock.calls[0]?.[0]).toMatchObject({ username: 'neondb_owner', password: 'npg_FakePass123' })
    expect(fresh.connection.appRole).toBeUndefined()
    await fresh.closeConnection()
  })
  it('refuses to load the runtime connection with half-configured credentials before constructing a client', async () => {
    await expect(loadRuntime({ ...PREVIEW, DATABASE_APP_USER: 'next_store_app', DATABASE_APP_PASSWORD: '' })).rejects.toThrow(
      /^DATABASE_APP_PASSWORD/,
    )
    expect(postgresFactory).not.toHaveBeenCalled()
  })
  it('ignores the app role variables for PGlite', async () => {
    const fresh = await loadRuntime({ DATABASE_URL: '', ...APP })
    expect(fresh.connection.kind).toBe('pglite')
    expect(fresh.connection.appRole).toBeUndefined()
    await fresh.closeConnection()
  })
})

// The exact shapes the Vercel ↔ Neon Marketplace integration injects (credentials are fake).
describe('Neon integration URLs (Vercel Marketplace, ap-southeast-1)', () => {
  const NEON_POOLED = 'postgresql://neondb_owner:npg_FakePass123@ep-fake-dew-a1b2c3d4-pooler.ap-southeast-1.aws.neon.tech/neondb'
  const NEON_SHAPES = [
    ['sslmode=require', `${NEON_POOLED}?sslmode=require`, undefined],
    ['sslmode=require&channel_binding=require', `${NEON_POOLED}?sslmode=require&channel_binding=require`, 'require'],
    ['channel_binding=require&sslmode=require', `${NEON_POOLED}?channel_binding=require&sslmode=require`, 'require'],
  ] as const

  it.each(NEON_SHAPES)('accepts %s on Vercel preview as a Postgres target', (_label, url) => {
    expect(
      resolveDatabaseTarget({ DATABASE_URL: url, VERCEL: '1', VERCEL_ENV: 'preview', NEON_PRODUCTION_ENDPOINT: PROD }),
    ).toEqual({
      kind: 'postgres',
      url,
    })
  })
  it.each(NEON_SHAPES)('connects with verified TLS and channel binding honoured for %s', async (_label, url, binding) => {
    // postgres-js reads PGCHANNELBINDING when the URL has no channel_binding; the 'prefer' default must not depend on
    // the shell that runs the tests.
    vi.stubEnv('PGCHANNELBINDING', '')
    vi.stubEnv('PGSSLMODE', 'disable')
    vi.stubEnv('NODE_TLS_REJECT_UNAUTHORIZED', '0')
    const { passed, effective } = await connect(url)
    expect(passed?.[0]).toMatchObject({
      host: ['ep-fake-dew-a1b2c3d4-pooler.ap-southeast-1.aws.neon.tech'],
      port: [5432],
      database: 'neondb',
      username: 'neondb_owner',
      password: 'npg_FakePass123',
      ssl: VERIFIED,
      connection: {},
    })
    if (binding === undefined) expect(passed?.[0]).not.toHaveProperty('channel_binding')
    else expect(passed?.[0]).toHaveProperty('channel_binding', binding)
    expect(effective.ssl).toEqual(VERIFIED)
    // postgres-js defaults to 'prefer' (SCRAM-SHA-256-PLUS when offered); `require` must reach the driver as is.
    expect(effective.channel_binding).toBe(binding ?? 'prefer')
  })
  it('lets an explicit channel_binding in the URL win over PGCHANNELBINDING', async () => {
    vi.stubEnv('PGCHANNELBINDING', 'disable')
    const { passed } = await connect(`${NEON_POOLED}?sslmode=require&channel_binding=require`)
    expect(passed?.[0]).toHaveProperty('channel_binding', 'require')
  })
  it('still rejects a duplicated sslmode on a Neon URL', () => {
    const url = `${NEON_POOLED}?sslmode=require&channel_binding=require&sslmode=disable`
    expect(() => resolveDatabaseTarget({ DATABASE_URL: url, VERCEL: '1', VERCEL_ENV: 'preview' })).toThrow(
      /DATABASE_URL is invalid/,
    )
  })
  it('still refuses sslmode=disable on a Neon URL', () => {
    const url = `${NEON_POOLED}?sslmode=disable&channel_binding=require`
    expect(() => resolveDatabaseTarget({ DATABASE_URL: url })).toThrow(/DATABASE_URL is refused/)
  })
  it('logs the Neon host without the password', () => {
    const line = describeTarget({ kind: 'postgres', url: `${NEON_POOLED}?sslmode=require&channel_binding=require` })
    expect(line).toBe(
      'postgres host=ep-fake-dew-a1b2c3d4-pooler.ap-southeast-1.aws.neon.tech port=5432 db=neondb user=neondb_owner',
    )
    expect(line).not.toMatch(/npg_FakePass123|channel_binding/)
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
