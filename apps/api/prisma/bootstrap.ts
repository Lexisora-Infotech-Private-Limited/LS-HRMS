/**
 * First-run initialisation for a deployment (runs from the API container entrypoint).
 *
 *   • If any tenant already exists → does nothing (safe on every restart).
 *   • SEED_DEMO=true            → loads the full Lexisora demo data (prisma/seed), passwords "password".
 *   • otherwise                 → creates your real company workspace and its first admin:
 *       SETUP_COMPANY           e.g. "Lexisora Infotech"
 *       SETUP_DOMAIN            workspace address users type at sign-in, e.g. "lexisora.hrms.app"
 *       SETUP_ADMIN_NAME        e.g. "Rohit Verma"
 *       SETUP_ADMIN_EMAIL       official email of the first admin
 *       SETUP_ADMIN_PASSWORD    at least 10 characters (change it after the first sign-in)
 *       SETUP_STATE_CODE        optional GST state code, default "24" (Gujarat)
 *
 * The admin gets the Admin / CEO role (all default admin permissions) and is the platform admin of
 * this installation. Everything else — departments, shifts, locations, leave types, holidays,
 * employees — is configured in the web app. Attendance policies, the chart of accounts and filing
 * folders are created automatically on first use.
 */
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { ROLE_KEYS, ROLE_LABELS, defaultPermissionsFor } from '@lexisora/shared';

function need(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) {
    throw new Error(
      `${name} is not set. Either set SEED_DEMO=true for demo data, or set SETUP_COMPANY, SETUP_DOMAIN, ` +
        'SETUP_ADMIN_NAME, SETUP_ADMIN_EMAIL and SETUP_ADMIN_PASSWORD to create your company workspace.',
    );
  }
  return v;
}

async function main() {
  try {
    process.loadEnvFile('.env');
  } catch {}
  const prisma = new PrismaClient();
  try {
    if ((await prisma.tenant.count()) > 0) {
      console.log('bootstrap: workspace already initialised — nothing to do.');
      return;
    }

    if (process.env.SEED_DEMO === 'true') {
      console.log('bootstrap: loading demo data (SEED_DEMO=true)…');
      const r = spawnSync('npx', ['tsx', join('prisma', 'seed', 'index.ts')], { stdio: 'inherit', shell: true });
      if (r.status !== 0) throw new Error('demo seed failed');
      return;
    }

    const company = need('SETUP_COMPANY');
    const domain = need('SETUP_DOMAIN').toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    const adminName = need('SETUP_ADMIN_NAME');
    const adminEmail = need('SETUP_ADMIN_EMAIL').toLowerCase();
    const adminPassword = need('SETUP_ADMIN_PASSWORD');
    if (adminPassword.length < 10) throw new Error('SETUP_ADMIN_PASSWORD must be at least 10 characters.');
    if (!/^\S+@\S+\.\S+$/.test(adminEmail)) throw new Error('SETUP_ADMIN_EMAIL is not a valid email address.');
    const slug = domain.split('.')[0]!.replace(/[^a-z0-9-]/g, '') || 'company';
    const [first, ...rest] = adminName.split(/\s+/);

    await prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({
        data: {
          name: company,
          legalName: company,
          brandName: company.split(' ')[0],
          domain,
          slug,
          stateCode: process.env.SETUP_STATE_CODE?.trim() || '24',
        },
      });
      const roles: Record<string, string> = {};
      for (const key of ROLE_KEYS) {
        const r = await tx.role.create({
          data: { tenantId: tenant.id, key, name: ROLE_LABELS[key], isSystem: true, permissions: defaultPermissionsFor(key) },
        });
        roles[key] = r.id;
      }
      const dept = await tx.department.create({ data: { tenantId: tenant.id, name: 'Management' } });
      const desig = await tx.designation.create({ data: { tenantId: tenant.id, name: 'Administrator' } });
      const user = await tx.user.create({
        data: {
          tenantId: tenant.id,
          email: adminEmail,
          name: adminName,
          passwordHash: await bcrypt.hash(adminPassword, 10),
          roleId: roles.admin!,
          status: 'ACTIVE',
          isPlatformAdmin: true,
        },
      });
      await tx.employee.create({
        data: {
          tenantId: tenant.id,
          userId: user.id,
          empCode: 'EMP-0001',
          firstName: first!,
          lastName: rest.join(' ') || '-',
          fullName: adminName,
          officialEmail: adminEmail,
          departmentId: dept.id,
          designationId: desig.id,
          status: 'ACTIVE',
          workMode: 'OFFICE',
          joiningDate: new Date(new Date().toISOString().slice(0, 10)),
        },
      });
    });
    console.log(`bootstrap: created workspace "${company}" at ${domain}; sign in as ${adminEmail}.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(`bootstrap failed: ${(e as Error).message}`);
  process.exit(1);
});
