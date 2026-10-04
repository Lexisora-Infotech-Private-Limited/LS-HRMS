import { readFileSync } from 'node:fs';
for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m && !process.env[m[1]!]) process.env[m[1]!] = m[2]!.replace(/^"|"$/g, '');
}
process.env.STORAGE_DIR = process.argv[2]!;
const CODES: Record<string, string> = { rohit: 'LX-0001', kavya: 'LX-0012', neha: 'LX-0020', arjun: 'LX-0064', priya: 'LX-0142', rahul: 'LX-0118', sneha: 'LX-0131', vikram: 'LX-0150', ananya: 'LX-0099', isha: 'LX-I-021', karan: 'LX-I-022', divya: 'LX-I-023', meera: 'LX-0160' };
async function main() {
  const { PrismaClient } = await import('@prisma/client');
  const { seed_people_phase2 } = await import('./people');
  const prisma = new PrismaClient();
  const tenant = await prisma.tenant.findFirstOrThrow({ where: { slug: 'lexisora' } });
  const tenantId = tenant.id;
  const emps = await prisma.employee.findMany({ where: { tenantId } });
  const emp: Record<string, string> = {}; const user: Record<string, string> = {};
  for (const [k, code] of Object.entries(CODES)) { const e = emps.find((x) => x.empCode === code); if (e) { emp[k] = e.id; if (e.userId) user[k] = e.userId; } }
  const dept = Object.fromEntries((await prisma.department.findMany({ where: { tenantId } })).map((x) => [x.name, x.id]));
  const desig = Object.fromEntries((await prisma.designation.findMany({ where: { tenantId } })).map((x) => [x.name, x.id]));
  const branch = Object.fromEntries((await prisma.branch.findMany({ where: { tenantId } })).map((x) => [x.name, x.id]));
  const ctx = { tenantId, roles: {}, emp, user, dept, desig, branch, extra: {} as Record<string, any> };
  console.log('emp keys', Object.keys(emp).length, 'dept', Object.keys(dept).join(','));
  const t0 = Date.now();
  try {
    await prisma.$transaction(async (tx) => {
      await seed_people_phase2(tx as any, ctx as any);
      const counts = {
        rounds: await tx.interviewRound.count({ where: { tenantId } }), jobs: await tx.job.count({ where: { tenantId } }), candidates: await tx.candidate.count({ where: { tenantId } }),
        apps: await tx.jobApplication.groupBy({ by: ['jobId'], where: { tenantId }, _count: { _all: true } }), interviews: await tx.interview.count({ where: { tenantId } }),
        cycles: await tx.appraisalCycle.count({ where: { tenantId } }), participants: await tx.appraisalParticipant.count({ where: { tenantId } }), assets: await tx.asset.groupBy({ by: ['status'], where: { tenantId }, _count: { _all: true } }),
        kits: await tx.welcomeKitIssue.count({ where: { tenantId } }), cards: await tx.idCard.groupBy({ by: ['status'], where: { tenantId }, _count: { _all: true } }), batches: await tx.idCardPrintBatch.count({ where: { tenantId } }),
      };
      console.log(JSON.stringify(counts));
      throw new Error('rollback');
    }, { timeout: 180_000, maxWait: 20_000 });
  } catch (e) {
    console.log((e as Error).message === 'rollback' ? `OK (rolled back) in ${Date.now() - t0} ms` : `FAILED: ${(e as Error).stack}`);
  } finally {
    await prisma.$disconnect();
  }
}
void main();
