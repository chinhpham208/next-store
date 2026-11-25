/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      comment: 'Circular dependencies make module init order fragile.',
      from: {},
      to: { circular: true },
    },
    {
      name: 'features-not-to-app',
      severity: 'error',
      comment: 'Dependency direction is app -> features, never back.',
      from: { path: '^src/features' },
      to: { path: '^src/app' },
    },
    {
      name: 'lower-layers-not-up',
      severity: 'error',
      comment: 'db, lib and components/ui are leaves: they must not reach into app or features.',
      from: { path: '^src/(db|lib|components)' },
      to: { path: '^src/(app|features)' },
    },
    {
      name: 'feature-public-api-only',
      severity: 'error',
      comment:
        'Outside a feature, import it only via @/features/<name> (index.ts). Exception: src/proxy.ts (and its test) ' +
        'use the narrow entry @/features/<name>/proxy-api, see proxy-narrow-entry.',
      from: { pathNot: '^src/(features/|proxy(\\.test)?\\.ts$)' },
      to: { path: '^src/features/[^/]+/(?!index\\.ts$)' },
    },
    {
      name: 'proxy-api-only-from-proxy',
      severity: 'error',
      comment: 'proxy-api.ts is the entry for src/proxy.ts only; everything else uses index.ts.',
      from: { pathNot: '^src/(features/([^/]+)/|proxy(\\.test)?\\.ts$)' },
      to: { path: '^src/features/[^/]+/proxy-api\\.ts$' },
    },
    {
      name: 'proxy-entry-only',
      severity: 'error',
      comment: 'src/proxy.ts may only reach a feature through its proxy-api.ts, never index.ts or another file.',
      from: { path: '^src/proxy\\.ts$' },
      to: { path: '^src/features/[^/]+/(?!proxy-api\\.ts$)' },
    },
    {
      name: 'proxy-narrow-entry',
      severity: 'error',
      comment:
        'The proxy runs before every /products/<slug> and /blog/<slug> request and is bundled on its own (audit PR ' +
        '#26 L1): it must not pull in components, zod, tailwind-merge or MDX (blog content.ts). Checked transitively.',
      from: { path: '^src/proxy\\.ts$' },
      to: {
        path: '^(src/(components|app)/|src/features/[^/]+/(index|components/|schema|queries|metadata|content)|node_modules/(zod|tailwind-merge|clsx|react|react-dom|@mdx-js|@next/mdx)/)',
        reachable: true,
      },
    },
    {
      name: 'proxy-no-db',
      severity: 'error',
      comment:
        'The proxy answers product and blog slugs from static registries (ADR-0012, ADR-0017, NS-79): on Vercel it ' +
        'runs at the edge nearest the visitor, far from the database, so it must never reach @/db or a driver, not ' +
        'even transitively.',
      from: { path: '^src/proxy\\.ts$' },
      to: {
        path: '^(src/db/|node_modules/(postgres|pg|@neondatabase/serverless|@electric-sql/pglite|drizzle-orm)/)',
        reachable: true,
      },
    },
    {
      name: 'admin-proxy-api-narrow',
      severity: 'error',
      comment:
        'The admin entry of the proxy (ADR-0018) checks the session cookie with Web Crypto only: it must not reach zod, ' +
        'a `server-only` file (config.ts, cookie.ts, password.ts, index.ts, next/headers) or the database, not even ' +
        'transitively. session.ts and config-rules.ts are the only admin files it may use.',
      from: { path: '^src/features/admin/proxy-api\\.ts$' },
      to: {
        path:
          '^(src/(db|components|app)/|src/features/admin/(?!(session|config-rules|types)\\.ts$)|src/features/(?!admin/)|' +
          'node_modules/(zod|server-only|postgres|pg|@neondatabase/serverless|@electric-sql/pglite|drizzle-orm|react|react-dom)/|' +
          'node_modules/next/(headers|navigation)\\.js$)',
        reachable: true,
      },
    },
    {
      name: 'db-public-api-only',
      severity: 'error',
      comment:
        'Outside src/db, import the database only via @/db (src/db/index.ts), so queries run through dbQuery ' +
        '(ADR-0011, ADR-0013): the raw client throws Drizzle errors that carry the SQL, the params and the host, and ' +
        'has no time limit. Tests may use @/db/client, migrate, seed and seed-data to set up data.',
      from: { path: '^src/', pathNot: '^src/db/|\\.test\\.ts$' },
      to: { path: '^src/db/', pathNot: '^src/db/index\\.ts$' },
    },
    {
      name: 'db-drivers-stay-in-db',
      severity: 'error',
      comment:
        'Only src/db talks to a driver (audit PR #38 L2): a client built elsewhere would skip the URL, TLS and role ' +
        'checks of client.ts and the timeout and recycling of dbQuery. Tests included. pg, @neondatabase/serverless ' +
        'and their Drizzle adapters are not installed: listed so that installing one is refused at once (NS-77).',
      from: { path: '^src/', pathNot: '^src/db/' },
      to: {
        path:
          '^node_modules/(postgres|pg|@neondatabase/serverless|@electric-sql/pglite|' +
          'drizzle-orm/(postgres-js|pglite|node-postgres|neon-http|neon-serverless))/',
      },
    },
    {
      name: 'feature-public-api-only-cross',
      severity: 'error',
      comment: 'One feature may use another only through its index.ts.',
      from: { path: '^src/features/([^/]+)/' },
      to: {
        path: '^src/features/[^/]+/(?!index\\.ts$)',
        pathNot: '^src/features/$1/',
      },
    },
  ],
  options: {
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.json' },
    doNotFollow: { path: 'node_modules' },
  },
}
