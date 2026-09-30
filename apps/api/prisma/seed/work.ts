import { createHash } from 'crypto';
import type { PrismaClient, TaskStatus } from '@prisma/client';
import { gstinCheckDigit } from '@lexisora/shared';
import type { SeedCtx } from './core';

/**
 * Demo data for the work domain (matches the wireframe sample rows, "today" = Tue 29 Sep 2026).
 *
 * Project progress/health are recomputed by WorkMetricsService on read (progress = Σ estimate × status
 * weight / max(Σ estimates, budget)), so each project carries enough historic DONE tasks for the
 * computed values to land on the wireframe figures: Atlas 64 %, Orbit 30 %, Kestrel 82 % (at risk:
 * 98 % of the schedule elapsed), Ledger sync 10 % (planning).
 *
 * Exposes ctx.extra.projects = { AT, OR, KS, LS, INT } and ctx.extra.tasks = { 'AT-101': id, … }.
 */

const NAME: Record<string, string> = {
  rohit: 'Rohit Verma', kavya: 'Kavya Iyer', neha: 'Neha Kapoor', arjun: 'Arjun Mehta', priya: 'Priya Sharma',
  rahul: 'Rahul Desai', sneha: 'Sneha Patel', vikram: 'Vikram Joshi', isha: 'Isha Mehra', karan: 'Karan Shah', divya: 'Divya Nair', meera: 'Meera Iyer',
};

const d = (k: string) => new Date(`${k}T00:00:00.000Z`);
/** IST wall-clock → UTC instant. */
const at = (k: string, hhmm: string) => new Date(new Date(`${k}T${hhmm}:00.000+05:30`).toISOString());
const H = (h: number) => Math.round(h * 60);
const gstin = (first14: string) => first14 + gstinCheckDigit(first14);
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

type Dept = 'Development' | 'QA' | 'Design';
type TaskSeed = {
  n: number;
  title: string;
  module?: string;
  dept?: Dept;
  status: TaskStatus;
  who?: string;
  est?: number; // hours
  logged?: number; // hours before tracking (openingLoggedMinutes)
  due?: string;
  standing?: boolean;
  desc?: string;
  git?: { branch?: boolean; mrIid?: number; mrState?: 'opened' | 'merged' | 'closed' };
};

const HISTORY_TITLES: Record<string, string[]> = {
  Billing: ['Invoice numbering series', 'Tax slab configuration', 'Credit note flow', 'Payment reminders', 'Razorpay payment link', 'Invoice email templates', 'Billing address book', 'Proforma invoices', 'Recurring invoices'],
  Auth: ['SSO with Google Workspace', 'Password reset flow', 'Two-step login OTP', 'User invitations', 'Audit trail for logins', 'Role editor', 'Account lockout policy'],
  Reports: ['Sales pipeline report', 'Customer ageing report', 'CSV export for reports', 'Scheduled report emails', 'Report builder filters', 'Top customers widget', 'Revenue by region chart', 'Churn cohort report'],
  Onboarding: ['Splash & sign-up screens', 'Phone OTP login', 'Address picker with maps', 'Profile & preferences'],
  Ordering: ['Menu catalogue sync', 'Cart & coupons', 'Order tracking screen', 'Reorder from history'],
  Payments: ['UPI intent payments', 'Card tokenisation', 'Refund status screen'],
  Leave: ['Leave apply screen', 'Leave balance widget', 'Holiday calendar'],
  Attendance: ['Punch widget', 'Monthly attendance view', 'Regularisation form'],
  Profile: ['Profile header & tabs', 'Document vault view', 'Emergency contacts'],
};

/** Historic DONE tasks whose estimates add up to `totalHours` exactly. */
function history(from: number, count: number, totalHours: number, modules: string[], people: string[], dept: Dept = 'Development'): TaskSeed[] {
  const base = Math.floor(totalHours / count);
  let rest = totalHours - base * count;
  const out: TaskSeed[] = [];
  const used = new Map<string, number>();
  for (let i = 0; i < count; i++) {
    const module = modules[i % modules.length]!;
    const list = HISTORY_TITLES[module] ?? ['Implementation task'];
    const idx = used.get(module) ?? 0;
    used.set(module, idx + 1);
    const title = list[idx % list.length]! + (idx >= list.length ? ` (part ${Math.floor(idx / list.length) + 1})` : '');
    const est = base + (rest > 0 ? 1 : 0);
    if (rest > 0) rest--;
    out.push({ n: from + i, title, module, dept, status: 'DONE', who: people[i % people.length], est, logged: Math.round(est * (0.9 + ((i * 7) % 5) * 0.04)) });
  }
  return out;
}

export async function seed_work(prisma: PrismaClient, ctx: SeedCtx): Promise<void> {
  const tenantId = ctx.tenantId;
  const E = (k: string | undefined) => (k ? ctx.emp[k] ?? null : null);
  const dept: Record<Dept, string | undefined> = { Development: ctx.dept.Development, QA: ctx.dept.QA, Design: ctx.dept.Design };

  // ── Clients ───────────────────────────────────────────────────────────
  const clientSeeds = [
    { code: 'CL-0001', name: 'Nimbus Retail', legalName: 'Nimbus Retail Private Limited', gstin: gstin('27AABCN4821K1Z'), pan: 'AABCN4821K', stateCode: '27', city: 'Mumbai', pincode: '400051', address: '7th Floor, One BKC, Bandra Kurla Complex, Mumbai', billingEmails: ['accounts@nimbusretail.in', 'ap@nimbusretail.in'], rate: 125000, terms: 30, contactName: 'Aditi Kulkarni', contactPhone: '+91 98200 41122' },
    { code: 'CL-0002', name: 'Zephyr Foods', legalName: 'Zephyr Foods LLP', gstin: gstin('29AAKFZ7314M1Z'), pan: 'AAKFZ7314M', stateCode: '29', city: 'Bengaluru', pincode: '560038', address: '12, 100 Feet Road, Indiranagar, Bengaluru', billingEmails: ['finance@zephyrfoods.in'], rate: 110000, terms: 15, contactName: 'Karthik Rao', contactPhone: '+91 99001 23456' },
    { code: 'CL-0003', name: 'Crest Labs', legalName: 'Crest Labs Private Limited', gstin: gstin('24AAHCC5190P1Z'), pan: 'AAHCC5190P', stateCode: '24', city: 'Ahmedabad', pincode: '380054', address: '302, Shivalik Shilp, Iscon Cross Road, Ahmedabad', billingEmails: ['billing@crestlabs.io'], rate: 140000, terms: 15, contactName: 'Hardik Shah', contactPhone: '+91 98250 77881' },
    { code: 'CL-0004', name: 'Ardent Co.', legalName: 'Ardent Commerce Private Limited', gstin: gstin('07AAECA2468Q1Z'), pan: 'AAECA2468Q', stateCode: '07', city: 'New Delhi', pincode: '110019', address: 'B-14, Okhla Industrial Area Phase 2, New Delhi', billingEmails: ['payables@ardent.co.in'], rate: 100000, terms: 30, contactName: 'Simran Kaur', contactPhone: '+91 98110 55443' },
  ];
  const client: Record<string, string> = {};
  for (const c of clientSeeds) {
    const row = await prisma.client.create({
      data: {
        tenantId, code: c.code, name: c.name, legalName: c.legalName, gstRegType: 'REGULAR', gstin: c.gstin, pan: c.pan,
        address: c.address, city: c.city, pincode: c.pincode, stateCode: c.stateCode, billingEmails: c.billingEmails,
        defaultRatePerHourPaise: c.rate, paymentTermsDays: c.terms, contactName: c.contactName, contactPhone: c.contactPhone, createdAt: d('2025-04-01'),
      },
    });
    client[c.name] = row.id;
  }
  client.Internal = (
    await prisma.client.create({
      data: { tenantId, code: 'CL-0005', name: 'Internal', legalName: 'Lexisora Infotech (internal)', isInternal: true, gstRegType: 'UNREGISTERED', stateCode: '24', city: 'Ahmedabad', billingEmails: [], paymentTermsDays: 0 },
    })
  ).id;
  // Next client created from the UI gets CL-0006.
  await prisma.numberSequence.upsert({
    where: { tenantId_key_period: { tenantId, key: 'client.code', period: '' } },
    create: { id: `seq_${tenantId}_client.code_`, tenantId, key: 'client.code', period: '', nextValue: 6 },
    update: { nextValue: 6 },
  });

  // ── Projects ──────────────────────────────────────────────────────────
  type ProjectSeed = {
    key: string; name: string; description: string; client: string; isInternal?: boolean; isSystem?: boolean; category: string; tech: string[];
    lead: string; start?: string; deadline?: string; billable: boolean; rate?: number; estH: number; status: 'PLANNING' | 'ACTIVE';
    boards: Dept[]; repo?: string; archiveAccess?: string; modules: string[];
    members: [string, string][]; boardMembers: Partial<Record<Dept, string[]>>; tasks: TaskSeed[]; loggedH: number; progress: number; health: 'NA' | 'ON_TRACK' | 'AT_RISK'; healthReason?: string;
  };

  const projects: ProjectSeed[] = [
    {
      key: 'AT', name: 'Atlas CRM', description: 'Customer relationship management suite for Nimbus Retail stores: billing, customer records and sales reports.',
      client: 'Nimbus Retail', category: 'WEB', tech: ['React', 'NestJS', 'PostgreSQL'], lead: 'arjun', start: '2026-03-02', deadline: '2026-12-18',
      billable: true, rate: 125000, estH: 820, status: 'ACTIVE', boards: ['Development', 'QA', 'Design'], repo: 'https://gitlab.com/lexisora/atlas-crm.git',
      modules: ['Billing', 'Auth', 'Reports'],
      members: [['arjun', 'LEAD'], ['priya', 'MEMBER'], ['rahul', 'MEMBER'], ['isha', 'MEMBER'], ['sneha', 'QA'], ['karan', 'QA'], ['vikram', 'DESIGN'], ['divya', 'DESIGN']],
      boardMembers: { Development: ['priya', 'rahul', 'isha'], QA: ['karan'], Design: ['divya'] },
      loggedH: 540, progress: 64, health: 'ON_TRACK',
      tasks: [
        ...history(77, 24, 512, ['Billing', 'Auth', 'Reports'], ['priya', 'rahul', 'arjun']),
        { n: 101, title: 'Invoice PDF export', module: 'Billing', dept: 'Development', status: 'WIP', who: 'priya', est: 8, due: '2026-10-01', desc: 'Export any invoice as a GST-compliant PDF (A4) with the client’s billing address, HSN/SAC and tax breakup. Use the existing invoice template from Design.', git: { branch: true } },
        { n: 102, title: 'GST rounding rules', module: 'Billing', dept: 'Development', status: 'DEV_COMPLETED', who: 'rahul', est: 5, logged: 4, due: '2026-09-30', desc: 'Round tax at line level (half-up to the paisa) and the invoice total to the nearest rupee with a round-off line.', git: { branch: true, mrIid: 48, mrState: 'opened' } },
        { n: 103, title: 'Role-based menu', module: 'Auth', dept: 'Development', status: 'ALLOTTED', who: 'priya', est: 6, due: '2026-10-05', desc: 'Show only the menu items a role is permitted to use; hide empty groups.' },
        { n: 104, title: 'Customer import CSV', module: 'Reports', dept: 'Development', status: 'OPEN', est: 10, due: '2026-10-09', desc: 'Upload a CSV of customers, validate rows, preview errors and import in the background.' },
        { n: 105, title: 'Session timeout', module: 'Auth', dept: 'Development', status: 'QA', who: 'rahul', est: 3, logged: 3, due: '2026-09-29', desc: 'Sign users out after 30 minutes of inactivity with a 2-minute warning dialog.', git: { branch: true, mrIid: 46, mrState: 'merged' } },
        { n: 106, title: 'Dashboard filters', module: 'Reports', dept: 'Development', status: 'OPEN', est: 4, due: '2026-10-12', desc: 'Date range, store and salesperson filters on the CRM dashboard, persisted per user.' },
        { n: 107, title: 'Regression suite: billing', module: 'Billing', dept: 'QA', status: 'OPEN', est: 6, due: '2026-10-06', desc: 'Automate the billing regression checklist (invoice, credit note, rounding).' },
        { n: 108, title: 'Invoice template design', module: 'Billing', dept: 'Design', status: 'DONE', who: 'divya', est: 4, logged: 4 },
        { n: 109, title: 'Empty states for reports', module: 'Reports', dept: 'Design', status: 'WIP', who: 'divya', est: 3, logged: 1, due: '2026-10-02' },
        { n: 110, title: 'Code review', dept: 'Development', status: 'WIP', who: 'priya', standing: true, desc: 'Standing task for reviewing merge requests on Atlas CRM.' },
      ],
    },
    {
      key: 'OR', name: 'Orbit HR portal', description: 'Internal self-service HR portal: leave, attendance and employee profile.',
      client: 'Internal', isInternal: true, category: 'INTERNAL', tech: ['React', 'Node.js'], lead: 'neha', start: '2026-06-01', deadline: '2027-01-29',
      billable: false, estH: 600, status: 'ACTIVE', boards: ['Development', 'QA'], repo: 'https://gitlab.com/lexisora/orbit-hr.git',
      modules: ['Leave', 'Attendance', 'Profile'],
      members: [['neha', 'LEAD'], ['rahul', 'MEMBER'], ['priya', 'MEMBER'], ['sneha', 'QA']],
      boardMembers: { Development: ['rahul', 'priya'], QA: ['sneha'] },
      loggedH: 190, progress: 30, health: 'ON_TRACK',
      tasks: [
        ...history(14, 12, 170, ['Leave', 'Attendance', 'Profile'], ['rahul', 'priya']),
        { n: 26, title: 'Leave approval inbox', module: 'Leave', dept: 'Development', status: 'WIP', who: 'rahul', est: 16, logged: 4, due: '2026-10-08', git: { branch: true } },
        { n: 27, title: 'Attendance calendar export', module: 'Attendance', dept: 'Development', status: 'DEV_COMPLETED', who: 'priya', est: 8, logged: 7, due: '2026-10-01', git: { branch: true, mrIid: 12, mrState: 'opened' } },
        { n: 28, title: 'Profile photo cropper', module: 'Profile', dept: 'Development', status: 'OPEN', est: 12, due: '2026-10-20' },
        { n: 29, title: 'Holiday list admin', module: 'Leave', dept: 'Development', status: 'ALLOTTED', who: 'rahul', est: 6, due: '2026-10-14' },
      ],
    },
    {
      key: 'KS', name: 'Kestrel mobile app', description: 'Food-ordering mobile app (Android & iOS) for Zephyr Foods outlets.',
      client: 'Zephyr Foods', category: 'MOBILE', tech: ['React Native', 'NestJS'], lead: 'arjun', start: '2026-04-01', deadline: '2026-10-02',
      billable: true, rate: 110000, estH: 400, status: 'ACTIVE', boards: ['Development', 'QA'], repo: 'https://gitlab.com/lexisora/kestrel-app.git',
      modules: ['Onboarding', 'Ordering', 'Payments'],
      members: [['arjun', 'LEAD'], ['rahul', 'MEMBER'], ['priya', 'MEMBER'], ['sneha', 'QA']],
      boardMembers: { Development: ['rahul', 'priya'], QA: [] },
      loggedH: 372, progress: 82, health: 'AT_RISK', healthReason: '98% of the schedule elapsed vs 82% progress',
      tasks: [
        ...history(31, 10, 310, ['Onboarding', 'Ordering', 'Payments'], ['rahul', 'priya', 'arjun']),
        { n: 41, title: 'Payment failure retry', module: 'Payments', dept: 'Development', status: 'QA', who: 'rahul', est: 12, logged: 13, due: '2026-09-30', git: { branch: true, mrIid: 22, mrState: 'merged' } },
        { n: 42, title: 'Push notifications for order status', module: 'Ordering', dept: 'Development', status: 'DEV_COMPLETED', who: 'priya', est: 10, logged: 11, due: '2026-09-30', git: { branch: true, mrIid: 23, mrState: 'opened' } },
        { n: 43, title: 'Offline cart persistence', module: 'Ordering', dept: 'Development', status: 'WIP', who: 'rahul', est: 8, logged: 6, due: '2026-10-01', git: { branch: true } },
        { n: 44, title: 'App store screenshots', module: 'Onboarding', dept: 'Development', status: 'OPEN', est: 6, due: '2026-10-02' },
      ],
    },
    {
      key: 'LS', name: 'Ledger sync', description: 'Two-way sync of vouchers and invoices with Tally Prime.',
      client: 'Internal', isInternal: true, category: 'INTERNAL', tech: ['Node.js', 'Tally XML'], lead: 'rahul', start: '2026-09-21', deadline: '2026-12-31',
      billable: false, estH: 120, status: 'PLANNING', boards: ['Development'], modules: ['Sync engine'],
      members: [['rahul', 'LEAD']], boardMembers: { Development: ['rahul'] },
      loggedH: 14, progress: 10, health: 'NA',
      tasks: [
        { n: 1, title: 'Spike: Tally XML export format', module: 'Sync engine', dept: 'Development', status: 'DONE', who: 'rahul', est: 10, logged: 12 },
        { n: 2, title: 'Sync schema design', module: 'Sync engine', dept: 'Development', status: 'WIP', who: 'rahul', est: 8, logged: 2, due: '2026-10-06' },
      ],
    },
    {
      key: 'INT', name: 'Internal', description: 'Standing internal activities every employee can log time against (meetings, training).',
      client: 'Internal', isInternal: true, isSystem: true, category: 'INTERNAL', tech: [], lead: 'neha', billable: false, estH: 0, status: 'ACTIVE', boards: [], modules: [],
      members: [], boardMembers: {}, loggedH: 0, progress: 0, health: 'NA',
      tasks: [
        { n: 1, title: 'Stand-up & meetings', status: 'WIP', standing: true, desc: 'Daily stand-ups, sprint ceremonies and internal meetings.' },
        { n: 2, title: 'Training', status: 'WIP', standing: true, desc: 'Courses, workshops and self-learning.' },
      ],
    },
  ];

  ctx.extra.projects = ctx.extra.projects ?? {};
  ctx.extra.tasks = ctx.extra.tasks ?? {};
  ctx.extra.clients = client;

  const repoMrSeq: { repo: string; next: number }[] = [];

  for (const p of projects) {
    const taskLoggedMin = p.tasks.reduce((s, t) => s + H(t.logged ?? 0), 0);
    const opening = Math.max(0, H(p.loggedH) - taskLoggedMin);
    const deptIds = p.boards.map((b) => dept[b]).filter((x): x is string => !!x);
    const project = await prisma.project.create({
      data: {
        tenantId, key: p.key, name: p.name, description: p.description, clientId: client[p.client] ?? null, isInternal: !!p.isInternal, isSystem: !!p.isSystem,
        category: p.category, techStack: p.tech, leadEmployeeId: E(p.lead), startDate: p.start ? d(p.start) : null, deadline: p.deadline ? d(p.deadline) : null,
        billable: p.billable, ratePerHourPaise: p.rate ?? null, estimatedMinutes: H(p.estH), loggedMinutes: H(p.loggedH), openingLoggedMinutes: opening,
        progressPct: p.progress, status: p.status, health: p.health, healthReason: p.healthReason ?? null, healthComputedAt: new Date(),
        boardDepartmentIds: deptIds, gitRepoUrl: p.repo ?? null, gitTargetBranch: 'develop', gitLinkStatus: p.repo ? 'LINKED' : 'UNLINKED',
        taskSeq: Math.max(0, ...p.tasks.map((t) => t.n)), archiveAccess: p.archiveAccess ?? 'LEADS_ONLY', createdByEmployeeId: E('neha'),
        createdAt: p.start ? d(p.start) : d('2025-04-01'),
      },
    });
    ctx.extra.projects[p.key] = project.id;

    if (p.modules.length) {
      await prisma.projectModule.createMany({ data: p.modules.map((name, i) => ({ tenantId, projectId: project.id, name, sortOrder: i })) });
    }
    const members = p.members.filter(([k]) => E(k));
    if (members.length) {
      await prisma.projectMember.createMany({ data: members.map(([k, role]) => ({ tenantId, projectId: project.id, employeeId: E(k)!, role })) });
    }
    for (const [b, keys] of Object.entries(p.boardMembers) as [Dept, string[]][]) {
      const depId = dept[b];
      if (!depId) continue;
      const lead = await prisma.department.findUnique({ where: { id: depId }, select: { leadEmployeeId: true } });
      const rows = keys.filter((k) => E(k)).map((k) => ({ tenantId, projectId: project.id, departmentId: depId, employeeId: E(k)!, allocatedByEmployeeId: lead?.leadEmployeeId ?? null, allocatedAt: d(p.start ?? '2026-09-01') }));
      if (rows.length) await prisma.boardMember.createMany({ data: rows });
    }

    const repoWeb = p.repo ? p.repo.replace(/\.git$/, '') : null;
    let maxIid = 0;
    const rankByCol = new Map<string, number>();
    for (const t of p.tasks) {
      const key = `${p.key}-${t.n}`;
      const git = t.git && repoWeb;
      const branch = git && t.git!.branch ? `feature/${key.toLowerCase()}` : null;
      if (t.git?.mrIid) maxIid = Math.max(maxIid, t.git.mrIid);
      const col = `${t.dept ?? ''}|${t.status}`;
      const rank = (rankByCol.get(col) ?? 0) + 1;
      rankByCol.set(col, rank);
      const done = t.status === 'DONE';
      const doneDay = done ? d('2026-09-01') : null;
      const task = await prisma.task.create({
        data: {
          tenantId, key, number: t.n, projectId: project.id, moduleName: t.module ?? null, departmentId: t.dept ? dept[t.dept] ?? null : null,
          title: t.title, description: t.desc ?? null, status: t.status, rank: rank * 1000, assigneeEmployeeId: E(t.who), reporterEmployeeId: E(p.lead),
          estimatedMinutes: t.est != null ? H(t.est) : null, loggedMinutes: H(t.logged ?? 0), openingLoggedMinutes: H(t.logged ?? 0),
          dueDate: t.due ? d(t.due) : null, isStanding: !!t.standing,
          gitBranch: branch, gitBranchUrl: branch ? `${repoWeb}/-/tree/${branch}` : null,
          gitMrUrl: t.git?.mrIid && repoWeb ? `${repoWeb}/-/merge_requests/${t.git.mrIid}` : null, gitMrIid: t.git?.mrIid ?? null, gitMrState: t.git?.mrState ?? null,
          gitSyncStatus: branch ? 'SYNCED' : 'NONE', pipelineStatus: t.git?.mrIid ? (t.git.mrState === 'merged' ? 'success' : 'running') : null,
          startedAt: ['WIP', 'DEV_COMPLETED', 'QA', 'DONE'].includes(t.status) ? at('2026-09-24', '10:15') : null,
          devCompletedAt: ['DEV_COMPLETED', 'QA', 'DONE'].includes(t.status) ? at('2026-09-28', '17:40') : null,
          qaAt: t.status === 'QA' ? at('2026-09-29', '11:05') : null,
          doneAt: doneDay, statusChangedAt: done ? doneDay! : at('2026-09-28', '17:40'),
          createdAt: done ? d('2026-06-15') : at('2026-09-21', '09:30'),
        },
      });
      if (!done) ctx.extra.tasks[key] = task.id;

      // History for the live cards (drawer → History tab).
      if (!done && !t.standing) {
        const lead = NAME[p.lead] ?? 'System';
        const hist: { from: TaskStatus | null; to: TaskStatus | null; kind: string; note?: string; by: string; when: Date }[] = [
          { from: null, to: 'OPEN', kind: 'CREATE', by: lead, when: at('2026-09-21', '09:30') },
        ];
        const path: TaskStatus[] = ['ALLOTTED', 'WIP', 'DEV_COMPLETED', 'QA'];
        const upto = path.indexOf(t.status);
        const whenFor: Record<string, Date> = { ALLOTTED: at('2026-09-22', '10:00'), WIP: at('2026-09-24', '10:15'), DEV_COMPLETED: at('2026-09-28', '17:40'), QA: at('2026-09-29', '11:05') };
        let prev: TaskStatus = 'OPEN';
        for (let i = 0; i <= upto; i++) {
          const s = path[i]!;
          const by = s === 'ALLOTTED' ? lead : s === 'QA' ? NAME.sneha! : NAME[t.who ?? ''] ?? lead;
          hist.push({ from: prev, to: s, kind: 'MOVE', by, when: whenFor[s]! });
          if (s === 'WIP' && branch) hist.push({ from: null, to: null, kind: 'GIT', note: `Branch ${branch} created from develop`, by: 'GitLab', when: new Date(whenFor[s]!.getTime() + 2000) });
          if (s === 'DEV_COMPLETED' && t.git?.mrIid) hist.push({ from: null, to: null, kind: 'GIT', note: `Merge request !${t.git.mrIid} opened: ${key.toUpperCase()}: ${t.title}`, by: 'GitLab', when: new Date(whenFor[s]!.getTime() + 2000) });
          prev = s;
        }
        if (t.git?.mrState === 'merged') hist.push({ from: null, to: null, kind: 'GIT', note: `Merge request !${t.git.mrIid} merged into develop`, by: 'GitLab', when: at('2026-09-29', '10:50') });
        await prisma.taskTransition.createMany({
          data: hist.map((h) => ({ tenantId, taskId: task.id, fromStatus: h.from, toStatus: h.to, kind: h.kind, note: h.note ?? null, byName: h.by, byEmployeeId: null, at: h.when })),
        });
      }

      // A little conversation and commit history on the wireframe cards.
      if (key === 'AT-101') {
        await prisma.taskComment.createMany({
          data: [
            { tenantId, taskId: task.id, authorEmployeeId: E('arjun'), authorName: NAME.arjun!, body: 'Please reuse the invoice template Divya shared — Nimbus wants their logo top-left.', createdAt: at('2026-09-24', '10:40') },
            { tenantId, taskId: task.id, authorEmployeeId: E('priya'), authorName: NAME.priya!, body: 'PDF layout done; working on the tax breakup table. Should be in review by Thursday.', createdAt: at('2026-09-28', '18:05') },
          ],
        });
        await prisma.gitCommitLink.createMany({
          data: [
            { tenantId, taskId: task.id, sha: 'a41c9e2f7d3b18c05e6a9f2d4b7c1e08a3f5d9b2', message: 'AT-101 invoice PDF layout with pdfkit', authorName: NAME.priya!, committedAt: at('2026-09-25', '16:20'), url: `${repoWeb}/-/commit/a41c9e2f7d3b18c05e6a9f2d4b7c1e08a3f5d9b2` },
            { tenantId, taskId: task.id, sha: '7be20d41c9a35f8e62d0b4a1c7e9f35d2a8b6c40', message: 'AT-101 HSN/SAC and tax breakup table', authorName: NAME.priya!, committedAt: at('2026-09-28', '17:55'), url: `${repoWeb}/-/commit/7be20d41c9a35f8e62d0b4a1c7e9f35d2a8b6c40` },
          ],
        });
      }
      if (key === 'AT-102') {
        await prisma.taskComment.createMany({
          data: [
            { tenantId, taskId: task.id, authorEmployeeId: E('rahul'), authorName: NAME.rahul!, body: 'Line-level rounding is half-up to the paisa; the invoice total gets a round-off line. MR is up.', createdAt: at('2026-09-28', '17:45') },
            { tenantId, taskId: task.id, authorEmployeeId: E('priya'), authorName: NAME.priya!, body: 'Reviewing this tomorrow morning.', createdAt: at('2026-09-28', '19:10') },
          ],
        });
      }
      if (key === 'AT-105') {
        await prisma.taskComment.create({
          data: { tenantId, taskId: task.id, authorEmployeeId: E('sneha'), authorName: NAME.sneha!, body: 'Testing on Chrome and Safari — the warning dialog shows at 28 minutes as expected.', createdAt: at('2026-09-29', '11:20') },
        });
      }
    }
    if (repoWeb && maxIid) repoMrSeq.push({ repo: repoWeb, next: maxIid + 1 });
  }

  // The GitLab stub numbers MRs per repo from NumberSequence; continue after the seeded MRs.
  for (const r of repoMrSeq) {
    const key = `work.git.mr.${sha256(r.repo).slice(0, 16)}`;
    await prisma.numberSequence.upsert({
      where: { tenantId_key_period: { tenantId, key, period: '' } },
      create: { id: `seq_${tenantId}_${key}_`, tenantId, key, period: '', nextValue: r.next },
      update: { nextValue: r.next },
    });
  }
}
