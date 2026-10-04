import type { Prisma, PrismaClient, WpTicketStatus } from '@prisma/client';
import PDFDocument from 'pdfkit';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { DEFAULT_SLA, generateLadder, generateQueens, generateSudoku, HELPDESK_PRIORITIES, quoteIndexFor, scoreGame, type GameKey, type WpAudienceRule } from '@lexisora/shared';
import type { SeedCtx } from './core';
import { CryptoService } from '../../src/core/crypto/crypto.service';
import { maskRtsp } from '../../src/modules/workplace/cctv/cctv.rules';
import { newPassToken, passWindow, waLink } from '../../src/modules/workplace/facility/facility.rules';
import { projectIdsByEmployee, resolveAudience, type AudienceSubject } from '../../src/modules/workplace/common/audience.rules';
import { excerptOf, sanitizeHtml } from '../../src/modules/workplace/common/html';
import { calendarWith } from '../../src/modules/workplace/helpdesk/business-hours';
import { dueDatesFor, evaluateSla, resolvedSlaState } from '../../src/modules/workplace/helpdesk/helpdesk.rules';
import { kudosPostBody, kudosPostTitle } from '../../src/modules/workplace/kudos/kudos.rules';

/**
 * Demo data for the workplace domain ("today" = Tue 29 Sep 2026, IST):
 *  - Thought of the day: the wireframe's 4 QUOTES plus a curated pool, ordered so that the
 *    rotation shows "Do the hard thing first…" on 29 Sep (the wireframe's pick for that date).
 *  - Notice board: the 4 wireframe rows with materialised read receipts (Diwali potluck with a
 *    sign-up sheet attachment, Atlas CRM release freeze → Development · Atlas, travel
 *    reimbursement, QA regression schedule → QA Team) plus one HR draft. Recipient counts are
 *    computed from the real audience (13-person demo tenant), so "112 / 128" becomes "10 / 11".
 *  - Company events: Town hall 3 Oct 5 pm (dashboard), Security awareness training, Diwali.
 *    Birthdays/anniversaries come from core Employee rows (Rahul 30 Sep, Sneha 3 years 2 Oct).
 *  - Policies & rulebook: the 5 wireframe documents (versioned PDFs); everyone acknowledged
 *    except the Leave & attendance policy update for Priya and a few others (due today).
 *  - Company feed: the 3 wireframe posts (EOTM Priya by Rohit · 1 Sep, pinned; "How we run
 *    appraisals this cycle" by Kavya · 25 Sep; "Kestrel app crosses 50,000 installs" by Arjun ·
 *    20 Sep) with 18 / 6 / 11 comments. Likes are real rows, so the wireframe's 64 / 21 / 38
 *    become 10 / 6 / 9 in the 13-person tenant. Kudos posts for every kudos row; one HR draft.
 *  - Kudos & EOTM: badges Star Coder / Bug Hunter / Team Player / Rising Star (+ the system
 *    Employee of the Month badge); the wireframe rows (Rahul ← Neha 26 Sep, Sneha ← Arjun
 *    22 Sep, Priya EOTM ← Rohit 1 Sep) plus Priya's earlier Star Coder (her profile badge);
 *    EOTM September 2026 = Priya with a verifiable certificate (PDF rendered on first download).
 *  - Helpdesk: IT desk / Payroll desk / HR desk, categories IT hardware, IT access, Payroll
 *    (restricted), HR (restricted), default SLAs; Priya's HD-1031, HD-1038, HD-1042 as in the
 *    wireframe plus HD-1037/1039/1040/1041 (one waiting, one escalated → "Helpdesk escalations 1").
 *    The next ticket is HD-1043.
 *  - Personal to-dos for the sign-in personas.
 * Reads people/work rows defensively: works when the work seed (projects) is absent.
 */

const TODAY = '2026-09-29';
const d = (k: string) => new Date(`${k}T00:00:00.000Z`);
const at = (k: string, hm = '10:00') => new Date(`${k}T${hm}:00+05:30`);
const addMin = (t: Date, m: number) => new Date(t.getTime() + m * 60_000);
const NOW = at(TODAY, '09:40');

/** The wireframe's QUOTES (web-app.html L857), in order. */
export const WIREFRAME_QUOTES = [
  'Small steps every day add up to big results.',
  'Do the hard thing first; the rest of the day gets lighter.',
  'Quality is never an accident.',
  'You are one focused hour away from a good day.',
];

const CURATED_QUOTES: [string, string | null][] = [
  ['Well begun is half done.', 'Aristotle'],
  ['The secret of getting ahead is getting started.', 'Mark Twain'],
  ['Simplicity is prerequisite for reliability.', 'Edsger W. Dijkstra'],
  ['Well done is better than well said.', 'Benjamin Franklin'],
  ['It always seems impossible until it’s done.', 'Nelson Mandela'],
  ['Make it work, make it right, make it fast.', 'Kent Beck'],
  ['The best way to predict the future is to invent it.', 'Alan Kay'],
  ['Arise, awake, and stop not till the goal is reached.', 'Swami Vivekananda'],
  ['Excellence is a continuous process and not an accident.', 'A. P. J. Abdul Kalam'],
  ['First, solve the problem. Then, write the code.', 'John Johnson'],
  ['Programs must be written for people to read, and only incidentally for machines to execute.', 'Harold Abelson'],
  ['Alone we can do so little; together we can do so much.', 'Helen Keller'],
  ['Start where you are. Use what you have. Do what you can.', 'Arthur Ashe'],
  ['Don’t watch the clock; do what it does. Keep going.', 'Sam Levenson'],
  ['If you want to go fast, go alone. If you want to go far, go together.', 'African proverb'],
  ['Focus on being productive instead of busy.', 'Tim Ferriss'],
  ['Done is better than perfect.', null],
  ['Ask for help early; it is a sign of a strong team, not a weak one.', null],
];

function pdf(kicker: string, title: string, lines: string[]): Promise<Buffer> {
  return new Promise((res, rej) => {
    const doc = new PDFDocument({ size: 'A4', margin: 56 });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => res(Buffer.concat(chunks)));
    doc.on('error', rej);
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#8a6d3b').text(kicker.toUpperCase(), { characterSpacing: 1.5 });
    doc.moveDown(0.6).font('Times-Roman').fontSize(22).fillColor('#1b1b1b').text(title);
    doc.moveDown(0.8).font('Helvetica').fontSize(10.5).fillColor('#333');
    for (const l of lines) doc.text(l, { align: 'left' }).moveDown(0.5);
    doc.moveDown(2).fontSize(8).fillColor('#888').text('Lexisora Infotech Pvt. Ltd. · Demo document generated by the Lexisora HRMS seed.');
    doc.end();
  });
}

type Pop = AudienceSubject & { userId: string | null; joiningDate: Date | null };

export async function seed_workplace(prisma: PrismaClient, ctx: SeedCtx): Promise<void> {
  const { tenantId, emp, user, dept } = ctx;
  const E = (k: string): string | null => emp[k] ?? null;
  const storageRoot = resolve(process.env.STORAGE_DIR || './storage');

  /** Mirrors StorageService.save for seed-time documents. */
  async function file(ownerKey: string, name: string, category: string, isPrivate: boolean, buf: Buffer, createdAt: Date) {
    const key = `${tenantId}/${category}/${createdAt.toISOString().slice(0, 7)}/${randomUUID()}-${name.replace(/[^\w.\- ]+/g, '_')}`;
    const path = join(storageRoot, key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, buf);
    const row = await prisma.fileObject.create({
      data: { tenantId, ownerUserId: user[ownerKey] ?? null, storageKey: key, filename: name, mime: 'application/pdf', size: buf.length, sha256: createHash('sha256').update(buf).digest('hex'), category, isPrivate, createdAt },
    });
    return row;
  }

  // ── Audience population (ACTIVE / NOTICE_PERIOD employees + project membership) ──
  const people = await prisma.employee.findMany({
    where: { tenantId, status: { in: ['ACTIVE', 'NOTICE_PERIOD'] } },
    select: { id: true, userId: true, departmentId: true, branchId: true, employmentType: true, joiningDate: true },
    orderBy: { empCode: 'asc' },
  });
  const [members, projects] = await Promise.all([
    prisma.projectMember.findMany({ where: { tenantId }, select: { projectId: true, employeeId: true } }).catch(() => []),
    prisma.project.findMany({ where: { tenantId }, select: { id: true, key: true, leadEmployeeId: true } }).catch(() => []),
  ]);
  const byEmp = projectIdsByEmployee(members, projects);
  const pop: Pop[] = people.map((p) => ({ ...p, projectIds: [...(byEmp.get(p.id) ?? [])] }));
  const atlasId: string | null = ctx.extra?.projects?.AT ?? projects.find((p) => p.key === 'AT')?.id ?? null;

  await seedQuotes(prisma, tenantId);
  await seedEvents(prisma, tenantId, E);
  await seedNotices();
  await seedPolicies();
  await seedFeedAndKudos();
  await seedHelpdesk();
  await seedTodos(prisma, tenantId, E);
  await seedHub(prisma, ctx, { atlasId, file });

  // ── Notice board ─────────────────────────────────────────────────────────
  async function seedNotices() {
    type NoticeSeed = {
      title: string;
      html: string;
      visibility: 'GLOBAL' | 'TEAM';
      author: string;
      audiences: WpAudienceRule[];
      status: 'PUBLISHED' | 'DRAFT';
      publishedAt?: Date;
      /** Persona keys who have not opened it yet; every other recipient has read it. */
      unread?: string[];
      email?: boolean;
      pinned?: boolean;
      attachment?: { name: string; title: string; lines: string[] };
    };
    const rules: { dev: WpAudienceRule[]; qa: WpAudienceRule[] } = {
      dev: [
        ...(dept.Development ? [{ type: 'DEPARTMENT' as const, refId: dept.Development, label: 'Development' }] : []),
        ...(atlasId ? [{ type: 'PROJECT' as const, refId: atlasId, label: 'Atlas' }] : []),
      ],
      qa: dept.QA ? [{ type: 'DEPARTMENT', refId: dept.QA, label: 'QA Team' }] : [],
    };
    const rows: NoticeSeed[] = [
      {
        title: 'Diwali celebration & potluck',
        html: '<p><strong>8 Nov, 4 pm onwards on the terrace.</strong> Sign up for a dish by 1 Nov.</p>',
        visibility: 'GLOBAL',
        author: 'kavya',
        audiences: [],
        status: 'PUBLISHED',
        publishedAt: at('2026-09-27', '11:30'),
        unread: ['priya'],
        email: true,
        attachment: {
          name: 'Diwali potluck sign-up sheet.pdf',
          title: 'Diwali celebration & potluck',
          lines: [
            'Sunday, 8 November 2026 · 4 pm onwards · Terrace, Ahmedabad HQ (Pune office: Baner Road cafeteria).',
            'Families are welcome. Please sign up for one dish (starter, main, dessert or drinks) with HR by 1 November so we avoid duplicates.',
            'Rangoli competition at 5 pm — teams of up to four. Diyas and colours are provided by the office.',
            'Contact: Kavya Iyer (HR) · hr@lexisora.com',
          ],
        },
      },
      {
        title: 'Atlas CRM release freeze',
        html: '<p>Merges close Wednesday EOD.</p>',
        visibility: 'TEAM',
        author: 'arjun',
        audiences: rules.dev,
        status: 'PUBLISHED',
        publishedAt: at('2026-09-26', '16:00'),
        unread: ['isha'],
      },
      {
        title: 'Revised travel reimbursement',
        html: '<p>New per-km rates apply from 1 October.</p>',
        visibility: 'GLOBAL',
        author: 'kavya',
        audiences: [],
        status: 'PUBLISHED',
        publishedAt: at('2026-09-22', '11:00'),
        unread: ['isha', 'karan', 'divya'],
        email: true,
      },
      {
        title: 'QA regression schedule',
        html: '<p>Billing regression runs Thursday and Friday. Keep the QA environment free of deployments until sign-off.</p>',
        visibility: 'TEAM',
        author: 'sneha',
        audiences: rules.qa,
        status: 'PUBLISHED',
        publishedAt: at('2026-09-20', '10:00'),
      },
      {
        title: 'Appraisal cycle 2026: timelines',
        html:
          '<h2>What happens when</h2><ul><li><strong>1 Oct</strong> — self reviews open</li><li><strong>15 Oct</strong> — manager reviews</li><li><strong>31 Oct</strong> — calibration and letters</li></ul><p>The new KRA template is on the Company feed.</p>',
        visibility: 'GLOBAL',
        author: 'kavya',
        audiences: [],
        status: 'DRAFT',
      },
    ];
    const cutoff = at(TODAY, '09:30');
    for (const n of rows) {
      const authorId = E(n.author);
      if (!authorId) continue;
      if (n.visibility === 'TEAM' && !n.audiences.length) continue; // department missing — nothing to address
      const bodyHtml = sanitizeHtml(n.html);
      const created = n.publishedAt ? addMin(n.publishedAt, -45) : at('2026-09-28', '17:10');
      const notice = await prisma.notice.create({
        data: {
          tenantId,
          title: n.title,
          bodyHtml,
          excerpt: excerptOf(bodyHtml, 300),
          visibility: n.visibility,
          status: n.status,
          authorEmployeeId: authorId,
          audiences: n.audiences as Prisma.InputJsonValue,
          publishedAt: n.publishedAt ?? null,
          pinned: n.pinned ?? false,
          emailRecipients: n.email ?? n.visibility === 'GLOBAL',
          createdAt: created,
        },
      });
      if (n.attachment) {
        const buf = await pdf('Lexisora Infotech · Notice', n.attachment.title, n.attachment.lines);
        const f = await file(n.author, n.attachment.name, 'notice', true, buf, created);
        await prisma.noticeAttachment.create({ data: { tenantId, noticeId: notice.id, fileId: f.id, name: f.filename, sizeBytes: f.size, mime: f.mime } });
      }
      if (n.status !== 'PUBLISHED' || !n.publishedAt) continue;
      const ruleSet: WpAudienceRule[] = n.visibility === 'GLOBAL' ? [{ type: 'ALL' }] : n.audiences;
      const ids = resolveAudience(pop, ruleSet).filter((id) => id !== authorId);
      const unread = new Set((n.unread ?? []).map(E).filter((x): x is string => !!x));
      const recips = ids.map((id, i) => {
        const p = pop.find((x) => x.id === id)!;
        const readAt = unread.has(id) ? null : addMin(n.publishedAt!, 18 + i * 53);
        return { tenantId, noticeId: notice.id, employeeId: id, userId: p.userId, addedAt: n.publishedAt!, readAt: readAt && readAt < cutoff ? readAt : readAt ? addMin(cutoff, -(i + 1) * 7) : null };
      });
      if (recips.length) await prisma.noticeRecipient.createMany({ data: recips });
      await prisma.notice.update({ where: { id: notice.id }, data: { recipientCount: recips.length, readCount: recips.filter((r) => r.readAt).length } });
    }
  }

  // ── Policies (only what the dashboard's acknowledgement to-do needs; the Policies
  //    screen ships in the next workplace release and builds on these rows) ──────────
  async function seedPolicies() {
    const hr = 'kavya';
    type PolicySeed = {
      title: string;
      category: string;
      requiresAck: boolean;
      holidayYear?: number;
      versions: { version: number; effectiveFrom: string; publishedAt: Date; summary?: string; lines: string[]; ackDueAt?: Date; pending?: string[] }[];
    };
    const policies: PolicySeed[] = [
      {
        title: 'Employee handbook 2026',
        category: 'HANDBOOK',
        requiresAck: true,
        versions: [
          {
            version: 1,
            effectiveFrom: '2026-04-01',
            publishedAt: at('2026-04-01', '10:00'),
            lines: ['Our values, code of conduct, working hours, dress code, communication norms and the escalation matrix.', 'Every employee acknowledges the handbook on joining and on each annual revision.'],
          },
        ],
      },
      {
        title: 'Leave & attendance policy',
        category: 'LEAVE_ATTENDANCE',
        requiresAck: true,
        versions: [
          { version: 1, effectiveFrom: '2025-04-01', publishedAt: at('2025-04-01', '10:00'), lines: ['Leave types, accrual, carry forward, attendance rules and regularisation.'] },
          {
            version: 2,
            effectiveFrom: '2026-07-15',
            publishedAt: at('2026-07-15', '10:00'),
            summary: 'Comp-off must be availed within 60 days; missed punches are regularised within 3 working days.',
            lines: [
              'Earned leave accrues monthly (1.25 days) and up to 15 days carry forward; casual and sick leave lapse at year end.',
              'Comp-off earned on a weekly off or holiday must be availed within 60 days.',
              'A missed punch must be regularised within 3 working days, with your manager’s approval.',
              'Remote and hybrid staff punch on the web or desktop app; office staff use the biometric sensor.',
            ],
            // HR extended the acknowledgement deadline for this update to today (reminder sent 22 Sep).
            ackDueAt: at(TODAY, '18:30'),
            pending: ['priya', 'rahul', 'isha', 'karan', 'divya'],
          },
        ],
      },
      {
        title: 'Holiday list 2026',
        category: 'HOLIDAY_LIST',
        requiresAck: false,
        holidayYear: 2026,
        versions: [{ version: 1, effectiveFrom: '2026-01-01', publishedAt: at('2026-01-01', '10:00'), lines: ['Mandatory and optional holidays for 2026 for the Ahmedabad and Pune offices.'] }],
      },
      {
        title: 'IT & data security policy',
        category: 'IT_SECURITY',
        requiresAck: true,
        versions: [
          {
            version: 1,
            effectiveFrom: '2026-03-10',
            publishedAt: at('2026-03-10', '10:00'),
            lines: ['Acceptable use of laptops and accounts, password and MFA rules, client data handling, removable media and incident reporting.'],
          },
        ],
      },
      {
        title: 'POSH policy',
        category: 'POSH',
        requiresAck: true,
        versions: [
          {
            version: 1,
            effectiveFrom: '2026-04-01',
            publishedAt: at('2026-04-01', '11:00'),
            lines: ['Prevention of sexual harassment at the workplace: definitions, the Internal Committee, how to raise a complaint and timelines.'],
          },
        ],
      },
    ];
    const hrId = E(hr);
    let sort = 0;
    for (const p of policies) {
      sort++;
      const policy = await prisma.hrPolicy.create({
        data: { tenantId, title: p.title, category: p.category, requiresAck: p.requiresAck, ackDueDays: 7, status: 'PUBLISHED', holidayYear: p.holidayYear ?? null, sortOrder: sort, createdAt: p.versions[0]!.publishedAt },
      });
      let currentId: string | null = null;
      for (const v of p.versions) {
        const buf = await pdf('Lexisora Infotech · Policies & rulebook', `${p.title}${v.version > 1 ? ` (v${v.version})` : ''}`, [`Effective from ${v.effectiveFrom}.`, ...(v.summary ? [`What changed: ${v.summary}`] : []), ...v.lines]);
        const f = await file(hr, `${p.title} v${v.version}.pdf`, 'policy', false, buf, v.publishedAt);
        const ver = await prisma.hrPolicyVersion.create({
          data: { tenantId, policyId: policy.id, version: v.version, fileId: f.id, pageCount: 1, effectiveFrom: d(v.effectiveFrom), changeSummary: v.summary ?? null, requiresReack: true, publishedAt: v.publishedAt, publishedByEmployeeId: hrId },
        });
        currentId = ver.id;
        if (!p.requiresAck) continue;
        const pending = new Set((v.pending ?? []).map(E).filter((x): x is string => !!x));
        const acks = pop
          .filter((e) => !e.joiningDate || e.joiningDate.getTime() <= NOW.getTime())
          .filter((e) => !(v.version < p.versions.length && e.joiningDate && e.joiningDate > p.versions[v.version]!.publishedAt)) // joined after the update: only the new version
          .map((e, i) => {
            const from = e.joiningDate && e.joiningDate > v.publishedAt ? e.joiningDate : v.publishedAt;
            const dueAt = v.ackDueAt ?? addMin(from, 7 * 24 * 60);
            const ackAt = pending.has(e.id) ? null : addMin(from, 60 * (6 + ((i * 7) % 60)));
            return { tenantId, policyId: policy.id, policyVersionId: ver.id, employeeId: e.id, dueAt, acknowledgedAt: ackAt && ackAt < NOW ? ackAt : ackAt ? addMin(NOW, -(i + 1) * 45) : null, readSeconds: ackAt ? 90 + ((i * 37) % 400) : null, lastRemindedAt: v.ackDueAt && pending.has(e.id) ? at('2026-09-22', '10:00') : null };
          });
        if (acks.length) await prisma.policyAck.createMany({ data: acks });
      }
      if (currentId) await prisma.hrPolicy.update({ where: { id: policy.id }, data: { currentVersionId: currentId } });
    }
  }

  async function nameMap(): Promise<Map<string, string>> {
    const rows = await prisma.employee.findMany({ where: { tenantId }, select: { id: true, fullName: true } });
    return new Map(rows.map((e) => [e.id, e.fullName]));
  }

  // ── Company feed, kudos & Employee of the Month ──────────────────────────
  async function seedFeedAndKudos() {
    const names = await nameMap();
    const setupAt = at('2026-01-02', '09:00');
    const badgeDefs: { name: string; icon: string; description: string; system?: boolean }[] = [
      { name: 'Star Coder', icon: 'star', description: 'Outstanding code quality or delivery' },
      { name: 'Bug Hunter', icon: 'bug', description: 'Caught a critical issue before it reached a customer' },
      { name: 'Team Player', icon: 'people', description: 'Went out of the way to help the team' },
      { name: 'Rising Star', icon: 'rocket', description: 'A strong start or fast growth in the role' },
      // The system badge KudosService uses for EOTM rows (same name/icon/description).
      { name: 'Employee of the Month', icon: 'trophy', description: 'Announced monthly by HR', system: true },
    ];
    const badge: Record<string, string> = {};
    for (const b of badgeDefs) {
      const row = await prisma.badge.create({ data: { tenantId, name: b.name, icon: b.icon, description: b.description, system: !!b.system, active: true, createdAt: setupAt } });
      badge[b.name] = row.id;
    }

    type CommentSeed = { who: string; body: string; mins: number; replyTo?: number; mentions?: string[] };
    type PostSeed = {
      kind: 'BLOG' | 'MILESTONE' | 'UPDATE' | 'EOTM' | 'KUDOS';
      title: string;
      html: string;
      author: string;
      publishedBy?: string;
      at: Date;
      draft?: boolean;
      pinned?: boolean;
      likers?: string[];
      comments?: CommentSeed[];
      eotmAwardId?: string;
      kudosId?: string;
    };

    /** A post with its like rows and comment thread (replies by index); counters match the rows. */
    async function createPost(p: PostSeed) {
      const authorId = E(p.author);
      if (!authorId) return null;
      const bodyHtml = sanitizeHtml(p.html);
      const likers = [...new Set((p.likers ?? []).map(E).filter((x): x is string => !!x))];
      const comments = (p.comments ?? []).map((c) => ({ ...c, authorId: E(c.who) }));
      const lastActivity = comments.reduce((m, c) => Math.max(m, c.mins), 0);
      const post = await prisma.post.create({
        data: {
          tenantId,
          kind: p.kind,
          status: p.draft ? 'DRAFT' : 'PUBLISHED',
          title: p.title,
          bodyHtml,
          excerpt: excerptOf(bodyHtml, 300),
          authorEmployeeId: authorId,
          publishedAt: p.draft ? null : p.at,
          publishedByEmployeeId: p.draft ? null : (E(p.publishedBy ?? p.author) ?? authorId),
          pinned: !!p.pinned,
          likeCount: p.draft ? 0 : likers.length,
          commentCount: p.draft ? 0 : comments.filter((c) => c.authorId).length,
          eotmAwardId: p.eotmAwardId ?? null,
          kudosId: p.kudosId ?? null,
          createdAt: p.at,
          updatedAt: addMin(p.at, lastActivity),
        },
      });
      if (p.draft) return post;
      const likedAt = (employeeId: string, i: number) => {
        const t = addMin(p.at, 4 + i * 19);
        const joined = pop.find((x) => x.id === employeeId)?.joiningDate;
        return joined && joined > t ? addMin(joined, 24 * 60 + 5 * 60) : t; // joiners like it on their first day
      };
      if (likers.length) await prisma.postLike.createMany({ data: likers.map((employeeId, i) => ({ tenantId, postId: post.id, employeeId, createdAt: likedAt(employeeId, i) })) });
      const ids: (string | null)[] = [];
      for (const c of comments) {
        if (!c.authorId) {
          ids.push(null);
          continue;
        }
        const parentId = c.replyTo !== undefined ? (ids[c.replyTo] ?? null) : null;
        const row = await prisma.postComment.create({
          data: { tenantId, postId: post.id, authorEmployeeId: c.authorId, parentId, body: c.body, mentions: (c.mentions ?? []).map(E).filter((x): x is string => !!x), createdAt: addMin(p.at, c.mins) },
        });
        ids.push(row.id);
      }
      return post;
    }

    /** A kudos row and its KUDOS feed post, as KudosService.give creates them. */
    async function giveKudos(k: { from: string; to: string; badge: string; message: string; at: Date; likers?: string[]; comments?: CommentSeed[] }) {
      const giver = E(k.from);
      const recipient = E(k.to);
      if (!giver || !recipient) return;
      const row = await prisma.kudos.create({ data: { tenantId, giverEmployeeId: giver, recipientEmployeeId: recipient, badgeId: badge[k.badge]!, message: k.message, createdAt: k.at } });
      const post = await createPost({ kind: 'KUDOS', title: kudosPostTitle(k.badge, names.get(recipient) ?? k.to), html: kudosPostBody(k.message), author: k.from, at: k.at, likers: k.likers, comments: k.comments, kudosId: row.id });
      if (post) await prisma.kudos.update({ where: { id: row.id }, data: { postId: post.id } });
    }

    // Employee of the Month · September 2026 → Priya (wireframe feed p1, sidebar, kudos row).
    const rohit = E('rohit');
    const priya = E('priya');
    if (rohit && priya) {
      const eotmAt = at('2026-09-01', '10:00');
      const citation = 'Shipped the Atlas CRM billing module two weeks early.';
      const holderName = names.get(priya) ?? 'Priya Sharma';
      const award = await prisma.eotmAward.create({ data: { tenantId, employeeId: priya, month: '2026-09', citation, announcedByEmployeeId: rohit, createdAt: eotmAt } });
      const post = await createPost({
        kind: 'EOTM',
        title: `Employee of the Month: ${holderName}`,
        html: '<p>Priya shipped the Atlas CRM billing module two weeks ahead of plan and mentored two interns along the way. Her certificate is ready to download.</p>',
        author: 'rohit',
        at: eotmAt,
        pinned: true,
        likers: ['neha', 'arjun', 'rahul', 'sneha', 'kavya', 'vikram', 'ananya', 'isha', 'karan', 'divya'],
        comments: [
          { who: 'neha', body: 'Thoroughly deserved, Priya! The billing module was the smoothest release of the year.', mins: 12 },
          { who: 'priya', body: 'Thank you, Neha! It was a real team effort.', mins: 25, replyTo: 0 },
          { who: 'arjun', body: 'Two weeks early and mentoring two interns along the way. Congratulations, Priya!', mins: 31 },
          { who: 'rahul', body: 'Congratulations, Priya! Well earned.', mins: 40 },
          { who: 'sneha', body: 'The cleanest release candidate we have tested this year. Congrats!', mins: 52 },
          { who: 'priya', body: 'QA caught the tricky edge cases early — thank you, Sneha!', mins: 60, replyTo: 4 },
          { who: 'kavya', body: 'Congratulations @Priya! Your certificate is on this post — download it any time.', mins: 75, mentions: ['priya'] },
          { who: 'vikram', body: 'Congratulations from the Pune office!', mins: 95 },
          { who: 'ananya', body: 'Congratulations! Finance loved the GST invoice preview.', mins: 130 },
          { who: 'rohit', body: 'Agreed — the new billing flow already saves us hours at month end.', mins: 142, replyTo: 8 },
          { who: 'rahul', body: 'Next month I’m coming for that trophy, Priya!', mins: 180 },
          { who: 'priya', body: 'Bring it on, Rahul!', mins: 195, replyTo: 10 },
          { who: 'neha', body: 'Also a shout-out for the documentation — the billing runbook is excellent.', mins: 240 },
          { who: 'arjun', body: '+1, we are using it as the template for Kestrel.', mins: 250, replyTo: 12 },
          { who: 'sneha', body: 'Cake at 4?', mins: 300 },
          { who: 'kavya', body: 'Already ordered. Cafeteria, 4 pm!', mins: 310, replyTo: 14 },
          { who: 'rohit', body: 'Proud of you, Priya. Keep raising the bar.', mins: 330 },
          { who: 'priya', body: 'Thank you all — this means a lot. On to the next release!', mins: 360 },
        ],
        eotmAwardId: award.id,
      });
      // Rendered lazily on the first download (CertificatesService.pdfFor); READY = no "certificate ready" alert.
      const cert = await prisma.certificate.create({
        data: { tenantId, type: 'EOTM', recipientEmployeeId: priya, holderName, title: 'Employee of the Month', subtitle: 'September 2026', issuedAt: eotmAt, verificationCode: verificationCode(), status: 'READY', sourceType: 'EOTM', sourceId: award.id, metadata: { citation, month: '2026-09', holderName }, createdAt: eotmAt },
      });
      await prisma.eotmAward.update({ where: { id: award.id }, data: { postId: post?.id ?? null, certificateId: cert.id } });
      await prisma.kudos.create({ data: { tenantId, giverEmployeeId: rohit, recipientEmployeeId: priya, badgeId: badge['Employee of the Month']!, message: 'Atlas CRM billing shipped early', postId: post?.id ?? null, createdAt: eotmAt } });
    }

    // Kudos (wireframe rows + Priya's earlier Star Coder, shown on her profile).
    await giveKudos({ from: 'arjun', to: 'priya', badge: 'Star Coder', message: 'Built the Atlas invoice PDF export with zero review comments', at: at('2026-08-12', '15:30'), likers: ['neha', 'rahul', 'sneha'] });
    await giveKudos({
      from: 'arjun',
      to: 'sneha',
      badge: 'Bug Hunter',
      message: 'Caught the GST rounding issue before release',
      at: at('2026-09-22', '11:05'),
      likers: ['neha', 'karan', 'priya', 'rahul'],
      comments: [{ who: 'neha', body: 'Great catch, Sneha — that would have hit every invoice.', mins: 25 }],
    });
    await giveKudos({
      from: 'neha',
      to: 'rahul',
      badge: 'Star Coder',
      message: 'Refactored the payroll engine in a week',
      at: at('2026-09-26', '11:15'),
      likers: ['arjun', 'priya', 'sneha', 'rohit', 'kavya'],
      comments: [
        { who: 'priya', body: 'Well deserved, Rahul!', mins: 14 },
        { who: 'rahul', body: 'Thanks, Neha! Happy to finally retire the old engine.', mins: 31 },
      ],
    });

    // Wireframe posts p2 (Blog) and p3 (Milestone).
    await createPost({
      kind: 'BLOG',
      title: 'How we run appraisals this cycle',
      html: [
        '<p>Self reviews open on 1 October. This post explains the new KRA template, timelines and what managers will look for.</p>',
        '<h2>Timeline</h2>',
        '<ul><li>1–10 Oct: self review (Appraisals → My review)</li><li>12–20 Oct: manager review and calibration</li><li>From 26 Oct: one-to-one conversations and letters</li></ul>',
        '<h2>The new KRA template</h2>',
        '<p>Every role now has 4–6 KRAs with weights that add up to 100%. Rate yourself on a 5-point scale and add at least one example for every rating above 3.</p>',
        '<h2>What managers look for</h2>',
        '<ul><li>Outcomes against the KRAs, not hours logged</li><li>How you helped the team: reviews, mentoring, documentation</li><li>One area you want to grow in next cycle</li></ul>',
        '<p>Questions? Ask in the comments or raise an HR ticket on the <a href="/helpdesk">Helpdesk</a>.</p>',
      ].join(''),
      author: 'kavya',
      at: at('2026-09-25', '11:30'),
      likers: ['neha', 'arjun', 'priya', 'rahul', 'sneha', 'rohit'],
      comments: [
        { who: 'rahul', body: 'Will the KRA weights be visible before we start the self review?', mins: 20 },
        { who: 'kavya', body: 'Yes — your manager shares them by 30 Sep, and you will see them on your review form from 1 Oct.', mins: 35, replyTo: 0 },
        { who: 'sneha', body: 'Can we add more than one example per rating?', mins: 60 },
        { who: 'kavya', body: 'Absolutely. One example is the minimum for ratings above 3.', mins: 72, replyTo: 2 },
        { who: 'priya', body: 'Thanks for the clear timeline, Kavya.', mins: 95 },
        { who: 'neha', body: 'Managers: please block 30 minutes per report for the one-to-ones in the last week of October.', mins: 130 },
      ],
    });
    await createPost({
      kind: 'MILESTONE',
      title: 'Kestrel app crosses 50,000 installs',
      html: '<p>Thanks to the mobile and QA teams for three releases in six weeks.</p>',
      author: 'arjun',
      publishedBy: 'kavya',
      at: at('2026-09-20', '17:45'),
      likers: ['rohit', 'neha', 'sneha', 'karan', 'vikram', 'priya', 'rahul', 'kavya', 'divya'],
      comments: [
        { who: 'rohit', body: 'Fantastic milestone. Well done, team Kestrel!', mins: 15 },
        { who: 'sneha', body: 'Three releases in six weeks with zero P1 bugs. Proud of the QA team.', mins: 30 },
        { who: 'arjun', body: 'Your regression suite made that possible, Sneha.', mins: 42, replyTo: 1 },
        { who: 'karan', body: 'Happy to have been part of the last release cycle!', mins: 55 },
        { who: 'vikram', body: 'The new onboarding screens went out in v2.3 — thanks for the quick feedback loops.', mins: 70 },
        { who: 'neha', body: 'Congratulations, everyone. Let’s keep the crash-free rate above 99.5%.', mins: 90 },
        { who: 'priya', body: 'Congrats, team! 50k is huge.', mins: 120 },
        { who: 'rahul', body: 'What’s the next target — 100k by March?', mins: 150 },
        { who: 'arjun', body: 'That’s the plan. The store listing refresh lands in October.', mins: 165, replyTo: 7 },
        { who: 'kavya', body: 'Congratulations! Cake in the cafeteria on Friday.', mins: 200 },
        { who: 'divya', body: 'Congrats! Loved working on the illustrations.', mins: 240 },
      ],
    });
    // An HR draft ("My drafts (1)" in Kavya's composer).
    await createPost({
      kind: 'BLOG',
      title: 'Diwali celebration — what to expect',
      html: '<p>Families are welcome on 8 November from 4 pm on the terrace at Ahmedabad HQ.</p><ul><li>Potluck: sign up for a dish by 1 Nov</li><li>Rangoli competition at 5 pm</li></ul>',
      author: 'kavya',
      at: at('2026-09-28', '17:10'),
      draft: true,
    });
  }

  // ── Helpdesk ─────────────────────────────────────────────────────────────
  async function seedHelpdesk() {
    const names = await nameMap();
    const nm = (k: string) => names.get(E(k) ?? '') ?? k;
    const setupAt = at('2026-01-05', '10:00');
    const groupDefs = [
      { key: 'it', name: 'IT desk', lead: 'neha', members: ['arjun'] },
      { key: 'payroll', name: 'Payroll desk', lead: 'kavya', members: ['ananya'] },
      { key: 'hr', name: 'HR desk', lead: 'kavya', members: [] as string[] },
    ];
    const groups: Record<string, string> = {};
    for (const g of groupDefs) {
      const row = await prisma.supportGroup.create({
        data: { tenantId, name: g.name, leadEmployeeId: E(g.lead), memberEmployeeIds: g.members.map(E).filter((x): x is string => !!x), active: true, roundRobin: false, createdAt: setupAt },
      });
      groups[g.key] = row.id;
    }
    // Categories in the wireframe FORMS.ticket order; Payroll and HR are restricted (requester + desk only).
    const catDefs = [
      { name: 'IT hardware', group: 'it', restricted: false },
      { name: 'IT access', group: 'it', restricted: false },
      { name: 'Payroll', group: 'payroll', restricted: true },
      { name: 'HR', group: 'hr', restricted: true },
    ];
    const cats: Record<string, { id: string; groupId: string }> = {};
    for (const [i, c] of catDefs.entries()) {
      const row = await prisma.ticketCategory.create({ data: { tenantId, name: c.name, groupId: groups[c.group]!, restricted: c.restricted, active: true, sortOrder: i + 1 } });
      cats[c.name] = { id: row.id, groupId: row.groupId };
    }
    await prisma.slaPolicy.createMany({ data: HELPDESK_PRIORITIES.map((priority) => ({ tenantId, priority, ...DEFAULT_SLA[priority] })) });

    // Business calendar = Mon–Fri 09:30–18:30 IST minus company-wide mandatory holidays (as HelpdeskService.calendar()).
    const holidays = await prisma.holiday.findMany({ where: { tenantId, type: 'MANDATORY' }, select: { date: true, locationIds: true } }).catch(() => [] as { date: Date; locationIds: string[] }[]);
    const cal = calendarWith(holidays.filter((h) => !h.locationIds.length).map((h) => h.date.toISOString().slice(0, 10)));
    const assigned = (k: string) => `Assigned to ${nm(k)}`;

    type Ev = { at: Date; who: string | null; kind: 'COMMENT' | 'STATUS_CHANGE' | 'ASSIGNMENT' | 'ESCALATION' | 'CSAT'; body: string; internal?: boolean };
    type TicketSeed = {
      number: number;
      requester: string;
      category: string;
      priority: 'HIGH' | 'MEDIUM' | 'LOW';
      subject: string;
      description: string;
      createdAt: Date;
      status: WpTicketStatus;
      assignee?: string;
      firstRespondedAt?: Date;
      resolvedAt?: Date;
      closedAt?: Date;
      pausedSince?: Date;
      resolutionNote?: string;
      csat?: number;
      escalatedTo?: string[];
      events: Ev[];
    };
    const resolved = (note: string) => `Resolved: ${note}`;
    const notes = {
      1031: 'VPN profile installed and access to the client’s staging server verified with Priya.',
      1037: 'Form 16 (Parts A and B) emailed to your work address.',
      1038: 'PF for August was calculated on your old basic. The shortfall will be added to your September PF contribution.',
      1039: 'GitLab access granted: Developer on atlas/crm.',
    };
    const tickets: TicketSeed[] = [
      {
        number: 1031,
        requester: 'priya',
        category: 'IT access',
        priority: 'MEDIUM',
        subject: 'VPN access for client server',
        description: 'I need VPN access to the Atlas client’s staging server to debug the invoice sync. The client’s IT team has approved the request on their side.',
        createdAt: at('2026-09-21', '11:00'),
        status: 'RESOLVED',
        firstRespondedAt: at('2026-09-21', '11:40'),
        resolvedAt: at('2026-09-23', '15:10'),
        resolutionNote: notes[1031],
        csat: 5,
        events: [
          { at: at('2026-09-21', '11:40'), who: 'arjun', kind: 'COMMENT', body: 'I’ve requested a VPN profile from the client’s IT team. We’ll install it on your laptop once they whitelist our office IP.' },
          { at: at('2026-09-21', '11:41'), who: 'arjun', kind: 'STATUS_CHANGE', body: 'Status changed to In progress' },
          { at: at('2026-09-22', '10:05'), who: 'priya', kind: 'COMMENT', body: 'Thanks! Let me know if you need anything from my side.' },
          { at: at('2026-09-23', '15:10'), who: 'arjun', kind: 'STATUS_CHANGE', body: resolved(notes[1031]) },
          { at: at('2026-09-23', '15:32'), who: 'priya', kind: 'CSAT', body: 'Rated 5/5' },
        ],
      },
      {
        number: 1037,
        requester: 'rahul',
        category: 'Payroll',
        priority: 'LOW',
        subject: 'Form 16 for FY 2025-26 not received',
        description: 'I haven’t received Form 16 for FY 2025-26 yet. The bank needs it for my home-loan application.',
        createdAt: at('2026-09-22', '09:50'),
        status: 'RESOLVED',
        assignee: 'ananya',
        firstRespondedAt: at('2026-09-22', '10:30'),
        resolvedAt: at('2026-09-25', '17:10'),
        resolutionNote: notes[1037],
        csat: 4,
        events: [
          { at: at('2026-09-22', '10:10'), who: 'kavya', kind: 'ASSIGNMENT', body: assigned('ananya') },
          { at: at('2026-09-22', '10:30'), who: 'ananya', kind: 'COMMENT', body: 'Part B is generated once Part A is downloaded from TRACES. You’ll have both by 26 Sep.' },
          { at: at('2026-09-22', '10:31'), who: 'ananya', kind: 'STATUS_CHANGE', body: 'Status changed to In progress' },
          { at: at('2026-09-25', '17:10'), who: 'ananya', kind: 'STATUS_CHANGE', body: resolved(notes[1037]) },
          { at: at('2026-09-25', '17:40'), who: 'rahul', kind: 'CSAT', body: 'Rated 4/5' },
        ],
      },
      {
        number: 1038,
        requester: 'priya',
        category: 'Payroll',
        priority: 'MEDIUM',
        subject: 'Payslip shows wrong PF',
        description: 'The PF deduction on my August payslip is lower than in July, although my basic was revised in July. Could you check whether the revised basic was used?',
        createdAt: at('2026-09-23', '10:20'),
        status: 'RESOLVED',
        assignee: 'kavya',
        firstRespondedAt: at('2026-09-23', '11:02'),
        resolvedAt: at('2026-09-24', '12:15'),
        resolutionNote: notes[1038],
        events: [
          { at: at('2026-09-23', '10:45'), who: 'kavya', kind: 'ASSIGNMENT', body: assigned('kavya') },
          { at: at('2026-09-23', '11:02'), who: 'kavya', kind: 'COMMENT', body: 'Thanks, Priya — I’m checking the August payroll run and will update you today.' },
          { at: at('2026-09-23', '11:03'), who: 'kavya', kind: 'STATUS_CHANGE', body: 'Status changed to In progress' },
          { at: at('2026-09-23', '16:40'), who: 'kavya', kind: 'COMMENT', internal: true, body: 'The August run used the pre-revision basic for PF. The correction goes into the September run.' },
          { at: at('2026-09-24', '12:15'), who: 'kavya', kind: 'STATUS_CHANGE', body: resolved(notes[1038]) },
        ],
      },
      {
        number: 1039,
        requester: 'isha',
        category: 'IT access',
        priority: 'MEDIUM',
        subject: 'Access to the Atlas GitLab group',
        description: 'I joined the Atlas CRM team as an intern and need access to the GitLab group to clone the repository.',
        createdAt: at('2026-09-24', '10:05'),
        status: 'CLOSED',
        assignee: 'arjun',
        firstRespondedAt: at('2026-09-24', '10:40'),
        resolvedAt: at('2026-09-24', '10:45'),
        closedAt: at('2026-09-24', '11:30'),
        resolutionNote: notes[1039],
        csat: 5,
        events: [
          { at: at('2026-09-24', '10:20'), who: 'neha', kind: 'ASSIGNMENT', body: assigned('arjun') },
          { at: at('2026-09-24', '10:40'), who: 'arjun', kind: 'COMMENT', body: 'Added you to atlas/crm as a Developer. Please turn on two-factor authentication in GitLab before you push.' },
          { at: at('2026-09-24', '10:45'), who: 'arjun', kind: 'STATUS_CHANGE', body: resolved(notes[1039]) },
          { at: at('2026-09-24', '11:30'), who: 'isha', kind: 'STATUS_CHANGE', body: 'Closed — the requester confirmed the fix' },
          { at: at('2026-09-24', '11:31'), who: 'isha', kind: 'CSAT', body: 'Rated 5/5' },
        ],
      },
      {
        number: 1040,
        requester: 'sneha',
        category: 'IT hardware',
        priority: 'LOW',
        subject: 'Second monitor for regression testing',
        description: 'Running the billing regression suite side by side with the app needs a second monitor at my desk.',
        createdAt: at('2026-09-25', '14:00'),
        status: 'WAITING',
        firstRespondedAt: at('2026-09-25', '15:20'),
        pausedSince: at('2026-09-25', '15:21'),
        events: [
          { at: at('2026-09-25', '15:20'), who: 'neha', kind: 'COMMENT', body: 'We have 24-inch Dell and 27-inch LG monitors in stock — which one suits your test bench?' },
          { at: at('2026-09-25', '15:21'), who: 'neha', kind: 'STATUS_CHANGE', body: 'Status changed to Waiting' },
        ],
      },
      {
        number: 1041,
        requester: 'vikram',
        category: 'IT access',
        priority: 'HIGH',
        subject: 'Pune office Wi-Fi drops every few minutes',
        description: 'Since this morning the Wi-Fi on the Pune office floor disconnects every 5–10 minutes and client video calls keep dropping. Divya is affected too.',
        createdAt: at('2026-09-28', '10:15'),
        status: 'OPEN',
        // First response was due 11:15; the SLA monitor escalated to the IT desk lead and Vikram's manager.
        escalatedTo: ['neha', 'arjun'],
        events: [
          { at: at('2026-09-28', '11:20'), who: null, kind: 'ESCALATION', internal: true, body: `First response overdue · level 1 → ${nm('neha')}, ${nm('arjun')}` },
          { at: at('2026-09-28', '14:30'), who: 'vikram', kind: 'COMMENT', body: 'Still dropping. We’ve moved today’s client call to a mobile hotspot for now.' },
        ],
      },
      {
        number: 1042,
        requester: 'priya',
        category: 'IT hardware',
        priority: 'HIGH',
        subject: 'Laptop battery drains fast',
        description: 'My laptop battery goes from 100% to 20% in under two hours with just the IDE and a browser open. It started after last week’s BIOS update.',
        createdAt: at('2026-09-28', '15:30'),
        status: 'IN_PROGRESS',
        firstRespondedAt: at('2026-09-28', '16:05'),
        events: [
          { at: at('2026-09-28', '16:05'), who: 'arjun', kind: 'COMMENT', body: 'Could you bring the laptop to the IT desk tomorrow at 11? We’ll run a battery health check and roll back the BIOS update if needed.' },
          { at: at('2026-09-28', '16:06'), who: 'arjun', kind: 'STATUS_CHANGE', body: 'Status changed to In progress' },
          { at: at('2026-09-28', '16:12'), who: 'priya', kind: 'COMMENT', body: 'Sure — I’ll come in to the office tomorrow. Thanks!' },
        ],
      },
    ];

    for (const t of tickets) {
      const requesterId = E(t.requester);
      const cat = cats[t.category];
      if (!requesterId || !cat) continue;
      const policy = DEFAULT_SLA[t.priority];
      const due = dueDatesFor(t.createdAt, policy, cal);
      const clock = { createdAt: t.createdAt, status: t.status, ...due, firstRespondedAt: t.firstRespondedAt ?? null, resolvedAt: t.resolvedAt ?? null, pausedMins: 0, pausedSince: t.pausedSince ?? null };
      const escalatedTo = (t.escalatedTo ?? []).map(E).filter((x): x is string => !!x);
      const slaState = t.resolvedAt ? resolvedSlaState(clock, t.resolvedAt) : escalatedTo.length ? 'BREACHED' : t.pausedSince ? 'ON_TRACK' : evaluateSla(clock, policy, NOW, cal).state;
      const events = t.events.filter((e) => !e.who || E(e.who));
      const updatedAt = new Date(Math.max(t.createdAt.getTime(), ...events.map((e) => e.at.getTime())));
      const row = await prisma.helpdeskTicket.create({
        data: {
          tenantId,
          number: t.number,
          code: `HD-${t.number}`,
          categoryId: cat.id,
          groupId: cat.groupId,
          priority: t.priority,
          subject: t.subject,
          description: t.description,
          status: t.status,
          requesterEmployeeId: requesterId,
          assigneeEmployeeId: t.assignee ? E(t.assignee) : null,
          firstResponseDueAt: due.firstResponseDueAt,
          resolutionDueAt: due.resolutionDueAt,
          firstRespondedAt: t.firstRespondedAt ?? null,
          resolvedAt: t.resolvedAt ?? null,
          closedAt: t.closedAt ?? null,
          pausedMins: 0,
          pausedSince: t.pausedSince ?? null,
          slaState,
          escalationLevel: escalatedTo.length ? 1 : 0,
          escalatedToEmployeeIds: escalatedTo,
          resolutionNote: t.resolutionNote ?? null,
          csat: t.csat ?? null,
          attachmentFileIds: [],
          createdAt: t.createdAt,
          updatedAt,
        },
      });
      if (events.length) {
        await prisma.ticketComment.createMany({
          data: events.map((e) => ({ tenantId, ticketId: row.id, authorEmployeeId: e.who ? E(e.who) : null, visibility: e.internal ? 'INTERNAL' : 'PUBLIC', kind: e.kind, body: e.body, fileIds: [], createdAt: e.at })),
        });
      }
    }
    // No NumberSequence row: HelpdeskService allocates max(1043, highest + 1) → the next ticket is HD-1043.
  }
}

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** 10 Crockford base32 characters (same alphabet as CertificatesService codes). */
function verificationCode(): string {
  return [...randomBytes(10)].map((b) => CROCKFORD[b & 31]).join('');
}

// ── Thought of the day ─────────────────────────────────────────────────────

async function seedQuotes(prisma: PrismaClient, tenantId: string) {
  const all: [string, string | null][] = [...WIREFRAME_QUOTES.map((q) => [q, null] as [string, null]), ...CURATED_QUOTES];
  const n = all.length;
  // Rotation index for today; place the wireframe list so that QUOTES[1] lands on it.
  const idx = quoteIndexFor(TODAY, n);
  await prisma.quote.createMany({
    data: all.map(([text, author], k) => ({ tenantId, text, author, active: true, sortOrder: ((k - 1 + idx + n) % n) + 1, createdAt: at('2026-01-02', '09:00') })),
  });
}

// ── Company events ─────────────────────────────────────────────────────────

async function seedEvents(prisma: PrismaClient, tenantId: string, E: (k: string) => string | null) {
  const hr = E('kavya');
  await prisma.companyEvent.createMany({
    data: [
      {
        tenantId,
        title: 'Town hall',
        kind: 'TOWN_HALL',
        description: 'Quarterly business update from Rohit, appraisal timelines and open Q&A. Pune joins on the video bridge.',
        startsAt: at('2026-10-03', '17:00'),
        endsAt: at('2026-10-03', '18:00'),
        location: 'Cafeteria · Ahmedabad HQ',
        audiences: [],
        createdByEmployeeId: hr,
        createdAt: at('2026-09-21', '12:00'),
      },
      {
        tenantId,
        title: 'Security awareness training',
        kind: 'TRAINING',
        description: 'Mandatory one-hour session on phishing and client-data handling (IT & data security policy).',
        startsAt: at('2026-10-14', '11:00'),
        endsAt: at('2026-10-14', '12:00'),
        location: 'Board room',
        audiences: [],
        createdByEmployeeId: hr,
        createdAt: at('2026-09-24', '15:00'),
      },
      {
        tenantId,
        title: 'Diwali celebration & potluck',
        kind: 'CELEBRATION',
        description: 'Families welcome. Sign up for a dish by 1 Nov.',
        startsAt: at('2026-11-08', '16:00'),
        endsAt: at('2026-11-08', '20:00'),
        location: 'Terrace · Ahmedabad HQ',
        audiences: [],
        createdByEmployeeId: hr,
        createdAt: at('2026-09-27', '11:00'),
      },
    ],
  });
}

// ── Personal to-dos (private to their owner) ───────────────────────────────

async function seedTodos(prisma: PrismaClient, tenantId: string, E: (k: string) => string | null) {
  const rows: { who: string; title: string; due?: string; note?: string; done?: Date }[] = [
    { who: 'priya', title: 'Prepare demo notes for the Atlas sprint review', due: '2026-10-02' },
    { who: 'priya', title: 'Update emergency contact in my profile' },
    { who: 'priya', title: 'Share invoice PDF samples with QA', due: '2026-09-28', done: at('2026-09-28', '18:05') },
    { who: 'arjun', title: 'Kestrel go-live checklist', due: '2026-09-30', note: 'Rollback plan + smoke tests with Sneha' },
    { who: 'arjun', title: 'Review Isha’s intern goals', due: '2026-10-01' },
    { who: 'neha', title: 'Prepare Q2 engineering review deck', due: '2026-10-02' },
    { who: 'kavya', title: 'Confirm caterer for the Diwali potluck', due: '2026-10-05' },
    { who: 'kavya', title: 'Collect town hall questions', due: '2026-10-02' },
    { who: 'rohit', title: 'Town hall talking points', due: '2026-10-02' },
    { who: 'sneha', title: 'Plan the billing regression run', due: '2026-10-01' },
  ];
  const data = rows
    .filter((r) => E(r.who))
    .map((r, i) => ({ tenantId, employeeId: E(r.who)!, title: r.title, note: r.note ?? null, dueDate: r.due ? d(r.due) : null, completedAt: r.done ?? null, createdAt: addMin(at('2026-09-25', '09:30'), i * 97) }));
  if (data.length) await prisma.personalTodo.createMany({ data });
}

// ═════════════════════════════════════════════════════════════════════════════
// Comms hub, learning, rooms & visitors, CCTV and wellness (workplace part B)
// ═════════════════════════════════════════════════════════════════════════════

type FileFn = (ownerKey: string, name: string, category: string, isPrivate: boolean, buf: Buffer, createdAt: Date) => Promise<{ id: string }>;

const MONTH_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/**
 *  - Comms hub: #general (the wireframe's three messages at 10:02 / 10:05 / 10:09 today),
 *    #atlas-crm (3 unread for Priya, one @mention, yesterday's call summary), #qa-team
 *    (1 unread for Priya), #announcements (HR/Admin only) and Priya's DMs with Neha and Rahul.
 *  - Learning: the 4 wireframe tiles with Priya's progress (Secure coding 3 of 5, due 12 Oct;
 *    Git workflow completed · certificate ready; Writing good test cases not started; POSH
 *    completed) plus teammates' enrollments for the course reports.
 *  - Rooms & visitors: Board room / Huddle 1 / Huddle 2, the wireframe bookings (Board room
 *    30 Sep 11:00 – 12:00 Rohit "Nimbus Retail review", Huddle 2 15:00 – 15:30 Arjun "Sprint
 *    planning") and visitor Amit Khanna (Nimbus) 30 Sep 10:45 with an e-pass sent.
 *  - CCTV: 5 live cameras + Server room offline (last seen 08:12), RTSP URLs encrypted.
 *  - Wellness: this week's and last week's puzzle results (Development leads); Priya on a
 *    4-day streak with today's set still to play.
 */
export async function seedHub(prisma: PrismaClient, ctx: SeedCtx, h: { atlasId: string | null; file: FileFn }) {
  const { tenantId, emp, user, dept, branch } = ctx;
  const E = (k: string): string | null => emp[k] ?? null;
  const U = (k: string): string | null => user[k] ?? null;
  const crypto = new CryptoService();

  // ── Comms hub ────────────────────────────────────────────────────────────
  const users = await prisma.user.findMany({ where: { tenantId, status: { not: 'DISABLED' } }, select: { id: true, employee: { select: { id: true, status: true, departmentId: true } } } });
  const active = users.filter((u) => u.employee?.status !== 'EXITED').map((u) => u.id);
  const userOfEmp = new Map(users.filter((u) => u.employee).map((u) => [u.employee!.id, u.id]));
  const deptUsers = (name: string) => users.filter((u) => !!dept[name] && u.employee?.departmentId === dept[name] && u.employee?.status !== 'EXITED').map((u) => u.id);
  const atlasMembers = h.atlasId
    ? (await prisma.projectMember.findMany({ where: { tenantId, projectId: h.atlasId }, select: { employeeId: true } }).catch(() => [] as { employeeId: string }[])).map((m) => userOfEmp.get(m.employeeId)).filter((x): x is string => !!x)
    : [];
  const atlasLead = h.atlasId ? ((await prisma.project.findFirst({ where: { id: h.atlasId }, select: { leadEmployeeId: true } }).catch(() => null))?.leadEmployeeId ?? null) : null;
  if (atlasLead && userOfEmp.get(atlasLead)) atlasMembers.push(userOfEmp.get(atlasLead)!);

  type Msg = { who: string | null; at: Date; body: string; kind?: 'USER' | 'SYSTEM' | 'CALL_SUMMARY'; mentions?: string[] };
  type Chan = { name: string | null; kind: 'PUBLIC' | 'DM'; topic: string | null; linkedType: string | null; linkedId: string | null; posting: 'ALL_MEMBERS' | 'ADMINS_ONLY'; sort: number; audience: string[]; manual: string[]; owner: string | null; msgs: Msg[]; unreadFor?: Record<string, number>; dmKey?: string };
  const P = U('priya');
  const mention = (k: string) => (U(k) ? [U(k)!] : []);
  const ids = (...keys: string[]) => keys.map(U).filter((x): x is string => !!x);
  const chans: Chan[] = [
    {
      name: 'general', kind: 'PUBLIC', topic: 'Company-wide conversation', linkedType: 'COMPANY_GENERAL', linkedId: null, posting: 'ALL_MEMBERS', sort: 1, audience: active, manual: [], owner: null,
      msgs: [
        { who: 'kavya', at: at('2026-09-28', '09:30'), body: 'Good morning, everyone! Diwali potluck sign-ups are open on the notice board — add your dish by 1 Nov.' },
        { who: 'rohit', at: at('2026-09-28', '09:41'), body: 'Great work on the Nimbus demo on Friday, team. The client loved the new billing flow.' },
        { who: 'vikram', at: at('2026-09-28', '11:12'), body: 'The Pune studio gets its new standing desks on Thursday.' },
        { who: 'neha', at: at(TODAY, '10:02'), body: 'Release freeze starts Thursday. Please merge by Wednesday EOD.' },
        { who: 'rahul', at: at(TODAY, '10:05'), body: 'GST rounding fix is in QA now.' },
        { who: 'sneha', at: at(TODAY, '10:09'), body: 'Picking it up, will update by lunch.' },
      ],
    },
    {
      name: 'atlas-crm', kind: 'PUBLIC', topic: 'Atlas CRM · Nimbus Retail', linkedType: h.atlasId ? 'PROJECT' : null, linkedId: h.atlasId, posting: 'ALL_MEMBERS', sort: 2,
      audience: [...new Set(atlasMembers)], manual: ids('neha', 'arjun', 'priya', 'rahul', 'sneha', 'isha'), owner: U('arjun'),
      msgs: [
        { who: 'arjun', at: at('2026-09-28', '10:15'), body: 'Sprint 14 board is up. AT-104 and AT-107 are the priorities this week.' },
        { who: null, kind: 'CALL_SUMMARY', at: at('2026-09-28', '11:53'), body: 'Call · 23 min · 4 participants' },
        { who: 'priya', at: at('2026-09-28', '14:20'), body: 'AT-104 invoice PDF export is ready for review — the MR is linked on the card.' },
        { who: 'arjun', at: at(TODAY, '09:20'), body: '@Priya Sharma can you pair with Rahul on the GST rounding edge cases today?', mentions: mention('priya') },
        { who: 'rahul', at: at(TODAY, '09:34'), body: 'Pushed the fix for rounding on credit notes. Tests are green.' },
        { who: 'neha', at: at(TODAY, '09:52'), body: 'Reminder: freeze on Thursday. Anything not merged by Wednesday EOD moves to the next release.' },
      ],
      unreadFor: P ? { [P]: 3 } : {},
    },
    {
      name: 'qa-team', kind: 'PUBLIC', topic: 'QA · test plans, regressions and bug triage', linkedType: dept.QA ? 'DEPARTMENT' : null, linkedId: dept.QA ?? null, posting: 'ALL_MEMBERS', sort: 3,
      audience: deptUsers('QA'), manual: ids('priya', 'rahul', 'neha'), owner: U('sneha'),
      msgs: [
        { who: 'sneha', at: at('2026-09-28', '16:05'), body: 'Regression run for Atlas CRM is scheduled for Thursday 10 am.' },
        { who: 'karan', at: at('2026-09-28', '16:20'), body: 'I will take the invoice module test cases.' },
        { who: 'sneha', at: at(TODAY, '09:45'), body: '@Priya Sharma the GST rounding fix is in my queue — I will update you by lunch.', mentions: mention('priya') },
      ],
      unreadFor: P ? { [P]: 1 } : {},
    },
    {
      name: 'announcements', kind: 'PUBLIC', topic: 'Official announcements from HR and leadership', linkedType: 'COMPANY_ANNOUNCEMENTS', linkedId: null, posting: 'ADMINS_ONLY', sort: 4, audience: active, manual: [], owner: null,
      msgs: [
        { who: 'kavya', at: at('2026-09-25', '10:00'), body: 'The updated Leave & attendance policy is live. Please read and acknowledge it by 29 Sep.' },
        { who: 'rohit', at: at('2026-09-28', '18:00'), body: 'Town hall this Saturday, 3 Oct at 5 pm in the cafeteria and on the call link — Q2 results and the roadmap.' },
      ],
    },
  ];
  const dm = (other: string, owner: string, msgs: Msg[]) => {
    const o = U(other);
    if (!P || !o) return;
    chans.push({ name: null, kind: 'DM', topic: null, linkedType: null, linkedId: null, posting: 'ALL_MEMBERS', sort: 100, audience: [], manual: [P, o], owner: U(owner), dmKey: [P, o].sort().join(':'), msgs });
  };
  dm('neha', 'neha', [
    { who: 'neha', at: at('2026-09-28', '17:10'), body: 'Priya, can you share the AT-104 demo notes before the client review?' },
    { who: 'priya', at: at('2026-09-28', '17:25'), body: 'Sure — sending them over tonight.' },
    { who: 'neha', at: at(TODAY, '09:15'), body: 'Thanks for the notes. Looks good for tomorrow’s review.' },
  ]);
  dm('rahul', 'rahul', [
    { who: 'rahul', at: at(TODAY, '09:36'), body: 'Fix is pushed. Want to walk through the credit-note cases at 11?' },
    { who: 'priya', at: at(TODAY, '09:40'), body: 'Yes, 11 works. I booked Huddle 1.' },
  ]);
  for (const c of chans) {
    const msgs = c.msgs.filter((m) => !m.who || U(m.who));
    const last = msgs[msgs.length - 1];
    const ch = await prisma.chatChannel.create({
      data: { tenantId, kind: c.kind, name: c.name, topic: c.topic, linkedType: c.linkedType, linkedId: c.linkedId, dmKey: c.dmKey ?? null, postingPolicy: c.posting, createdByUserId: c.owner ?? U('kavya'), lastMessageSeq: msgs.length, lastMessageAt: last?.at ?? null, sortOrder: c.sort, createdAt: at('2026-01-05', '10:00') },
    });
    const audience = new Set(c.audience);
    const members = [...new Set([...c.audience, ...c.manual])];
    await prisma.chatMember.createMany({
      data: members.map((u) => ({ tenantId, channelId: ch.id, userId: u, role: u === c.owner ? 'OWNER' : 'MEMBER', managedBy: audience.has(u) ? 'AUDIENCE' : 'MANUAL', lastReadSeq: Math.max(0, msgs.length - (c.unreadFor?.[u] ?? 0)), joinedAt: at('2026-01-05', '10:00') })),
      skipDuplicates: true,
    });
    if (msgs.length) {
      await prisma.chatMessage.createMany({
        data: msgs.map((m, i) => ({ tenantId, channelId: ch.id, seq: i + 1, senderUserId: m.who ? U(m.who) : null, kind: m.kind ?? 'USER', body: m.body, mentions: m.mentions ?? [], attachments: [], createdAt: m.at })),
      });
    }
  }

  // ── Learning ─────────────────────────────────────────────────────────────
  const poshPdf = await h.file(
    'kavya',
    'POSH-awareness-handbook.pdf',
    'lms',
    true,
    await pdf('Learning · POSH awareness', 'Prevention of Sexual Harassment (POSH) — what every employee should know', [
      'The Sexual Harassment of Women at Workplace (Prevention, Prohibition and Redressal) Act, 2013 applies to every Lexisora office, client site and remote workspace.',
      'Harassment includes unwelcome physical contact, demands or requests for sexual favours, sexually coloured remarks, showing pornography and any other unwelcome conduct of a sexual nature.',
      'Our Internal Committee (IC) is chaired by Kavya Iyer. Complaints can be raised in writing within three months of the incident; the IC completes its inquiry within 90 days.',
      'Retaliation against anyone who raises a concern in good faith is itself a serious violation of company policy.',
    ]),
    at('2026-04-01', '10:00'),
  );
  type L = [string, number, ('VIDEO' | 'DOCUMENT')?, string?];
  const courseDefs: { key: string; title: string; category: 'REQUIRED' | 'OPTIONAL' | 'ONBOARDING'; description: string; lessons: L[]; assign: { audienceType: string; refId: string | null; label: string; required: boolean; dueInDays: number | null }[] }[] = [
    {
      key: 'secure', title: 'Secure coding guidelines', category: 'REQUIRED', description: 'OWASP Top 10 for our stack: input validation, authentication, secrets, dependency hygiene and the code review checklist.',
      lessons: [['Why secure coding matters', 8], ['Input validation & output encoding', 8], ['Authentication & session handling', 8], ['Secrets, keys and configuration', 8], ['Dependency & supply-chain hygiene', 8]],
      assign: dept.Development ? [{ audienceType: 'DEPARTMENT', refId: dept.Development, label: 'All developers', required: true, dueInDays: 14 }] : [],
    },
    {
      key: 'git', title: 'Git workflow at Lexisora', category: 'ONBOARDING', description: 'Branch naming (AT-123-short-title), merge requests, reviews, releases and hotfixes.',
      lessons: [['Branching & naming', 10], ['Merge requests & code review', 8], ['Releases, tags and hotfixes', 7]],
      assign: [{ audienceType: 'NEW_JOINERS', refId: null, label: 'New joiners', required: true, dueInDays: 14 }],
    },
    {
      key: 'tests', title: 'Writing good test cases', category: 'OPTIONAL', description: 'What makes a test useful, unit tests with Vitest, API tests, fixtures and test data.',
      lessons: [['What makes a test useful', 15], ['Unit tests with Vitest', 20], ['Integration & API tests', 20], ['Test data and fixtures', 15]],
      assign: [],
    },
    {
      key: 'posh', title: 'POSH awareness', category: 'REQUIRED', description: 'The POSH Act 2013, what counts as harassment, and how to raise a concern with the Internal Committee.',
      lessons: [['POSH Act 2013 — what it covers', 8, 'DOCUMENT', poshPdf.id], ['Raising a concern & the Internal Committee', 7]],
      assign: [{ audienceType: 'ALL', refId: null, label: 'All employees', required: true, dueInDays: 30 }],
    },
  ];
  const course: Record<string, { id: string; title: string; lessonIds: string[]; assignmentId: string | null }> = {};
  for (const [i, c] of courseDefs.entries()) {
    const created = await prisma.course.create({
      data: { tenantId, title: c.title, description: c.description, category: c.category, certificateOnCompletion: true, status: 'PUBLISHED', totalDurationSec: c.lessons.reduce((a, l) => a + l[1] * 60, 0), createdByEmployeeId: E('kavya'), publishedAt: at('2026-06-01', '10:00'), createdAt: addMin(at('2026-05-20', '10:00'), i * 60) },
    });
    const lessonIds: string[] = [];
    for (const [j, l] of c.lessons.entries()) {
      const doc = l[2] === 'DOCUMENT';
      const row = await prisma.lesson.create({
        data: { tenantId, courseId: created.id, order: j + 1, title: l[0], type: l[2] ?? 'VIDEO', fileId: l[3] ?? null, durationSec: l[1] * 60, content: doc ? 'Read the handbook, then mark the lesson as read.' : `Lesson ${j + 1} of ${c.lessons.length}: ${l[0]}. The recording is being re-edited — read these notes and mark the lesson as done.` },
      });
      lessonIds.push(row.id);
    }
    let assignmentId: string | null = null;
    for (const a of c.assign) {
      const row = await prisma.courseAssignment.create({ data: { tenantId, courseId: created.id, audienceType: a.audienceType, refId: a.refId, label: a.label, required: a.required, dueInDays: a.dueInDays, createdAt: at('2026-06-01', '10:05') } });
      assignmentId ??= row.id;
    }
    course[c.key] = { id: created.id, title: c.title, lessonIds, assignmentId };
  }
  const holder = new Map((await prisma.employee.findMany({ where: { tenantId }, select: { id: true, fullName: true } })).map((e) => [e.id, e.fullName]));
  type En = { who: string; c: string; done: number; status: 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED'; due?: string; source?: 'ASSIGNED' | 'SELF'; completedOn?: string; downloaded?: boolean };
  const enrollments: En[] = [
    { who: 'priya', c: 'secure', done: 3, status: 'IN_PROGRESS', due: '2026-10-12' },
    { who: 'priya', c: 'git', done: 3, status: 'COMPLETED', completedOn: '2026-09-24' },
    { who: 'priya', c: 'tests', done: 0, status: 'NOT_STARTED', source: 'SELF' },
    { who: 'priya', c: 'posh', done: 2, status: 'COMPLETED', completedOn: '2026-07-14', downloaded: true },
    { who: 'rahul', c: 'secure', done: 5, status: 'COMPLETED', completedOn: '2026-09-18', downloaded: true },
    { who: 'arjun', c: 'secure', done: 2, status: 'IN_PROGRESS', due: '2026-10-12' },
    { who: 'neha', c: 'secure', done: 5, status: 'COMPLETED', completedOn: '2026-09-21', downloaded: true },
    { who: 'isha', c: 'secure', done: 0, status: 'NOT_STARTED', due: '2026-10-12' },
    { who: 'isha', c: 'git', done: 1, status: 'IN_PROGRESS', due: '2026-09-29' },
    { who: 'karan', c: 'git', done: 3, status: 'COMPLETED', completedOn: '2026-09-25' },
    { who: 'divya', c: 'git', done: 0, status: 'NOT_STARTED', due: '2026-09-29' },
    { who: 'rahul', c: 'tests', done: 2, status: 'IN_PROGRESS', source: 'SELF' },
    ...['rohit', 'kavya', 'neha', 'arjun', 'rahul', 'sneha', 'vikram', 'ananya'].map((who) => ({ who, c: 'posh', done: 2, status: 'COMPLETED' as const, completedOn: '2026-07-20', downloaded: true })),
    { who: 'isha', c: 'posh', done: 1, status: 'IN_PROGRESS', due: '2026-10-15' },
    { who: 'karan', c: 'posh', done: 0, status: 'NOT_STARTED', due: '2026-10-15' },
    { who: 'divya', c: 'posh', done: 0, status: 'NOT_STARTED', due: '2026-10-15' },
  ];
  for (const e of enrollments) {
    const employeeId = E(e.who);
    const cr = course[e.c];
    if (!employeeId || !cr) continue;
    const total = cr.lessonIds.length;
    const completedAt = e.completedOn ? at(e.completedOn, '16:30') : null;
    const source = e.source ?? 'ASSIGNED';
    const row = await prisma.enrollment.create({
      data: {
        tenantId, courseId: cr.id, employeeId, source, required: source === 'ASSIGNED', assignedAt: at('2026-09-14', '10:00'), dueAt: e.due ? new Date(at(e.due, '23:59').getTime() + 59_000) : null,
        status: e.status, startedAt: e.done ? at('2026-09-16', '11:00') : null, completedAt, progressPct: e.status === 'COMPLETED' ? 100 : Math.round((100 * e.done) / total), lessonsDone: e.done,
        assignmentId: source === 'ASSIGNED' ? cr.assignmentId : null, lastLessonId: e.done && e.done < total ? (cr.lessonIds[e.done] ?? null) : null, certificateDownloadedAt: e.downloaded && completedAt ? addMin(completedAt, 5) : null,
      },
    });
    if (e.done) {
      await prisma.lessonProgress.createMany({ data: cr.lessonIds.slice(0, e.done).map((lessonId, i) => ({ tenantId, enrollmentId: row.id, lessonId, positionSec: 0, watchedBuckets: [], completedAt: addMin(at('2026-09-16', '11:00'), (i + 1) * 30) })) });
    }
    if (e.status === 'COMPLETED' && completedAt) {
      const ist = new Date(completedAt.getTime() + 330 * 60_000);
      const cert = await prisma.certificate.create({
        data: { tenantId, type: 'COURSE', recipientEmployeeId: employeeId, holderName: holder.get(employeeId) ?? e.who, title: cr.title, subtitle: `Completed on ${ist.getUTCDate()} ${MONTH_LONG[ist.getUTCMonth()]} ${ist.getUTCFullYear()}`, issuedAt: completedAt, verificationCode: verificationCode(), status: 'READY', sourceType: 'COURSE_ENROLLMENT', sourceId: row.id, metadata: { courseId: cr.id }, createdAt: completedAt },
      });
      await prisma.enrollment.update({ where: { id: row.id }, data: { certificateId: cert.id } });
    }
  }

  // ── Rooms & visitors ─────────────────────────────────────────────────────
  const rooms: Record<string, string> = {};
  for (const r of [
    { name: 'Board room', capacity: 12, amenities: ['Display', 'Video conferencing', 'Whiteboard'] },
    { name: 'Huddle 1', capacity: 4, amenities: ['Display'] },
    { name: 'Huddle 2', capacity: 4, amenities: ['Whiteboard'] },
  ]) {
    rooms[r.name] = (await prisma.room.create({ data: { tenantId, name: r.name, capacity: r.capacity, amenities: r.amenities, branchId: branch.Ahmedabad ?? null, createdAt: at('2026-01-05', '10:00') } })).id;
  }
  const bookings: { room: string; host: string; date: string; from: string; to: string; purpose: string; with: string[]; status?: 'BOOKED' | 'CANCELLED' | 'COMPLETED'; reason?: string }[] = [
    { room: 'Board room', host: 'rohit', date: '2026-09-30', from: '11:00', to: '12:00', purpose: 'Nimbus Retail review', with: ['neha', 'arjun'] },
    { room: 'Huddle 2', host: 'arjun', date: '2026-09-30', from: '15:00', to: '15:30', purpose: 'Sprint planning', with: ['priya', 'rahul', 'sneha', 'isha'] },
    { room: 'Huddle 1', host: 'priya', date: TODAY, from: '11:00', to: '11:30', purpose: 'GST rounding walkthrough', with: ['rahul'] },
    { room: 'Board room', host: 'kavya', date: '2026-10-01', from: '14:00', to: '15:30', purpose: 'Appraisal calibration', with: ['neha', 'rohit'] },
    { room: 'Huddle 1', host: 'vikram', date: '2026-10-01', from: '16:00', to: '16:30', purpose: 'Design review', with: ['divya'], status: 'CANCELLED', reason: 'Moved to the Pune studio' },
    { room: 'Board room', host: 'neha', date: '2026-09-28', from: '15:00', to: '16:00', purpose: 'Q2 engineering review prep', with: ['arjun'], status: 'COMPLETED' },
  ];
  for (const b of bookings) {
    const host = E(b.host);
    if (!host || !rooms[b.room]) continue;
    await prisma.roomBooking.create({
      data: { tenantId, roomId: rooms[b.room]!, hostEmployeeId: host, purpose: b.purpose, startAt: at(b.date, b.from), endAt: at(b.date, b.to), attendeeEmployeeIds: b.with.map(E).filter((x): x is string => !!x), status: b.status ?? 'BOOKED', cancelledByEmployeeId: b.status === 'CANCELLED' ? host : null, cancelReason: b.reason ?? null, createdAt: at('2026-09-25', '12:00') },
    });
  }
  const visitors: { name: string; company: string | null; host: string; date: string; time: string; purpose: string; phone: string | null; email: string | null; status: 'PASS_SENT' | 'CHECKED_OUT'; code: string; inAt?: string; outAt?: string }[] = [
    { name: 'Ritika Sen', company: null, host: 'kavya', date: '2026-09-25', time: '14:00', purpose: 'Interview — React developer', phone: '+919900112233', email: null, status: 'CHECKED_OUT', code: 'RS4K7P', inAt: '13:52', outAt: '15:10' },
    { name: 'Amit Khanna', company: 'Nimbus', host: 'rohit', date: '2026-09-30', time: '10:45', purpose: 'Client visit', phone: '+919825012345', email: 'amit.khanna@nimbus.example', status: 'PASS_SENT', code: 'NK7Q4M' },
  ];
  for (const [i, v] of visitors.entries()) {
    const host = E(v.host);
    if (!host) continue;
    const token = newPassToken();
    const win = passWindow(v.date, v.time);
    const link = `${(process.env.WEB_ORIGIN || 'http://localhost:5173').replace(/\/$/, '')}/api/v1/facility/pass/${token}`;
    const day = new Date(`${v.date}T00:00:00Z`);
    const text = `Hi ${v.name.split(' ')[0]}, your visitor pass for Lexisora Infotech on ${day.getUTCDate()} ${MONTH_LONG[day.getUTCMonth()]!.slice(0, 3)} at ${v.time}. Show this at reception: ${link} (pass code ${v.code}).`;
    const sentAt = at(addDaysKey(v.date, -1), '17:30').toISOString();
    const deliveries = [
      ...(v.phone ? [{ channel: 'WHATSAPP', to: v.phone.replace('+', ''), status: 'LINK', link: waLink(v.phone, text), sentAt }] : []),
      ...(v.email ? [{ channel: 'EMAIL', to: v.email, status: 'SENT', link: null, sentAt }] : []),
    ];
    await prisma.visitor.create({
      data: {
        tenantId, number: i + 1, name: v.name, company: v.company, phone: v.phone, email: v.email, hostEmployeeId: host, branchId: branch.Ahmedabad ?? null, visitDate: d(v.date), expectedTime: v.time, purpose: v.purpose, status: v.status,
        checkedInAt: v.inAt ? at(v.date, v.inAt) : null, checkedOutAt: v.outAt ? at(v.date, v.outAt) : null, checkedInByEmployeeId: v.inAt ? E('kavya') : null,
        passToken: token, shortCode: v.code, validFrom: win.validFrom, validUntil: win.validUntil, passRevokedAt: v.outAt ? at(v.date, v.outAt) : null, deliveries, createdAt: at(addDaysKey(v.date, -1), '17:25'),
      },
    });
  }

  // ── CCTV ─────────────────────────────────────────────────────────────────
  const cams: { name: string; location: string; ip: string; online: boolean; branch: string }[] = [
    { name: 'Main entrance', location: 'Ahmedabad HQ', ip: '10.0.0.21', online: true, branch: 'Ahmedabad' },
    { name: 'Reception', location: 'Ahmedabad HQ', ip: '10.0.0.22', online: true, branch: 'Ahmedabad' },
    { name: 'Dev floor', location: 'Ahmedabad HQ', ip: '10.0.0.23', online: true, branch: 'Ahmedabad' },
    { name: 'Server room', location: 'Ahmedabad HQ', ip: '10.0.0.25', online: false, branch: 'Ahmedabad' },
    { name: 'Parking', location: 'Ahmedabad HQ', ip: '10.0.0.26', online: true, branch: 'Ahmedabad' },
    { name: 'Pune studio', location: 'Baner Road', ip: '10.1.0.21', online: true, branch: 'Pune' },
  ];
  const camIds: string[] = [];
  for (const [i, c] of cams.entries()) {
    const rtsp = `rtsp://nvr:Lx-Nvr-2026@${c.ip}:554/Streaming/Channels/101`;
    const row = await prisma.camera.create({
      data: { tenantId, branchId: branch[c.branch] ?? null, location: c.location, name: c.name, rtspUrlEnc: crypto.encrypt(rtsp), rtspMasked: maskRtsp(rtsp), gatewayPath: `t_${tenantId.slice(-6)}_cam${i + 1}`, status: c.online ? 'ONLINE' : 'OFFLINE', lastSeenAt: c.online ? at(TODAY, '09:39') : at(TODAY, '08:12'), lastError: c.online ? null : `No response from ${c.ip}:554`, sortOrder: i + 1, createdAt: at('2026-01-05', '10:00') },
    });
    camIds.push(row.id);
  }
  if (U('rohit') && camIds.length >= 4) {
    await prisma.cameraViewSession.createMany({
      data: [
        { tenantId, cameraId: camIds[1]!, userId: U('rohit')!, startedAt: at('2026-09-28', '18:02'), lastBeatAt: at('2026-09-28', '18:06'), endedAt: at('2026-09-28', '18:06') },
        { tenantId, cameraId: camIds[3]!, userId: U('rohit')!, startedAt: at(TODAY, '08:20'), lastBeatAt: at(TODAY, '08:22'), endedAt: at(TODAY, '08:22') },
      ],
    });
  }

  // ── Wellness ─────────────────────────────────────────────────────────────
  type G = [who: string, date: string, game: GameKey, start: string, elapsedSec: number, hints?: number];
  const plays: G[] = [
    // Last week (21–27 Sep)
    ['priya', '2026-09-25', 'queens', '13:10', 118], ['priya', '2026-09-26', 'sudoku6', '12:40', 205], ['priya', '2026-09-27', 'wordladder', '11:05', 64],
    ['rahul', '2026-09-24', 'queens', '13:30', 96], ['rahul', '2026-09-25', 'sudoku6', '13:45', 240, 1], ['arjun', '2026-09-23', 'queens', '18:10', 150],
    ['sneha', '2026-09-22', 'queens', '13:20', 88], ['sneha', '2026-09-24', 'sudoku6', '13:15', 170], ['karan', '2026-09-25', 'wordladder', '17:30', 52],
    ['vikram', '2026-09-23', 'queens', '12:50', 101], ['kavya', '2026-09-24', 'wordladder', '14:00', 75],
    // This week (28 Sep – 4 Oct; today is Tue 29 Sep)
    ['priya', '2026-09-28', 'queens', '13:05', 95], ['priya', '2026-09-28', 'sudoku6', '13:12', 150],
    ['rahul', '2026-09-28', 'queens', '13:40', 80], ['rahul', TODAY, 'queens', '09:05', 70], ['rahul', TODAY, 'wordladder', '09:12', 50],
    ['arjun', '2026-09-28', 'sudoku6', '18:20', 200], ['isha', TODAY, 'queens', '09:20', 140], ['neha', '2026-09-28', 'wordladder', '19:00', 58],
    ['sneha', '2026-09-28', 'queens', '13:25', 110], ['karan', TODAY, 'sudoku6', '09:30', 260, 1], ['vikram', '2026-09-28', 'queens', '12:55', 90], ['kavya', '2026-09-28', 'wordladder', '14:10', 66],
  ];
  const puzzles = new Map<string, { solution: unknown; par?: number; steps?: number }>();
  const puzzleFor = (game: GameKey, date: string) => {
    const k = `${game}:${date}`;
    if (!puzzles.has(k)) {
      if (game === 'queens') puzzles.set(k, { solution: generateQueens(tenantId, date).solution });
      else if (game === 'sudoku6') puzzles.set(k, { solution: generateSudoku(tenantId, date).solution });
      else {
        const p = generateLadder(tenantId, date);
        puzzles.set(k, { solution: p.example, par: p.par, steps: p.example.length - 1 });
      }
    }
    return puzzles.get(k)!;
  };
  const sessions = plays
    .filter(([who]) => E(who))
    .map(([who, date, game, start, elapsedSec, hints = 0]) => {
      const p = puzzleFor(game, date);
      const startedAt = at(date, start);
      return {
        tenantId, employeeId: E(who)!, gameKey: game, puzzleDate: d(date), startedAt, startToken: randomBytes(18).toString('base64url'), completedAt: new Date(startedAt.getTime() + elapsedSec * 1000), elapsedSec, hintsUsed: hints,
        moves: p.steps ?? null, revealed: false, points: scoreGame(game, { elapsedSec, hintsUsed: hints, revealed: false, steps: p.steps, par: p.par }), solution: p.solution as Prisma.InputJsonValue,
      };
    });
  if (sessions.length) await prisma.gameSession.createMany({ data: sessions });
}

function addDaysKey(key: string, days: number): string {
  return new Date(new Date(`${key}T00:00:00Z`).getTime() + days * 86_400_000).toISOString().slice(0, 10);
}
