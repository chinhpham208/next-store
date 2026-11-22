import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// Test files that open a real PGlite, directly or by importing @/db/client (whose import opens the runtime one).
// A new file that does so belongs here too: under load its PGlite start alone can pass the default 5 s.
const DB_TEST_FILES = [
  'src/db/**/*.test.ts',
  'src/app/sitemap.test.ts',
  'src/features/products/{detail,listing,queries}.test.ts',
]

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      // Same alias as tsconfig; no test imports an .mdx file (Vitest does not compile MDX), but resolution stays in step.
      '@content': fileURLToPath(new URL('./content', import.meta.url)),
      // The real package throws outside a React Server environment.
      'server-only': fileURLToPath(new URL('./test/server-only-stub.ts', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    // Override, not default: a DATABASE_URL exported in the developer's shell must never reach the tests.
    env: {
      DATABASE_URL: '',
      DATABASE_URL_UNPOOLED: '',
      DATABASE_APP_USER: '',
      DATABASE_APP_PASSWORD: '',
      VERCEL: '',
      VERCEL_ENV: '',
      NEON_PRODUCTION_ENDPOINT: '',
      // postgres-js falls back to these libpq variables, so a developer's shell could change what the tests see.
      PGCHANNELBINDING: '',
      PGSSLMODE: '',
      PGLITE_DATA_DIR: 'memory://',
    },
    // NS-72: only the files that boot a real PGlite get longer limits. Each `new PGlite('memory://')` compiles the
    // WASM build and runs initdb: about 1–1.5 s on an idle 2-CPU machine, but up to 14 s measured at load 9–13 with
    // several worktrees running Vitest, past the 5 s default. Importing @/db/client boots one more in the background
    // (the runtime connection). The time goes to PGlite, not to the code under test, so only these limits change.
    // Every other test keeps the 5 s default, so a real hang there is still caught quickly.
    projects: [
      {
        extends: true,
        // `include` lives in the projects only: Vite merges arrays, so a root include would be added to each.
        test: { name: 'unit', include: ['src/**/*.test.ts'], exclude: DB_TEST_FILES },
      },
      {
        extends: true,
        test: { name: 'db', include: DB_TEST_FILES, testTimeout: 30_000, hookTimeout: 60_000 },
      },
    ],
  },
})
