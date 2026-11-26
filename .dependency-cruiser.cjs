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
        'Outside a feature, import it only via @/features/<name> (index.ts). Exceptions: src/proxy.ts (and its test) ' +
        'use the narrow entry @/features/<name>/proxy-api, see proxy-narrow-entry; src/app/admin/** uses the admin ' +
        'entries @/features/(products|orders|monitoring)/admin, see admin-entries-only-from-admin; ' +
        'src/instrumentation.ts uses @/features/monitoring/report, see instrumentation-narrow.',
      from: { pathNot: '^src/(features/|proxy(\\.test)?\\.ts$|instrumentation(\\.test)?\\.ts$)' },
      to: {
        path: '^src/features/[^/]+/(?!index\\.ts$)',
        pathNot: '^src/features/((products|orders|monitoring)/admin|admin/ui)\\.ts$',
      },
    },
    {
      name: 'stock-only-from-orders',
      severity: 'error',
      comment:
        'products/stock.ts (decrementStockForOrder) is the only stock decrement for orders (audit PR #125 N1, ' +
        'PR #126 L1): it runs inside the order transaction and never touches the cache, so only ' +
        'features/orders/store.ts and the tests of products itself may import it. No blanket exemption for products/: a ' +
        're-export from products/index.ts would hand the function to every feature.',
      from: { pathNot: ['^src/features/orders/store\\.ts$', '^src/features/products/[^/]+\\.test\\.ts$'] },
      to: { path: '^src/features/products/stock\\.ts$' },
    },
    {
      name: 'admin-entries-only-from-admin',
      severity: 'error',
      comment:
        'admin.ts is the admin entry of products, orders and monitoring (audit PR #108 M-1, ADR-0023): the edit form ' +
        'and the admin tables are client references or admin-only code, and a shop page that imports them ships their ' +
        'chunk, and for products the id of updateProductAction. Only src/app/admin/** (and files of the same feature) ' +
        'may import it; scripts/check-admin-bundle.mjs checks the build.',
      from: { pathNot: '^src/(app/admin/|features/(products|orders|monitoring)/)' },
      to: { path: '^src/features/(products|orders|monitoring)/admin\\.ts$' },
    },
    {
      name: 'admin-ui-entry-only-from-admin',
      severity: 'error',
      comment:
        'ui.ts is the admin UI entry of admin (audit PR #124 M2): LoginForm and LogoutButton are client references, and ' +
        'shop-reachable code (checkout reads the session through index.ts) that imports them ships their chunk and the ' +
        'ids of loginAction / logoutAction. Only src/app/admin/** (and files of admin itself) may import it.',
      from: { pathNot: '^src/(app/admin/|features/admin/)' },
      to: { path: '^src/features/admin/ui\\.ts$' },
    },
    {
      name: 'shop-not-to-admin-components',
      severity: 'error',
      comment:
        'Nothing the shop reaches may reach the admin components (audit PR #124 M2); scripts/check-admin-bundle.mjs ' +
        'checks the build, this one checks the import graph, so a barrel that grows a component again is red at once.',
      from: { path: '^src/(app/\\(shop\\)/|features/(checkout|cart|orders)/)' },
      to: { path: '^src/features/admin/(components/|ui\\.ts$)', reachable: true },
    },
    {
      name: 'orders-not-to-checkout',
      severity: 'error',
      comment: 'orders is below checkout (plan M6): the event types live in orders so that orders never imports checkout.',
      from: { path: '^src/features/orders/' },
      to: { path: '^src/features/checkout/' },
    },
    {
      name: 'components-and-lib-not-to-db',
      severity: 'error',
      comment:
        'Shared UI and helpers never read the database (audit PR #108 L-1): a static admin file (not-found, loading, ' +
        'error) may import @/components and @/lib/cn without a session check, so a component that queried @/db would ' +
        'put rows on screen. Drivers are already refused by db-drivers-stay-in-db. Checked transitively.',
      from: { path: '^src/(components|lib)/' },
      to: {
        path: '^(src/db/|node_modules/(postgres|pg|@neondatabase/serverless|@electric-sql/pglite|drizzle-orm)/)',
        reachable: true,
      },
    },
    {
      name: 'instrumentation-narrow',
      severity: 'error',
      comment:
        'src/instrumentation.ts is bundled for the edge runtime too (C4, ADR-0022): it may import statically only the ' +
        'pure @/features/monitoring/report; the part that writes (@/features/monitoring, with @/db) only with import(), ' +
        'at run time, on the Node.js runtime. Nothing else of src. scripts/check-proxy-bundle.mjs checks the build.',
      from: { path: '^src/instrumentation\\.ts$' },
      to: {
        path: '^src/',
        pathNot: '^src/features/monitoring/(report\\.ts|index\\.ts)$',
      },
    },
    {
      name: 'instrumentation-index-only-dynamic',
      severity: 'error',
      comment: 'The writing half of monitoring is loaded with import(), never at the top of src/instrumentation.ts.',
      from: { path: '^src/instrumentation\\.ts$' },
      to: { path: '^src/features/monitoring/index\\.ts$', dynamic: false },
    },
    {
      name: 'monitoring-report-pure',
      severity: 'error',
      comment:
        'report.ts is imported statically by src/instrumentation.ts, so it is in the edge bundle: it imports nothing ' +
        '(no @/db, no server-only, no zod; Web Crypto is a global). Not even a type, so the rule stays one line.',
      from: { path: '^src/features/monitoring/report\\.ts$' },
      to: { path: '^(src/|node_modules/)' },
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
        'transitively. session.ts, config-rules.ts, cookie-name.ts, csp.ts and types.ts are the only admin files it may use.',
      from: { path: '^src/features/admin/proxy-api\\.ts$' },
      to: {
        path:
          '^(src/(db|components|app)/|src/features/admin/(?!(session|config-rules|cookie-name|csp|types)\\.ts$)|' +
          'src/features/(?!admin/)|' +
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
      comment:
        'One feature may use another only through its index.ts. The one exception is products/stock.ts, which only ' +
        'orders/store.ts may import (stock-only-from-orders).',
      from: { path: '^src/features/([^/]+)/' },
      to: {
        path: '^src/features/[^/]+/(?!index\\.ts$)',
        pathNot: ['^src/features/$1/', '^src/features/products/stock\\.ts$'],
      },
    },
  ],
  options: {
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.json' },
    doNotFollow: { path: 'node_modules' },
  },
}
