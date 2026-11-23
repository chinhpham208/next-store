import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

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
    include: ['src/**/*.test.ts'],
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
  },
})
