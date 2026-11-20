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
        'The proxy runs before every /products/<slug> request and is bundled on its own (audit PR #26 L1): it must ' +
        'not pull in components, zod or tailwind-merge. Checked transitively.',
      from: { path: '^src/proxy\\.ts$' },
      to: {
        path: '^(src/(components|app)/|src/features/[^/]+/(index|components/|schema|queries|metadata)|node_modules/(zod|tailwind-merge|clsx|react|react-dom)/)',
        reachable: true,
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
