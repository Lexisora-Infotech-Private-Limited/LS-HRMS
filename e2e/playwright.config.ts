import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end journeys from the flow map, run against the real stack:
 *   API  http://localhost:4000 (built dist, seeded DB)
 *   Web  http://localhost:5173 (Vite dev server, proxies /api)
 * The database is reset + seeded once in global-setup, so specs run serially in file order.
 */
export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  globalSetup: './global-setup.ts',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    timezoneId: 'Asia/Kolkata',
    locale: 'en-IN',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } }],
  webServer: [
    {
      command: 'node dist/src/main.js',
      cwd: '../apps/api',
      url: 'http://localhost:4000/api/v1/health',
      reuseExistingServer: true,
      timeout: 120_000,
      env: { JOBS_DISABLED: 'true' },
    },
    {
      command: 'npx vite --port 5173 --strictPort',
      cwd: '../apps/web',
      url: 'http://localhost:5173',
      reuseExistingServer: true,
      timeout: 120_000,
    },
  ],
});
