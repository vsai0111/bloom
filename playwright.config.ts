import { defineConfig, devices } from '@playwright/test'

const PORT = Number(process.env.PORT ?? 3100)
const baseURL = `http://127.0.0.1:${PORT}`

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    command: `npm run start -- --port ${PORT}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: {
      BLOOM_DB_DRIVER: 'pglite',
      PGLITE_DATA_DIR: '.bloom/e2e-pgdata',
      BLOOM_AUTH_SECRET: 'e2e-secret-0000000000000000000000000000',
      BLOOM_LOG_LEVEL: 'error',
      /*
       * Force the local auth provider and the embedded database.
       *
       * `next start` loads `.env.local`, so without these a developer who has
       * configured a real Supabase project runs the whole journey against it:
       * every signup creates a live user and sends a real verification email,
       * until the project's send rate limit rejects the rest. The suite then
       * fails for a reason that has nothing to do with the code under test.
       *
       * Empty rather than deleted because `@next/env` only fills in variables
       * that are absent from the environment.
       */
      NEXT_PUBLIC_SUPABASE_URL: '',
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: '',
      DATABASE_URL: '',
    },
  },
})
