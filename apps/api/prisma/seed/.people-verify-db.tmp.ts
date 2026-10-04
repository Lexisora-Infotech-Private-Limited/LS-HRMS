import { readFileSync } from 'node:fs';
for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m && !process.env[m[1]!]) process.env[m[1]!] = m[2]!.replace(/^"|"$/g, '');
}
async function main() {
  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient();
  const rows = await prisma.$queryRawUnsafe<{ datname: string }[]>(`SELECT datname FROM pg_database WHERE datname = '${process.env.VERIFY_DB}'`);
  if (!rows.length) await prisma.$executeRawUnsafe(`CREATE DATABASE ${process.env.VERIFY_DB}`);
  console.log(rows.length ? 'exists' : 'created');
  await prisma.$disconnect();
}
void main();
