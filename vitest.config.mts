import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      // The real package throws outside a React Server environment.
      'server-only': fileURLToPath(new URL('./test/server-only-stub.ts', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Override, not default: a DATABASE_URL exported in the developer's shell must never reach the tests.
    env: { DATABASE_URL: '', DATABASE_URL_UNPOOLED: '', VERCEL: '', VERCEL_ENV: '', PGLITE_DATA_DIR: 'memory://' },
  },
})
