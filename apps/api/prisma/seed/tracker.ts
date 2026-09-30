import type { Prisma, PrismaClient } from '@prisma/client';
import sharp from 'sharp';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { summarizeSegments, type TrackerPerTask } from '@lexisora/shared';
import type { SeedCtx } from './core';
import { buildTimeline, pickClaimReviewer } from '../../src/modules/tracker/tracker.rules';

/**
 * Demo data for the tracker domain (wireframe "today" = Tue 29 Sep 2026, IST).
 *
 * - Devices: PRIYA-LAPTOP (Windows 11 · v1.4.2, paired this morning 29 Sep; the v1.3.8 pairing it
 *   replaced shows as unpaired), Vikram, Arjun (2 active incl. one stale/outdated + 1 awaiting HR),
 *   Rahul and Sneha (office staff → monitor-only), Ananya (revoked by HR).
 * - Week 21–27 Sep for Priya / Rahul / Vikram / Sneha is derived from the time domain's seeded
 *   timesheets: WORK segments per task per day equal the timesheet cells, deducted idle equals the
 *   timesheet idle row, and the screenshot count equals Timesheet.screenshotCount (one shot about
 *   every 10 min of WORK, tagged with the task). Segments are laid into the employee's seeded work
 *   sessions (lunch = the punch-out gap; no BREAK segment, so a later recompute does not double
 *   count lunch). Mon 28 Sep is filled to the attendance sessions (feeds the current week).
 * - Idle claims: two PENDING for Priya (AT project → reviewed by the project lead), one REJECTED
 *   for Vikram (already folded into his deducted idle).
 * - Integrity flags: Vikram app quit + gap (Thu), Rahul clock skew (Wed).
 * Without the time/work seeds it falls back to built-in plans; tasks resolve by key.
 */

const WEEK = ['2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25', '2026-09-26', '2026-09-27'];
const MON28 = '2026-09-28';
const SHOT_INTERVAL_MIN = 10;
const MAX_SEGMENT_MIN = 50;

type ClaimStatus = 'PENDING' | 'APPROVED' | 'REJECTED';
type BlockKind = 'WORK' | 'IDLE' | 'CLAIM';
type Block = { kind: BlockKind; min: number; key?: string | null; note?: string; claimStatus?: ClaimStatus };
type Placed = Block & { start: Date; end: Date };
type Win = { start: Date; end: Date | null; source: string | null };

export type DayPlan = {
  date: string;
  /** Project tasks in timesheet line order: [taskKey, minutes]. */
  main: [string, number][];
  /** INT-1 stand-up & meetings minutes. */
  standup?: number;
  /** AT-110 code review minutes (placed at the end of the day). */
  review?: number;
  /** Other internal / standing tasks (INT-2 training …). */
  other?: [string, number][];
  /** Deducted idle minutes (IDLE segments). */
  idle: number;
  claims?: { min: number; key: string; note: string; status?: ClaimStatus }[];
  /** Minutes without tracker data right after lunch (app quit). */
  gapAfterLunch?: number;
};

const ist = (date: string, hhmm: string) => new Date(`${date}T${hhmm}:00+05:30`);
const dbDate = (key: string) => new Date(`${key}T00:00:00.000Z`);
const keyOf = (d: Date) => d.toISOString().slice(0, 10);
const addMin = (d: Date, m: number) => new Date(d.getTime() + m * 60_000);
const agoMin = (m: number) => new Date(Date.now() - m * 60_000);
const later = (a: Date, b: Date) => (a.getTime() > b.getTime() ? a : b);
/** IST is a fixed UTC+05:30 (no DST); formatted by hand so ICU versions can't change the copy ("Sep", not "Sept"). */
const inIst = (d: Date) => new Date(d.getTime() + 330 * 60_000);
const pad2 = (n: number) => String(n).padStart(2, '0');
const fmtHm = (d: Date) => `${pad2(inIst(d).getUTCHours())}:${pad2(inIst(d).getUTCMinutes())}`;
const fmtDay = (d: Date) => {
  const x = inIst(d);
  return `${'Sun Mon Tue Wed Thu Fri Sat'.split(' ')[x.getUTCDay()]} ${x.getUTCDate()} ${'Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'.split(' ')[x.getUTCMonth()]}`;
};

/** Deterministic PRNG (mulberry32 over an FNV-1a hash of the seed string). */
function rng(seed: string) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return () => {
    h = (h + 0x6d2b79f5) | 0;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Day narrative: main task → stand-up (INT-1) → main task → idle → other tasks → main task →
 * idle → other tasks → internal → code review. Claims (and an app-quit gap) go right after lunch.
 */
export function layout(p: DayPlan): { flow: Block[]; afterLunch: Block[] } {
  const flow: Block[] = [];
  const i1 = Math.ceil(p.idle / 2);
  const i2 = p.idle - i1;
  const firsts = p.main.map(([k, m]) => [k, Math.round(m * 0.55)] as [string, number]);
  const seconds = p.main.map(([k, m], i) => [k, m - firsts[i]![1]] as [string, number]);
  const lead = firsts[0] ? Math.min(25, firsts[0][1]) : 0;
  if (firsts[0]) flow.push({ kind: 'WORK', key: firsts[0][0], min: lead });
  if (p.standup) flow.push({ kind: 'WORK', key: 'INT-1', min: p.standup });
  if (firsts[0]) flow.push({ kind: 'WORK', key: firsts[0][0], min: firsts[0][1] - lead });
  flow.push({ kind: 'IDLE', min: i1 });
  for (const [k, m] of firsts.slice(1)) flow.push({ kind: 'WORK', key: k, min: m });
  if (seconds[0]) flow.push({ kind: 'WORK', key: seconds[0][0], min: seconds[0][1] });
  flow.push({ kind: 'IDLE', min: i2 });
  for (const [k, m] of seconds.slice(1)) flow.push({ kind: 'WORK', key: k, min: m });
  for (const [k, m] of p.other ?? []) flow.push({ kind: 'WORK', key: k, min: m });
  if (p.review) flow.push({ kind: 'WORK', key: 'AT-110', min: p.review });
  const afterLunch: Block[] = (p.claims ?? []).map((c) => ({ kind: 'CLAIM', key: c.key, min: c.min, note: c.note, claimStatus: c.status ?? 'PENDING' }));
  return { flow: flow.filter((b) => b.min > 0), afterLunch: afterLunch.filter((b) => b.min > 0) };
}

/**
 * Lays blocks into the day's work sessions (windows). Blocks are split at a session end and
 * continue when the next session starts (lunch = the punch-out gap); the last session is open-ended.
 */
export function placeBlocks(flow: Block[], afterLunch: Block[], wins: Win[], gapAfterLunch = 0) {
  const placed: Placed[] = [];
  const gaps: { from: Date; to: Date }[] = [];
  let wi = 0;
  let cursor = wins[0]!.start.getTime();
  let lunchDone = false;
  const limit = (i: number) => (i < wins.length - 1 && wins[i]!.end ? wins[i]!.end!.getTime() : Number.POSITIVE_INFINITY);
  const put = (b: Block, ms: number) => {
    placed.push({ ...b, start: new Date(cursor), end: new Date(cursor + ms) });
    cursor += ms;
  };
  const afterLunchNow = () => {
    if (lunchDone) return;
    lunchDone = true;
    if (gapAfterLunch > 0) {
      gaps.push({ from: new Date(cursor), to: new Date(cursor + gapAfterLunch * 60_000) });
      cursor += gapAfterLunch * 60_000;
    }
    for (const c of afterLunch) put(c, c.min * 60_000);
  };
  for (const b of flow) {
    let left = b.min * 60_000;
    while (left > 0) {
      const room = limit(wi) - cursor;
      if (room < 60_000) {
        wi++;
        cursor = Math.max(cursor, wins[wi]!.start.getTime());
        afterLunchNow();
        continue;
      }
      const take = Math.min(left, room);
      put(b, take);
      left -= take;
    }
  }
  afterLunchNow(); // single session: claims at the end of the day
  return { placed, gaps };
}

/** The device closes a segment on every task switch and at least every 50 minutes (sync). */
function explode(ps: Placed[]): Placed[] {
  const out: Placed[] = [];
  for (const p of ps) {
    if (p.kind !== 'WORK' || p.end.getTime() - p.start.getTime() <= MAX_SEGMENT_MIN * 60_000) {
      out.push(p);
      continue;
    }
    let s = p.start.getTime();
    while (s < p.end.getTime()) {
      const e = Math.min(p.end.getTime(), s + MAX_SEGMENT_MIN * 60_000);
      out.push({ ...p, start: new Date(s), end: new Date(e) });
      s = e;
    }
  }
  return out;
}

/**
 * Spreads `count` screenshots evenly over the WORK time (± 30 % jitter of the spacing, still
 * monotonic), each tagged with the task being worked on at that instant.
 */
export function spreadShots<T extends { start: Date; end: Date }>(segs: T[], count: number, rand: () => number): { at: Date; seg: T }[] {
  const dur = (s: T) => s.end.getTime() - s.start.getTime();
  const total = segs.reduce((a, s) => a + dur(s), 0);
  if (count <= 0 || total <= 0) return [];
  const step = total / count;
  const out: { at: Date; seg: T }[] = [];
  let i = 0;
  let acc = 0;
  for (let k = 0; k < count; k++) {
    let pos = (k + 0.5) * step + (rand() - 0.5) * 0.6 * step;
    pos = Math.min(Math.max(pos, 0), total - 1000);
    while (i < segs.length - 1 && acc + dur(segs[i]!) <= pos) {
      acc += dur(segs[i]!);
      i++;
    }
    const seg = segs[i]!;
    const off = Math.min(Math.max(pos - acc, 0), dur(seg) - 1000);
    out.push({ at: new Date(Math.round((seg.start.getTime() + off) / 1000) * 1000), seg });
  }
  return out;
}

async function placeholderPng(lines: string[], accent: string): Promise<Buffer> {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="250">
  <rect width="400" height="250" fill="#f4f1ec"/>
  <rect width="400" height="26" fill="#2b2b2b"/>
  <circle cx="14" cy="13" r="4" fill="#e06c5a"/><circle cx="28" cy="13" r="4" fill="#e5b75a"/><circle cx="42" cy="13" r="4" fill="#7cb87a"/>
  <rect x="16" y="44" width="110" height="190" fill="#e6e0d6"/>
  <rect x="140" y="44" width="244" height="12" fill="${accent}" opacity="0.55"/>
  <rect x="140" y="64" width="200" height="8" fill="#d8d1c5"/><rect x="140" y="80" width="226" height="8" fill="#d8d1c5"/>
  <rect x="140" y="96" width="180" height="8" fill="#d8d1c5"/>
  <text x="140" y="148" font-family="Arial, Helvetica, sans-serif" font-size="26" font-weight="bold" fill="#1c1c1c">${esc(lines[0] ?? '')}</text>
  <text x="140" y="174" font-family="Arial, Helvetica, sans-serif" font-size="13" fill="#444">${esc(lines[1] ?? '')}</text>
  <text x="140" y="200" font-family="Arial, Helvetica, sans-serif" font-size="13" fill="#666">${esc(lines[2] ?? '')}</text>
  <text x="140" y="222" font-family="Arial, Helvetica, sans-serif" font-size="11" fill="#888">${esc(lines[3] ?? '')}</text>
</svg>`;
  return sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toBuffer();
}

/** Idle claims / app-quit gaps / clock skew in the demo week (keyed by person, then date). */
const CLAIMS: Record<string, Record<string, { idx: number; min: number; note: string; status: ClaimStatus }[]>> = {
  priya: {
    '2026-09-23': [{ idx: 0, min: 25, note: 'Client call with the Atlas billing team', status: 'PENDING' }],
    '2026-09-24': [{ idx: 1, min: 15, note: 'Whiteboard session on menu permissions', status: 'PENDING' }],
  },
  vikram: { '2026-09-22': [{ idx: 0, min: 20, note: 'Design review on a call (no keyboard)', status: 'REJECTED' }] },
};
const GAPS: Record<string, Record<string, number>> = { vikram: { '2026-09-24': 35 } };
const SKEW: Record<string, Record<string, number>> = { rahul: { '2026-09-23': 420 } };
const PREFERRED: Record<string, string[]> = {
  priya: ['AT-101', 'AT-103'],
  rahul: ['AT-102', 'AT-104'],
  vikram: ['KS-201', 'AT-106'],
  sneha: ['AT-108', 'AT-109'],
};

export async function seed_tracker(prisma: PrismaClient, ctx: SeedCtx): Promise<void> {
  const { tenantId, emp, user } = ctx;
  if (!emp.priya || !user.priya) return;
  const storageRoot = resolve(process.env.STORAGE_DIR || './storage');

  // ── tasks by key (work seed) ────────────────────────────────────────────
  const taskRows = await prisma.task
    .findMany({
      where: { tenantId },
      select: { id: true, key: true, title: true, projectId: true, assigneeEmployeeId: true, isStanding: true, status: true, project: { select: { leadEmployeeId: true, isInternal: true } } },
    })
    .catch(() => []);
  const byKey = new Map(taskRows.map((t) => [t.key, t]));
  const byId = new Map(taskRows.map((t) => [t.id, t]));
  const isInternalKey = (k: string) => {
    const t = byKey.get(k);
    return t ? t.isStanding || !!t.project?.isInternal : k.startsWith('INT-');
  };
  /** Preferred keys that exist, else the employee's own open tasks, else the preferred keys as-is. */
  const pick = (employeeId: string, preferred: string[], n: number): string[] => {
    const have = preferred.filter((k) => byKey.has(k));
    if (have.length >= n) return have.slice(0, n);
    const own = taskRows
      .filter((t) => t.assigneeEmployeeId === employeeId && !t.isStanding && !['DONE', 'CANCELLED'].includes(t.status))
      .map((t) => t.key)
      .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))
      .filter((k) => !have.includes(k));
    const out = [...have, ...own].slice(0, n);
    while (out.length < n) out.push(preferred[out.length] ?? 'INT-2');
    return out;
  };

  // ── devices ────────────────────────────────────────────────────────────
  type Dev = Prisma.TrackerDeviceCreateManyInput & { id: string };
  const dev = (d: Omit<Dev, 'tenantId' | 'id'> & { id?: string }): Dev => ({ id: d.id ?? randomUUID(), tenantId, ...d });
  const kavyaUser = user.kavya ?? null;
  // An HR-pending request expires 72 h after creation; keep the demo one fresh whenever the seed runs.
  const arjunRequestAt = later(ist('2026-09-29', '10:05'), agoMin(95));
  const devices: Record<string, Dev> = {
    priyaOld: dev({
      userId: user.priya, employeeId: emp.priya, hostname: 'PRIYA-LAPTOP', os: 'Windows 11 Pro 23H2', appVersion: '1.3.8', status: 'REVOKED',
      pairedAt: ist('2024-01-15', '10:05'), lastSeenAt: ist('2026-09-29', '09:18'), lastSyncAt: ist('2026-09-28', '18:43'), approvalMethod: 'PORTAL_CODE', approvedByUserId: user.priya,
      revokedAt: ist('2026-09-29', '09:18'), revokedByUserId: user.priya, revokeReason: 'Signed out & unpaired on the device', createdAt: ist('2024-01-15', '10:02'),
    }),
    // Paired this morning; Priya has not punched in yet today (time seed) → OUT.
    priya: dev({
      userId: user.priya, employeeId: emp.priya, hostname: 'PRIYA-LAPTOP', os: 'Windows 11', appVersion: '1.4.2', status: 'ACTIVE',
      pairedAt: ist('2026-09-29', '09:24'), lastSeenAt: later(ist('2026-09-29', '09:26'), agoMin(2)), lastSyncAt: ist('2026-09-29', '09:25'), liveStatus: 'OUT', approvalMethod: 'PORTAL_CODE', approvedByUserId: user.priya, displays: 2, createdAt: ist('2026-09-29', '09:21'),
    }),
  };
  if (emp.vikram && user.vikram)
    devices.vikram = dev({
      userId: user.vikram, employeeId: emp.vikram, hostname: 'VIKRAM-PC', os: 'Windows 11', appVersion: '1.4.2', status: 'ACTIVE',
      pairedAt: ist('2025-03-10', '11:40'), lastSeenAt: agoMin(6), lastSyncAt: agoMin(6), liveStatus: 'WORKING', approvalMethod: 'PORTAL_CODE', approvedByUserId: user.vikram, createdAt: ist('2025-03-10', '11:37'),
    });
  if (emp.arjun && user.arjun) {
    devices.arjun = dev({
      userId: user.arjun, employeeId: emp.arjun, hostname: 'ARJUN-LAPTOP', os: 'Windows 11', appVersion: '1.4.2', status: 'ACTIVE',
      pairedAt: ist('2025-06-10', '09:50'), lastSeenAt: agoMin(15), lastSyncAt: agoMin(15), liveStatus: 'WORKING', approvalMethod: 'PORTAL_CODE', approvedByUserId: user.arjun, createdAt: ist('2025-06-10', '09:48'),
    });
    devices.arjunDesk = dev({
      userId: user.arjun, employeeId: emp.arjun, hostname: 'ARJUN-DESKTOP', os: 'Windows 10', appVersion: '1.3.8', status: 'ACTIVE',
      pairedAt: ist('2024-02-01', '10:15'), lastSeenAt: ist('2026-09-12', '19:02'), lastSyncAt: ist('2026-09-12', '19:02'), queueDepth: 14, liveStatus: 'OUT', approvalMethod: 'PORTAL_CODE', approvedByUserId: user.arjun, createdAt: ist('2024-02-01', '10:12'),
    });
    devices.arjunNew = dev({
      userId: user.arjun, employeeId: emp.arjun, hostname: 'ARJUN-SURFACE', os: 'Windows 11', appVersion: '1.4.2', status: 'PENDING', createdAt: arjunRequestAt,
    });
  }
  if (emp.rahul && user.rahul)
    devices.rahul = dev({
      userId: user.rahul, employeeId: emp.rahul, hostname: 'RAHUL-WS', os: 'Windows 11', appVersion: '1.4.1', status: 'ACTIVE',
      pairedAt: ist('2025-11-04', '09:45'), lastSeenAt: agoMin(9), lastSyncAt: agoMin(9), liveStatus: 'WORKING', approvalMethod: 'PORTAL_CODE', approvedByUserId: user.rahul, lastSkewSec: 12, createdAt: ist('2025-11-04', '09:43'),
    });
  if (emp.sneha && user.sneha)
    devices.sneha = dev({
      userId: user.sneha, employeeId: emp.sneha, hostname: 'SNEHA-QA-PC', os: 'Windows 10', appVersion: '1.4.2', status: 'ACTIVE',
      pairedAt: ist('2025-08-18', '10:20'), lastSeenAt: agoMin(4), lastSyncAt: agoMin(4), liveStatus: 'WORKING', approvalMethod: 'PORTAL_CODE', approvedByUserId: user.sneha, displays: 2, createdAt: ist('2025-08-18', '10:18'),
    });
  if (emp.ananya && user.ananya)
    devices.ananya = dev({
      userId: user.ananya, employeeId: emp.ananya, hostname: 'ANANYA-LT', os: 'Windows 10', appVersion: '1.3.5', status: 'REVOKED',
      pairedAt: ist('2024-06-03', '09:40'), lastSeenAt: ist('2026-09-10', '17:55'), lastSyncAt: ist('2026-09-10', '17:55'), approvalMethod: 'PORTAL_CODE', approvedByUserId: user.ananya,
      revokedAt: ist('2026-09-10', '18:10'), revokedByUserId: kavyaUser, revokeReason: 'Laptop returned to IT (notice period)', createdAt: ist('2024-06-03', '09:38'),
    });
  await prisma.trackerDevice.createMany({ data: Object.values(devices) });

  const pairing: Prisma.DevicePairingRequestCreateManyInput[] = [];
  const pr = (d: Dev, status: string, at: Date, extra: Partial<Prisma.DevicePairingRequestCreateManyInput> = {}) =>
    pairing.push({
      tenantId, userId: d.userId, employeeId: d.employeeId, sessionTokenHash: createHash('sha256').update(randomUUID()).digest('hex'),
      sessionExpiresAt: addMin(at, 15), mode: 'PUNCH', status, codeHash: createHash('sha256').update(randomUUID()).digest('hex'),
      hostname: d.hostname, os: d.os, appVersion: d.appVersion, permissions: ['activity monitor', 'screen capture'], expiresAt: addMin(at, 10),
      deviceId: d.id, createdAt: at, ...extra,
    });
  pr(devices.priya!, 'CLAIMED', ist('2026-09-29', '09:21'), { approvedAt: ist('2026-09-29', '09:24'), approvedByUserId: user.priya, approvalMethod: 'PORTAL_CODE', claimedAt: ist('2026-09-29', '09:24') });
  if (devices.arjunNew) pr(devices.arjunNew, 'AWAITING_HR', arjunRequestAt, { sessionExpiresAt: addMin(arjunRequestAt, 72 * 60), ip: '10.20.4.18' });
  await prisma.devicePairingRequest.createMany({ data: pairing });

  // ── the people whose week is tracked (time seed: timesheets 21–27 Sep) ──
  type Person = { key: string; employeeId: string; device: Dev; managerId: string | null; punchMode: boolean };
  const people: Person[] = [];
  for (const [key, device] of [['priya', devices.priyaOld], ['rahul', devices.rahul], ['vikram', devices.vikram], ['sneha', devices.sneha]] as const) {
    const employeeId = emp[key];
    if (!employeeId || !device) continue;
    const e = await prisma.employee.findUnique({ where: { id: employeeId }, select: { managerId: true, workMode: true } });
    if (!e) continue;
    people.push({ key, employeeId, device, managerId: e.managerId ?? null, punchMode: e.workMode !== 'OFFICE' });
  }
  const ids = people.map((p) => p.employeeId);

  const sheets = await prisma.timesheet
    .findMany({ where: { tenantId, employeeId: { in: ids }, weekStart: dbDate(WEEK[0]!) }, include: { lines: { include: { cells: true } } } })
    .catch(() => []);
  const idleRows = sheets.length
    ? await prisma.timesheetIdleDay.findMany({ where: { tenantId, timesheetId: { in: sheets.map((s) => s.id) } } }).catch(() => [])
    : [];
  const sessions = await prisma.workSession
    .findMany({
      where: { tenantId, employeeId: { in: ids }, attendanceDate: { gte: dbDate(WEEK[0]!), lte: dbDate(MON28) } },
      orderBy: { startedAt: 'asc' },
      select: { employeeId: true, attendanceDate: true, startedAt: true, endedAt: true, source: true },
    })
    .catch(() => []);
  const attDays = await prisma.attendanceDay
    .findMany({ where: { tenantId, employeeId: { in: ids }, date: dbDate(MON28) }, select: { employeeId: true, idleMinutes: true } })
    .catch(() => []);

  const windowsFor = (p: Person, date: string): Win[] => {
    const own = sessions.filter((s) => s.employeeId === p.employeeId && keyOf(s.attendanceDate) === date);
    if (own.length) return own.map((s) => ({ start: s.startedAt, end: s.endedAt, source: s.source }));
    const r = rng(`${p.key}:${date}:win`);
    const start = addMin(ist(date, '09:30'), Math.floor(r() * 16) - 5);
    const lunch = addMin(start, 225 + Math.floor(r() * 30));
    return [
      { start, end: lunch, source: p.punchMode ? 'DESKTOP' : 'BIOMETRIC' },
      { start: addMin(lunch, 50 + Math.floor(r() * 10)), end: null, source: p.punchMode ? 'DESKTOP' : 'BIOMETRIC' },
    ];
  };

  /** Day plans for the timesheet week, straight from the time seed's cells (fallback: built-in). */
  const weekPlans = (p: Person): { plans: DayPlan[]; shots: number | null; submittedAt: Date | null; mainKeys: string[]; hasReview: boolean } => {
    const sheet = sheets.find((s) => s.employeeId === p.employeeId);
    const claimsFor = (date: string, main: [string, number][]) =>
      (CLAIMS[p.key]?.[date] ?? []).filter((c) => main[c.idx] || main[0]).map((c) => ({ min: c.min, key: (main[c.idx] ?? main[0])![0], note: c.note, status: c.status }));
    const rejectedMin = (date: string) => (CLAIMS[p.key]?.[date] ?? []).filter((c) => c.status === 'REJECTED').reduce((a, c) => a + c.min, 0);
    if (sheet) {
      const lines: { key: string; cells: { date: Date; trackedMinutes: number }[] }[] = [];
      for (const l of [...sheet.lines].sort((a, b) => ((a as { sortOrder?: number }).sortOrder ?? 0) - ((b as { sortOrder?: number }).sortOrder ?? 0))) {
        const key = l.taskId ? byId.get(l.taskId)?.key : undefined;
        if (key) lines.push({ key, cells: l.cells });
      }
      const minutesOn = (cells: { date: Date; trackedMinutes: number }[], date: string) => cells.filter((c) => keyOf(c.date) === date).reduce((a, c) => a + c.trackedMinutes, 0);
      const mainKeys = lines.filter((l) => l.key !== 'AT-110' && !isInternalKey(l.key)).map((l) => l.key);
      const plans: DayPlan[] = [];
      for (const date of WEEK) {
        const main: [string, number][] = [];
        const other: [string, number][] = [];
        let standup = 0;
        let review = 0;
        for (const l of lines) {
          const m = minutesOn(l.cells, date);
          if (m <= 0) continue;
          if (l.key === 'INT-1') standup += m;
          else if (l.key === 'AT-110') review += m;
          else if (isInternalKey(l.key)) other.push([l.key, m]);
          else main.push([l.key, m]);
        }
        const idleTs = idleRows.filter((r) => r.timesheetId === sheet.id && keyOf(r.date) === date).reduce((a, r) => a + r.idleMinutes, 0);
        if (!main.length && !other.length && !standup && !review && !idleTs) continue;
        plans.push({
          date, main, other, standup, review,
          idle: Math.max(0, idleTs - rejectedMin(date)),
          claims: claimsFor(date, main),
          gapAfterLunch: GAPS[p.key]?.[date],
        });
      }
      return { plans, shots: sheet.screenshotCount || null, submittedAt: sheet.submittedAt, mainKeys, hasReview: lines.some((l) => l.key === 'AT-110') };
    }
    // Fallback (no time seed): a plain five-day week on the employee's own tasks.
    const [A, B] = pick(p.employeeId, PREFERRED[p.key] ?? [], 2) as [string, string];
    const idle = [15, 20, 10, 25, 15];
    const split = [[240, 180], [300, 150], [200, 250], [330, 120], [180, 240]];
    const plans = WEEK.slice(0, 5).map((date, i) => {
      const main: [string, number][] = [[A, split[i]![0]!], [B, split[i]![1]!]];
      return { date, main, standup: 30, review: p.key === 'priya' ? 40 : 0, idle: Math.max(0, idle[i]! - rejectedMin(date)), claims: claimsFor(date, main), gapAfterLunch: GAPS[p.key]?.[date] } as DayPlan;
    });
    return { plans, shots: null, submittedAt: null, mainKeys: [A, B], hasReview: p.key === 'priya' };
  };

  /** Mon 28 Sep: fill the attendance sessions (worked = presence − idle) on the same tasks. */
  const mondayPlan = (p: Person, mainKeys: string[], hasReview: boolean): DayPlan => {
    const wins = windowsFor(p, MON28);
    const idle = attDays.find((a) => a.employeeId === p.employeeId)?.idleMinutes ?? 15;
    const closed = wins.every((w) => w.end);
    const capacity = closed ? Math.round(wins.reduce((a, w) => a + (w.end!.getTime() - w.start.getTime()), 0) / 60_000) : 480 + idle;
    const work = Math.max(120, capacity - idle);
    const standup = 30;
    const review = hasReview ? 30 : 0;
    const rest = work - standup - review;
    const [A, B] = mainKeys.length >= 2 ? mainKeys : pick(p.employeeId, PREFERRED[p.key] ?? [], 2);
    const a = Math.round(rest * (p.key === 'priya' ? 5 / 7 : 0.6));
    return { date: MON28, main: [[A!, a], [B!, rest - a]], standup, review, idle };
  };

  // ── build rows ─────────────────────────────────────────────────────────
  const segRows: (Prisma.ActivitySegmentCreateManyInput & { id: string })[] = [];
  const evRows: Prisma.TrackerEventCreateManyInput[] = [];
  const claimRows: Prisma.IdleClaimCreateManyInput[] = [];
  const integrity: Prisma.TrackerIntegrityEventCreateManyInput[] = [];
  type Shot = { employeeId: string; deviceId: string; hostname: string; at: Date; workDate: string; taskKey: string | null };
  const shots: Shot[] = [];

  for (const p of people) {
    const week = weekPlans(p);
    const days = [...week.plans, mondayPlan(p, week.mainKeys, week.hasReview)];
    const deviceId = p.device.id;
    const workByPeriod: { week: (Placed & { date: string })[]; mon: (Placed & { date: string })[] } = { week: [], mon: [] };
    const ev = (type: string, at: Date, date: string, skewSec: number, extra: Partial<Prisma.TrackerEventCreateManyInput> = {}) =>
      evRows.push({ tenantId, clientId: randomUUID(), deviceId, employeeId: p.employeeId, type, at, clientAt: new Date(at.getTime() + skewSec * 1000), workDate: dbDate(date), skewSec, receivedAt: addMin(at, 1), ...extra });

    for (const plan of days) {
      const date = plan.date;
      const wins = windowsFor(p, date);
      const skewSec = SKEW[p.key]?.[date] ?? 0;
      const { flow, afterLunch } = layout(plan);
      const { placed, gaps } = placeBlocks(flow, afterLunch, wins, plan.gapAfterLunch ?? 0);
      const segs = explode(placed);
      const createdCap = date <= WEEK[6]! && week.submittedAt ? addMin(week.submittedAt, -1) : null;

      ev('APP_START', addMin(wins[0]!.start, -2), date, skewSec);
      if (p.punchMode)
        for (const w of wins) {
          if (w.source !== 'DESKTOP') continue;
          ev('PUNCH_IN', w.start, date, skewSec);
          if (w.end) ev('PUNCH_OUT', w.end, date, skewSec);
        }
      let lastKey: string | null = null;
      for (const s of segs) {
        const task = s.key ? byKey.get(s.key) : undefined;
        const min = Math.round((s.end.getTime() - s.start.getTime()) / 60_000);
        const id = randomUUID();
        const kind = s.kind === 'CLAIM' ? 'IDLE_WORK' : s.kind;
        const created = addMin(s.end, 2);
        segRows.push({
          id, tenantId, clientId: randomUUID(), employeeId: p.employeeId, deviceId, workDate: dbDate(date), kind,
          taskId: s.kind === 'IDLE' ? null : (task?.id ?? null),
          projectId: s.kind === 'IDLE' ? null : (task?.projectId ?? null),
          startAt: s.start, endAt: s.end, durationSec: min * 60,
          idleResolution: s.kind === 'IDLE' ? 'DEDUCTED' : s.kind === 'CLAIM' ? 'CLAIMED_WORK' : null,
          idleCause: s.kind === 'WORK' ? null : 'NO_INPUT',
          note: s.note ?? null,
          keyboardEvents: s.kind === 'WORK' ? min * (38 + (min % 11)) : 0,
          mouseEvents: s.kind === 'WORK' ? min * (22 + (min % 7)) : 0,
          flags: skewSec ? ['SKEW_CORRECTED'] : [],
          createdAt: createdCap && created > createdCap ? createdCap : created,
        });
        if (s.kind === 'WORK') {
          if (s.key !== lastKey) ev('TASK_SWITCH', s.start, date, skewSec, { taskId: task?.id ?? null });
          lastKey = s.key ?? null;
          (date === MON28 ? workByPeriod.mon : workByPeriod.week).push({ ...s, date });
        } else {
          ev('IDLE_START', s.start, date, skewSec);
          ev('IDLE_RESOLVED', s.end, date, skewSec, { idleFrom: s.start, resolution: s.kind === 'CLAIM' ? 'WORKING' : 'IDLE', note: s.note ?? null, taskId: s.kind === 'CLAIM' ? (task?.id ?? null) : null });
        }
        if (s.kind === 'CLAIM') {
          const status = s.claimStatus ?? 'PENDING';
          const reviewer = pickClaimReviewer({ employeeId: p.employeeId, projectLeadId: task?.project?.leadEmployeeId, projectIsInternal: task?.project?.isInternal, managerId: p.managerId });
          const reviewerUser = reviewer ? (await prisma.employee.findUnique({ where: { id: reviewer }, select: { userId: true } }))?.userId ?? null : null;
          claimRows.push({
            tenantId, employeeId: p.employeeId, segmentId: id, workDate: dbDate(date), startAt: s.start, endAt: s.end, minutes: min,
            taskId: task?.id ?? null, projectId: task?.projectId ?? null, note: s.note ?? null, status, reviewerEmployeeId: reviewer,
            ...(status !== 'PENDING'
              ? { decidedAt: ist('2026-09-28', '11:20'), decidedByUserId: reviewerUser, comment: status === 'REJECTED' ? 'No activity in the design file during this window' : null }
              : {}),
            createdAt: addMin(s.end, 3),
          });
        }
      }
      const last = segs[segs.length - 1];
      if (p.punchMode && last && wins[wins.length - 1]!.source === 'DESKTOP' && !wins[wins.length - 1]!.end) ev('PUNCH_OUT', last.end, date, skewSec);

      for (const g of gaps) {
        ev('APP_QUIT', g.from, date, skewSec);
        const minutes = Math.round((g.to.getTime() - g.from.getTime()) / 60_000);
        integrity.push(
          { tenantId, employeeId: p.employeeId, deviceId, workDate: dbDate(date), type: 'APP_QUIT_WHILE_PUNCHED_IN', severity: 'INFO', occurredAt: g.from, details: { message: `Tracker closed while punched in at ${fmtHm(g.from)}` }, dedupeKey: `${tenantId}:seed:quit:${p.key}:${date}` },
          { tenantId, employeeId: p.employeeId, deviceId, workDate: dbDate(date), type: 'GAP', severity: 'WARN', occurredAt: g.from, details: { from: g.from.toISOString(), to: g.to.toISOString(), minutes, message: `No tracker data ${fmtHm(g.from)}–${fmtHm(g.to)} while punched in` }, dedupeKey: `${tenantId}:seed:gap:${p.key}:${date}` },
        );
      }
      if (skewSec) {
        const at = addMin(wins[0]!.start, 64);
        integrity.push({
          tenantId, employeeId: p.employeeId, deviceId, workDate: dbDate(date), type: 'CLOCK_SKEW', severity: 'INFO', occurredAt: at,
          details: { skewSeconds: skewSec, message: `Device clock ahead by ${Math.round(skewSec / 60)} min; times corrected` }, dedupeKey: `${tenantId}:seed:skew:${p.key}:${date}`,
          acknowledgedAt: ist(WEEK[3]!, '10:12'), acknowledgedByUserId: user.arjun ?? null, comment: 'Windows time sync was off after an update',
        });
      }
    }

    // Screenshots: the timesheet's count over the week's WORK time (~ every 10 min), natural cadence on Monday.
    const weekWorkMin = workByPeriod.week.reduce((a, s) => a + (s.end.getTime() - s.start.getTime()) / 60_000, 0);
    const monWorkMin = workByPeriod.mon.reduce((a, s) => a + (s.end.getTime() - s.start.getTime()) / 60_000, 0);
    const periods: [(Placed & { date: string })[], number][] = [
      [workByPeriod.week, week.shots ?? Math.floor(weekWorkMin / SHOT_INTERVAL_MIN)],
      [workByPeriod.mon, Math.floor(monWorkMin / SHOT_INTERVAL_MIN)],
    ];
    const r = rng(`${p.key}:shots`);
    for (const [segs, count] of periods)
      for (const s of spreadShots(segs, count, r))
        shots.push({ employeeId: p.employeeId, deviceId, hostname: p.device.hostname, at: s.at, workDate: s.seg.date, taskKey: s.seg.key ?? null });
  }

  await prisma.activitySegment.createMany({ data: segRows });
  for (let i = 0; i < evRows.length; i += 1000) await prisma.trackerEvent.createMany({ data: evRows.slice(i, i + 1000) });
  if (claimRows.length) await prisma.idleClaim.createMany({ data: claimRows });
  if (integrity.length) await prisma.trackerIntegrityEvent.createMany({ data: integrity });

  // ── screenshots (PNG placeholders with task key + time) ─────────────────
  const retentionDays =
    (await prisma.attendancePolicy.findFirst({ where: { tenantId, audience: 'REMOTE' }, select: { screenshotRetentionDays: true } }).catch(() => null))?.screenshotRetentionDays ?? 90;
  const accents: Record<string, string> = {};
  const palette = ['#c2410c', '#1d4ed8', '#047857', '#7c3aed', '#b45309', '#0e7490'];
  const fileRows: Prisma.FileObjectCreateManyInput[] = [];
  const shotRows: Prisma.ScreenshotCreateManyInput[] = [];
  const ownerUser = new Map(Object.values(devices).map((d) => [d.id, d.userId]));
  for (let i = 0; i < shots.length; i += 24) {
    const chunk = shots.slice(i, i + 24);
    await Promise.all(
      chunk.map(async (s) => {
        const t = s.taskKey ? byKey.get(s.taskKey) : undefined;
        const accent = (accents[s.taskKey ?? ''] ??= palette[Object.keys(accents).length % palette.length]!);
        const png = await placeholderPng([s.taskKey ?? 'No task', t?.title ?? (s.taskKey ? 'Task' : 'Unallocated'), `${fmtDay(s.at)} · ${fmtHm(s.at)} IST`, s.hostname], accent);
        const stamp = s.at.toISOString().replace(/[:.]/g, '-');
        const key = `${tenantId}/screenshot/${s.workDate.slice(0, 7)}/${randomUUID()}-shot-${stamp}.png`;
        const path = join(storageRoot, key);
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, png);
        const fileId = randomUUID().replace(/-/g, '');
        fileRows.push({
          id: fileId, tenantId, ownerUserId: ownerUser.get(s.deviceId) ?? null, storageKey: key, filename: `shot-${stamp}.png`, mime: 'image/png',
          size: png.length, sha256: createHash('sha256').update(png).digest('hex'), category: 'screenshot', isPrivate: true, createdAt: addMin(s.at, 1),
        });
        shotRows.push({
          tenantId, clientId: randomUUID(), employeeId: s.employeeId, deviceId: s.deviceId, capturedAt: s.at, workDate: dbDate(s.workDate),
          taskId: t?.id ?? null, projectId: t?.projectId ?? null, fileId, thumbFileId: fileId, blurred: false, inIdle: false, monitorCount: 1,
          purgeAfter: new Date(s.at.getTime() + retentionDays * 86400_000), createdAt: addMin(s.at, 1),
        });
      }),
    );
  }
  for (let i = 0; i < fileRows.length; i += 500) await prisma.fileObject.createMany({ data: fileRows.slice(i, i + 500) });
  for (let i = 0; i < shotRows.length; i += 500) await prisma.screenshot.createMany({ data: shotRows.slice(i, i + 500) });

  // ── day summaries (same projection as IngestService.projectDay) ─────────
  const claimBySeg = new Map(claimRows.map((c) => [c.segmentId, c.status]));
  const groups = new Map<string, (typeof segRows)[number][]>();
  for (const s of segRows) {
    const k = `${s.employeeId}|${keyOf(s.workDate as Date)}`;
    groups.set(k, [...(groups.get(k) ?? []), s]);
  }
  const shotCount = new Map<string, number>();
  for (const s of shots) shotCount.set(`${s.employeeId}|${s.workDate}`, (shotCount.get(`${s.employeeId}|${s.workDate}`) ?? 0) + 1);
  const flagCount = new Map<string, number>();
  for (const f of integrity) {
    const k = `${f.employeeId}|${keyOf(f.workDate as Date)}`;
    flagCount.set(k, (flagCount.get(k) ?? 0) + 1);
  }
  const summaries: Prisma.TrackerDaySummaryCreateManyInput[] = [];
  for (const [k, segs] of groups) {
    const [employeeId, date] = k.split('|') as [string, string];
    const withClaims = segs
      .map((s) => ({
        kind: s.kind as 'WORK',
        idleResolution: s.idleResolution ?? null,
        taskId: s.taskId ?? null,
        durationSec: s.durationSec,
        claimStatus: (claimBySeg.get(s.id) ?? (s.kind === 'IDLE_WORK' ? 'PENDING' : null)) as ClaimStatus | null,
        startAt: s.startAt as Date,
        endAt: s.endAt as Date,
      }))
      .sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
    const totals = summarizeSegments(withClaims);
    const perTask: TrackerPerTask[] = Object.entries(totals.perTaskSec)
      .filter(([, sec]) => sec > 0)
      .map(([taskId, seconds]) => {
        const t = byId.get(taskId);
        return { taskId: taskId || null, projectId: t?.projectId ?? null, key: t?.key ?? 'General', title: t?.title ?? 'Unallocated', seconds };
      })
      .sort((a, b) => b.seconds - a.seconds);
    const timeline = buildTimeline(withClaims, (id) => (id ? (byId.get(id)?.key ?? null) : null));
    summaries.push({
      tenantId, employeeId, workDate: dbDate(date), workedSec: totals.workedSec, breakSec: totals.breakSec, idleSec: totals.idleSec,
      idleDeductedSec: totals.idleDeductedSec, idlePendingSec: totals.idlePendingSec, claimApprovedSec: totals.claimApprovedSec,
      screenshotCount: shotCount.get(k) ?? 0, perTask: perTask as unknown as Prisma.InputJsonValue, timeline: timeline as unknown as Prisma.InputJsonValue,
      firstInAt: withClaims[0]?.startAt ?? null, lastOutAt: withClaims[withClaims.length - 1]?.endAt ?? null, integrityFlags: flagCount.get(k) ?? 0,
      confirmedAt: ist(date, '18:50') > (withClaims[withClaims.length - 1]?.endAt ?? new Date(0)) ? ist(date, '18:50') : addMin(withClaims[withClaims.length - 1]!.endAt, 5),
      lastProjectedAt: new Date(),
    });
  }
  await prisma.trackerDaySummary.createMany({ data: summaries });

  ctx.extra.tracker = {
    devices: Object.fromEntries(Object.entries(devices).map(([k, d]) => [k, d.id])),
    screenshots: shotRows.length,
    pendingClaims: claimRows.filter((c) => c.status === 'PENDING').length,
  };
}
