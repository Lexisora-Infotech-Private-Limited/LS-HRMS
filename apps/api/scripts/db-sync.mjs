#!/usr/bin/env node
/**
 * Validate → generate Prisma client → push schema to the dev DB, under a cross-process lock
 * so several people/agents can run it concurrently without corrupting the generated client.
 *
 *   pnpm --filter @lexisora/api db:sync          # validate + generate + push
 *   pnpm --filter @lexisora/api db:sync --no-push
 */
import { execSync } from 'node:child_process';
import { mkdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const lock = join(root, '.db-sync.lock');
const noPush = process.argv.includes('--no-push');

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

const started = Date.now();
for (;;) {
  try {
    mkdirSync(lock);
    break;
  } catch {
    try {
      // Stale lock (crashed holder) after 3 minutes.
      if (Date.now() - statSync(lock).mtimeMs > 180_000) rmSync(lock, { recursive: true, force: true });
    } catch {}
    if (Date.now() - started > 600_000) {
      console.error('db-sync: timed out waiting for lock');
      process.exit(1);
    }
    sleep(1500);
  }
}

const run = (cmd) => execSync(cmd, { cwd: root, stdio: 'inherit' });
let code = 0;
try {
  run('npx prisma validate');
  for (let attempt = 1; ; attempt++) {
    try {
      execSync('npx prisma generate', { cwd: root, stdio: 'pipe' });
      console.log('Prisma client generated');
      break;
    } catch (e) {
      const out = String(e.stdout ?? '') + String(e.stderr ?? '');
      // Windows: a running node process holds the engine DLL. Wait for it to exit.
      if (/EPERM|EBUSY/.test(out) && attempt < 24) {
        console.warn('db-sync: Prisma engine locked by a running process (stop any API server); retrying…');
        sleep(5000);
        continue;
      }
      console.error(out);
      throw e;
    }
  }
  if (!noPush) run('npx prisma db push --skip-generate --accept-data-loss');
} catch {
  code = 1;
} finally {
  rmSync(lock, { recursive: true, force: true });
}
process.exit(code);
