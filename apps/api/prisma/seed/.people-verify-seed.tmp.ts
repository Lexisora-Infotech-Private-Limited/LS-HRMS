import { readFileSync } from 'node:fs';
for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m && !process.env[m[1]!]) process.env[m[1]!] = m[2]!.replace(/^"|"$/g, '');
}
async function main() {
  if (!process.env.DATABASE_URL?.includes(process.env.VERIFY_DB!)) throw new Error('refusing: not the scratch DB');
  const { PrismaClient } = await import('@prisma/client');
  const { seedCore } = await import('./core');
  const { seed_people } = await import('./people');
  const prisma = new PrismaClient();
  if (await prisma.tenant.count()) { console.log('already seeded'); return; }
  const ctx = await seedCore(prisma);
  const t0 = Date.now();
  await seed_people(prisma, ctx);
  console.log('people seeded in', Date.now() - t0, 'ms');
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
