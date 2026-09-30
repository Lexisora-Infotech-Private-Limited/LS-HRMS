import { execSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end journeys from the flow map, run against the real stack:
 *   API  http://localhost:4000 (built dist)   Web  http://localhost:5173 (Vite dev server, proxies /api)
 *
 * Test data (non-destructive by default): every run creates a brand-new database
 * `hrms_e2e_<timestamp>` on the local Postgres container, pushes the schema, seeds it and starts
 * the API against it with its own storage folder (e2e/.storage/<db>). Nothing existing is touched.
 *   E2E_USE_DEV_DB=1    run against the already-running API / dev DB instead (no seeding)
 *   E2E_RESET_DEV_DB=1  force-reset + seed the dev DB (destructive; Prisma asks for user consent)
 * Old hrms_e2e_* databases and e2e/.storage are left for you to clean up when convenient.
 */
const API_DIR = join(__dirname, '..', 'apps', 'api');

function provisionDatabase(): { url: string; storage: string } | undefined {
  if (process.env.E2E_DB_URL) return { url: process.env.E2E_DB_URL, storage: process.env.E2E_STORAGE_DIR! };
  if (process.env.E2E_USE_DEV_DB || process.env.E2E_RESET_DEV_DB) return undefined;
  // Runs once in the main process; workers inherit E2E_DB_URL and skip this.
  const name = `hrms_e2e_${Date.now()}`;
  execSync(`docker exec lexisora-hrms-postgres-1 psql -U hrms -d postgres -c "CREATE DATABASE ${name}"`, { stdio: 'inherit' });
  const url = `postgresql://hrms:hrms@localhost:5433/${name}?schema=public`;
  const storage = join(__dirname, '.storage', name);
  mkdirSync(storage, { recursive: true });
  const env = { ...process.env, DATABASE_URL: url, STORAGE_DIR: storage };
  execSync('npx prisma db push --skip-generate', { cwd: API_DIR, stdio: 'inherit', env });
  execSync('npx tsx prisma/seed/index.ts', { cwd: API_DIR, stdio: 'inherit', env });
  process.env.E2E_DB_URL = url;
  process.env.E2E_STORAGE_DIR = storage;
  return { url, storage };
}

const db = provisionDatabase();

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
      cwd: API_DIR,
      url: 'http://localhost:4000/api/v1/health',
      // A fresh database needs its own API process; never reuse one pointed at another DB.
      reuseExistingServer: !db,
      timeout: 120_000,
      env: db ? { DATABASE_URL: db.url, STORAGE_DIR: db.storage } : {},
    },
    {
      command: 'npx vite --port 5173 --strictPort',
      cwd: join(__dirname, '..', 'apps', 'web'),
      url: 'http://localhost:5173',
      reuseExistingServer: true,
      timeout: 120_000,
    },
  ],
});
