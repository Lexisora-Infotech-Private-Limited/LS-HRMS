import { PrismaClient } from '@prisma/client';
import { seedCore } from './core';
import { seed_platform } from './platform';
import { seed_people } from './people';
import { seed_time } from './time';
import { seed_tracker } from './tracker';
import { seed_leavepay } from './leavepay';
import { seed_work } from './work';
import { seed_finance } from './finance';
import { seed_workplace } from './workplace';

/**
 * Seeds a fresh database with the Lexisora demo tenant. Run on an empty DB
 * (`pnpm db:reset`). Order matters: later domains reference earlier ones.
 */
async function main() {
  try {
    process.loadEnvFile('.env');
  } catch {}
  const prisma = new PrismaClient();
  const existing = await prisma.tenant.findUnique({ where: { domain: 'lexisora.hrms.app' } });
  if (existing) {
    console.log('Seed skipped: lexisora.hrms.app already exists (use pnpm db:reset).');
    await prisma.$disconnect();
    return;
  }
  const ctx = await seedCore(prisma);
  const steps: [string, (p: PrismaClient, c: typeof ctx) => Promise<void>][] = [
    ['platform', seed_platform],
    ['people', seed_people],
    ['work', seed_work],
    ['time', seed_time],
    ['tracker', seed_tracker],
    ['leavepay', seed_leavepay],
    ['finance', seed_finance],
    ['workplace', seed_workplace],
  ];
  for (const [name, fn] of steps) {
    const t = Date.now();
    await fn(prisma, ctx);
    console.log(`  seeded ${name} (${Date.now() - t} ms)`);
  }
  console.log('Seed complete. Sign in at workspace lexisora.hrms.app, e.g. priya.sharma@lexisora.com / password');
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
