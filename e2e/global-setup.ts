import { execSync } from 'node:child_process';
import { join } from 'node:path';

/**
 * By default the config already provisioned a fresh database (non-destructive), so there is
 * nothing to do here. Only with E2E_RESET_DEV_DB=1 is the dev database force-reset and re-seeded —
 * that destroys its data, so Prisma's AI-safety guard will ask the user for consent.
 */
export default async function globalSetup() {
  // Clear Mailpit so invite-email assertions only see this run's mail.
  await fetch('http://localhost:8025/api/v1/messages', { method: 'DELETE' }).catch(() => undefined);
  if (!process.env.E2E_RESET_DEV_DB) return;
  const api = join(__dirname, '..', 'apps', 'api');
  execSync('npx prisma db push --force-reset --skip-generate --accept-data-loss', { cwd: api, stdio: 'inherit' });
  execSync('npx tsx prisma/seed/index.ts', { cwd: api, stdio: 'inherit' });
}
