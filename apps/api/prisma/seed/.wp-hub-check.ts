import { PrismaClient } from '@prisma/client';
import { PEOPLE } from './core';
import { seedHub } from './workplace';

const prisma = new PrismaClient();
async function main() {
  const tenant = await prisma.tenant.findFirst({ where: { name: 'Lexisora Infotech' } });
  if (!tenant) throw new Error('no tenant');
  const tenantId = tenant.id;
  const emps = await prisma.employee.findMany({ where: { tenantId }, select: { id: true, empCode: true, userId: true } });
  const emp: Record<string, string> = {};
  const user: Record<string, string> = {};
  for (const p of PEOPLE) {
    const e = emps.find((x) => x.empCode === p.code);
    if (e) { emp[p.key] = e.id; if (e.userId) user[p.key] = e.userId; }
  }
  const dept = Object.fromEntries((await prisma.department.findMany({ where: { tenantId } })).map((d) => [d.name, d.id]));
  const branch = Object.fromEntries((await prisma.branch.findMany({ where: { tenantId } })).map((d) => [d.name, d.id]));
  const atlas = await prisma.project.findFirst({ where: { tenantId, key: 'AT' } });
  const existing = await prisma.chatChannel.count({ where: { tenantId } });
  console.log('employees', Object.keys(emp).length, 'users', Object.keys(user).length, 'atlas', !!atlas, 'existing channels', existing);
  const t0 = Date.now();
  await prisma.$transaction(async (tx) => {
    await seedHub(tx as any, { tenantId, roles: {}, emp, user, dept, desig: {}, branch, extra: {} }, { atlasId: atlas?.id ?? null, file: async () => ({ id: 'seed-check-file' }) });
    const counts = {
      channels: await tx.chatChannel.count({ where: { tenantId } }), messages: await tx.chatMessage.count({ where: { tenantId } }), members: await tx.chatMember.count({ where: { tenantId } }),
      courses: await tx.course.count({ where: { tenantId } }), enrollments: await tx.enrollment.count({ where: { tenantId } }), certs: await tx.certificate.count({ where: { tenantId, type: 'COURSE' } }),
      rooms: await tx.room.count({ where: { tenantId } }), bookings: await tx.roomBooking.count({ where: { tenantId } }), visitors: await tx.visitor.count({ where: { tenantId } }),
      cameras: await tx.camera.count({ where: { tenantId } }), games: await tx.gameSession.count({ where: { tenantId } }),
    };
    const priyaUnread = await tx.chatMember.findMany({ where: { tenantId, userId: user.priya }, include: { channel: true } });
    console.log(JSON.stringify(counts));
    console.log(priyaUnread.map((m) => `${m.channel.name ?? 'DM'}:${m.channel.lastMessageSeq - m.lastReadSeq}`).join(' '));
    console.log('ms', Date.now() - t0);
    throw new Error('rollback');
  }, { timeout: 180_000, maxWait: 20_000 }).catch((e) => { if ((e as Error).message !== 'rollback') throw e; console.log('rolled back OK'); });
}
main().catch((e) => { console.error('FAILED', e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
