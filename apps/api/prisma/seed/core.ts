import type { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { ROLE_KEYS, ROLE_LABELS, defaultPermissionsFor } from '@lexisora/shared';

export const DEMO_PASSWORD = 'password';

export type SeedCtx = {
  tenantId: string;
  roles: Record<string, string>; // key → roleId
  emp: Record<string, string>; // short key → employeeId
  user: Record<string, string>; // short key → userId
  dept: Record<string, string>;
  desig: Record<string, string>;
  branch: Record<string, string>;
  /** Shared bag for ids later domains need (e.g. extra.projects.AT). */
  extra: Record<string, any>;
};

type P = {
  key: string;
  first: string;
  last: string;
  code: string;
  email?: string;
  role: string;
  dept: string;
  desig: string;
  manager?: string;
  mode: 'OFFICE' | 'REMOTE' | 'HYBRID';
  type?: 'FULL_TIME' | 'INTERN';
  status?: 'ACTIVE' | 'NOTICE_PERIOD' | 'ONBOARDING';
  joined: string;
  blood?: string;
  branch?: string;
  dob?: string;
};

/** Wireframe cast. The first five are the "sign in as" personas. */
export const PEOPLE: P[] = [
  { key: 'rohit', first: 'Rohit', last: 'Verma', code: 'LX-0001', role: 'admin', dept: 'Management', desig: 'Chief Executive Officer', mode: 'OFFICE', joined: '2018-04-02', blood: 'O+', dob: '1984-06-11' },
  { key: 'kavya', first: 'Kavya', last: 'Iyer', code: 'LX-0012', role: 'hr', dept: 'HR', desig: 'HR Manager', manager: 'rohit', mode: 'OFFICE', joined: '2019-07-15', blood: 'A+', dob: '1990-02-19' },
  { key: 'neha', first: 'Neha', last: 'Kapoor', code: 'LX-0020', role: 'manager', dept: 'Development', desig: 'Engineering Manager', manager: 'rohit', mode: 'OFFICE', joined: '2020-01-06', blood: 'B-', dob: '1988-10-03' },
  { key: 'arjun', first: 'Arjun', last: 'Mehta', code: 'LX-0064', role: 'lead', dept: 'Development', desig: 'Project Lead', manager: 'neha', mode: 'HYBRID', joined: '2021-03-01', blood: 'AB+', dob: '1991-12-22' },
  { key: 'priya', first: 'Priya', last: 'Sharma', code: 'LX-0142', role: 'employee', dept: 'Development', desig: 'Software Engineer', manager: 'neha', mode: 'REMOTE', joined: '2024-01-12', blood: 'B+', dob: '1998-09-30' },
  { key: 'rahul', first: 'Rahul', last: 'Desai', code: 'LX-0118', role: 'employee', dept: 'Development', desig: 'Senior Engineer', manager: 'neha', mode: 'OFFICE', joined: '2023-02-20', blood: 'O-', dob: '1995-09-30' },
  { key: 'sneha', first: 'Sneha', last: 'Patel', code: 'LX-0131', role: 'lead', dept: 'QA', desig: 'QA Lead', manager: 'neha', mode: 'OFFICE', joined: '2023-10-02', blood: 'A-', dob: '1996-04-14' },
  { key: 'vikram', first: 'Vikram', last: 'Joshi', code: 'LX-0150', role: 'employee', dept: 'Design', desig: 'UI Designer', manager: 'arjun', mode: 'HYBRID', joined: '2025-03-03', blood: 'B+', branch: 'Pune', dob: '1997-01-08' },
  { key: 'ananya', first: 'Ananya', last: 'Rao', code: 'LX-0099', role: 'employee', dept: 'Finance', desig: 'Accountant', manager: 'rohit', mode: 'OFFICE', joined: '2022-08-01', status: 'NOTICE_PERIOD', blood: 'O+', dob: '1993-05-27' },
  { key: 'isha', first: 'Isha', last: 'Mehra', code: 'LX-I-021', role: 'employee', dept: 'Development', desig: 'Intern', manager: 'arjun', mode: 'OFFICE', type: 'INTERN', joined: '2026-09-15', dob: '2004-03-12' },
  { key: 'karan', first: 'Karan', last: 'Shah', code: 'LX-I-022', role: 'employee', dept: 'QA', desig: 'Intern', manager: 'sneha', mode: 'OFFICE', type: 'INTERN', joined: '2026-09-15', dob: '2004-07-21' },
  { key: 'divya', first: 'Divya', last: 'Nair', code: 'LX-I-023', role: 'employee', dept: 'Design', desig: 'Intern', manager: 'vikram', mode: 'OFFICE', type: 'INTERN', joined: '2026-09-15', branch: 'Pune', dob: '2003-11-02' },
  { key: 'meera', first: 'Meera', last: 'Iyer', code: 'LX-0160', role: 'employee', dept: 'QA', desig: 'QA Engineer', manager: 'sneha', mode: 'OFFICE', status: 'ONBOARDING', joined: '2026-10-06', dob: '1999-08-18' },
];

export async function seedCore(prisma: PrismaClient): Promise<SeedCtx> {
  const tenant = await prisma.tenant.create({
    data: {
      name: 'Lexisora Infotech',
      legalName: 'Lexisora Infotech Private Limited',
      domain: 'lexisora.hrms.app',
      slug: 'lexisora',
      gstin: '24AAECL1234F1Z1',
      pan: 'AAECL1234F',
      address: '4th Floor, Titanium City Centre, Satellite',
      city: 'Ahmedabad',
      stateCode: '24',
      stateName: 'Gujarat',
      phone: '+91 79 4000 1234',
      brandName: 'Lexisora',
    },
  });
  const tenantId = tenant.id;

  const roles: Record<string, string> = {};
  for (const key of ROLE_KEYS) {
    const r = await prisma.role.create({
      data: { tenantId, key, name: ROLE_LABELS[key], isSystem: true, permissions: defaultPermissionsFor(key) },
    });
    roles[key] = r.id;
  }

  const dept: Record<string, string> = {};
  for (const name of ['Management', 'Development', 'QA', 'Design', 'Finance', 'HR']) {
    dept[name] = (await prisma.department.create({ data: { tenantId, name } })).id;
  }
  const desig: Record<string, string> = {};
  for (const name of [...new Set(PEOPLE.map((p) => p.desig)), 'QA Engineer', 'React Developer', 'Accountant']) {
    if (!desig[name]) desig[name] = (await prisma.designation.create({ data: { tenantId, name } })).id;
  }
  const branch: Record<string, string> = {};
  branch.Ahmedabad = (await prisma.branch.create({ data: { tenantId, name: 'Ahmedabad', address: '4th Floor, Titanium City Centre, Ahmedabad' } })).id;
  branch.Pune = (await prisma.branch.create({ data: { tenantId, name: 'Pune', address: 'Baner Road, Pune' } })).id;

  const hash = await bcrypt.hash(DEMO_PASSWORD, 10);
  const emp: Record<string, string> = {};
  const user: Record<string, string> = {};
  for (const p of PEOPLE) {
    const email = p.email ?? `${p.first}.${p.last}`.toLowerCase() + '@lexisora.com';
    const u = await prisma.user.create({
      data: {
        tenantId,
        email,
        name: `${p.first} ${p.last}`,
        passwordHash: hash,
        roleId: roles[p.role]!,
        status: p.status === 'ONBOARDING' ? 'INVITED' : 'ACTIVE',
        isPlatformAdmin: p.key === 'rohit',
      },
    });
    user[p.key] = u.id;
    const e = await prisma.employee.create({
      data: {
        tenantId,
        userId: u.id,
        empCode: p.code,
        firstName: p.first,
        lastName: p.last,
        fullName: `${p.first} ${p.last}`,
        officialEmail: email,
        phone: '+91 98250 ' + String(10000 + Math.abs(hashCode(p.key)) % 89999),
        departmentId: dept[p.dept],
        designationId: desig[p.desig],
        branchId: branch[p.branch ?? 'Ahmedabad'],
        employmentType: p.type ?? 'FULL_TIME',
        workMode: p.mode,
        status: p.status ?? 'ACTIVE',
        joiningDate: new Date(p.joined),
        dateOfBirth: p.dob ? new Date(p.dob) : null,
        bloodGroup: p.blood,
        emergencyContactName: p.key === 'priya' ? 'Anil Sharma' : null,
        emergencyContactPhone: p.key === 'priya' ? '+91 98XXX XXX21' : null,
        noticeStartDate: p.status === 'NOTICE_PERIOD' ? new Date('2026-09-10') : null,
      },
    });
    emp[p.key] = e.id;
  }
  for (const p of PEOPLE) {
    if (p.manager) await prisma.employee.update({ where: { id: emp[p.key] }, data: { managerId: emp[p.manager] } });
  }
  await prisma.department.update({ where: { id: dept.Development }, data: { leadEmployeeId: emp.arjun } });
  await prisma.department.update({ where: { id: dept.QA }, data: { leadEmployeeId: emp.sneha } });
  await prisma.department.update({ where: { id: dept.Design }, data: { leadEmployeeId: emp.vikram } });

  // A second tenant proves isolation (Tenants screen, data privacy).
  const acme = await prisma.tenant.create({
    data: { name: 'Acme Logistics', domain: 'acme.hrms.app', slug: 'acme', stateCode: '27', stateName: 'Maharashtra', brandAccent: '#c62828', brandAccent2: '#1c1c1c' },
  });
  const acmeAdmin = await prisma.role.create({ data: { tenantId: acme.id, key: 'admin', name: 'Admin / CEO', isSystem: true, permissions: defaultPermissionsFor('admin') } });
  for (const key of ROLE_KEYS.filter((k) => k !== 'admin')) {
    await prisma.role.create({ data: { tenantId: acme.id, key, name: ROLE_LABELS[key], isSystem: true, permissions: defaultPermissionsFor(key) } });
  }
  await prisma.user.create({ data: { tenantId: acme.id, email: 'admin@acme.com', name: 'Acme Admin', passwordHash: hash, roleId: acmeAdmin.id } });

  return { tenantId, roles, emp, user, dept, desig, branch, extra: { acmeTenantId: acme.id } };
}

function hashCode(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}
