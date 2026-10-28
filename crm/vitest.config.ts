import { defineConfig } from 'vitest/config'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin'

export default defineConfig(async () => {
  const migrations = await readD1Migrations('./drizzle')
  return {
    resolve: { tsconfigPaths: true },
    plugins: [
      tanstackStart(),
      viteReact(),
      cloudflareTest({
        wrangler: { configPath: './wrangler.jsonc' },
        miniflare: {
          bindings: {
            TEST_MIGRATIONS: migrations,
            BETTER_AUTH_SECRET: 'test-secret-at-least-32-characters-long',
            BETTER_AUTH_URL: 'http://localhost',
            SEED_ADMIN_EMAIL: 'owner@example.com',
            SEED_ADMIN_PASSWORD: 'owner password 123',
            // Intake: development mode with Cloudflare's always-passes dummy Turnstile secret. The siteverify
            // fetch is mocked in tests (test/intake-helpers.ts); production-mode tests pass their own env.
            ENVIRONMENT: 'development',
            TURNSTILE_SECRET_KEY: '1x0000000000000000000000000000000AA',
            INTAKE_ALLOWED_ORIGINS: 'https://turnersdecks.com,http://localhost:4321',
            // The Start plugin's `define` does not reach the externalized @tanstack/start-server-core in
            // the test pool, so without this the Worker never routes `/_serverFn/*` to server functions.
            // nodejs_compat exposes bindings on process.env, which is what the handler reads.
            TSS_SERVER_FN_BASE: '/_serverFn/',
          },
          // Test helpers sign in far more than 5 times a minute from one address; the limit itself is tested with a
          // fake limiter (test/auth-rate-limit.test.ts). Miniflare needs namespace_id here or no test file starts.
          ratelimits: { AUTH_RATE_LIMITER: { namespace_id: '2000', simple: { limit: 1_000_000, period: 60 } } },
        },
      }),
    ],
    test: {
      setupFiles: ['./test/apply-migrations.ts'],
      // The first request in each file cold-starts the Worker (~2 s, more when files run in parallel).
      testTimeout: 30_000,
      deps: {
        optimizer: {
          ssr: {
            enabled: true,
            include: ['react', 'react-dom', 'react-dom/server', 'react/jsx-runtime', 'react/jsx-dev-runtime'],
          },
        },
      },
    },
  }
})
