import { execSync } from 'node:child_process';
import { join } from 'node:path';

/** Fresh, fully seeded database for every e2e run (set E2E_SKIP_RESET=1 to keep data). */
export default async function globalSetup() {
  if (process.env.E2E_SKIP_RESET) return;
  const api = join(__dirname, '..', 'apps', 'api');
  execSync('npx prisma db push --force-reset --skip-generate --accept-data-loss', { cwd: api, stdio: 'inherit' });
  execSync('npx tsx prisma/seed/index.ts', { cwd: api, stdio: 'inherit' });
  // Clear Mailpit so invite-email assertions only see this run's mail.
  await fetch('http://localhost:8025/api/v1/messages', { method: 'DELETE' }).catch(() => undefined);
}
