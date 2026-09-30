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
 * - Devices: PRIYA-LAPTOP (Windows 11 · v1.4.2, re-paired 29 Sep; the v1.3.8 pairing it replaced
 *   shows as "Unpaired"), Vikram, Arjun (2 active + 1 awaiting HR, one stale/outdated), Rahul and
 *   Sneha (office staff, monitor-only), Ananya (revoked by HR).
 * - Activity segments, events, screenshots (PNG placeholders showing task key + time) and day
 *   summaries for 21–25 Sep for Priya / Rahul / Vikram / Sneha matching the timesheet approvals
 *   rows (41h 30m / 39h 05m / 36h 40m / 40h 00m worked; 2h 00m / 0h 50m / 3h 10m / 0h 30m idle),
 *   Mon 28 Sep and today's partial day for Priya.
 * - Idle claims: two PENDING for Priya (reviewed by the AT project lead), one REJECTED for Vikram.
 * - Integrity flags: Vikram app quit + gap, Rahul clock skew.
 * Tasks are looked up by key (work seed); everything degrades to "General" if absent.
 */

type BlockKind = 'WORK' | 'BREAK' | 'IDLE' | 'CLAIM' | 'GAP';
type Block = { kind: BlockKind; min: number; key?: string | null; note?: string; claimStatus?: 'PENDING' | 'APPROVED' | 'REJECTED' };
type DayPlan = {
  date: string;
  start: string; // HH:MM IST
  standup?: number;
  main: [string, number][];
  review?: number;
  idle: number;
  brk: number;
  claims?: { min: number; key: string; note: string; status?: 'PENDING' | 'APPROVED' | 'REJECTED' }[];
  gapAfterLunch?: number;
};

const ist = (date: string, hhmm: string) => new Date(`${date}T${hhmm}:00+05:30`);
const dbDate = (key: string) => new Date(`${key}T00:00:00.000Z`);
const addMin = (d: Date, m: number) => new Date(d.getTime() + m * 60_000);
const agoMin = (m: number) => new Date(Date.now() - m * 60_000);
const fmtHm = (d: Date) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
const fmtDay = (d: Date) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', weekday: 'short', day: 'numeric', month: 'short' }).format(d);

/**
 * Standard day shape: main task → stand-up (INT-1) → main task → idle → other tasks → lunch →
 * (gap) → idle claims → main task → idle → other tasks → code review.
 */
export function layout(p: DayPlan): Block[] {
  const blocks: Block[] = [];
  const i1 = Math.ceil(p.idle / 2);
  const i2 = p.idle - i1;
  const firsts = p.main.map(([k, m]) => [k, Math.round(m * 0.55)] as [string, number]);
  const seconds = p.main.map(([k, m], i) => [k, m - firsts[i]![1]] as [string, number]);
  const lead = firsts[0] ? Math.min(25, firsts[0][1]) : 0;
  if (firsts[0]) blocks.push({ kind: 'WORK', key: firsts[0][0], min: lead });
  if (p.standup) blocks.push({ kind: 'WORK', key: 'INT-1', min: p.standup });
  if (firsts[0]) blocks.push({ kind: 'WORK', key: firsts[0][0], min: firsts[0][1] - lead });
  blocks.push({ kind: 'IDLE', min: i1 });
  for (const [k, m] of firsts.slice(1)) blocks.push({ kind: 'WORK', key: k, min: m });
  blocks.push({ kind: 'BREAK', min: p.brk });
  if (p.gapAfterLunch) blocks.push({ kind: 'GAP', min: p.gapAfterLunch });
  for (const c of p.claims ?? []) blocks.push({ kind: 'CLAIM', key: c.key, min: c.min, note: c.note, claimStatus: c.status ?? 'PENDING' });
  if (seconds[0]) blocks.push({ kind: 'WORK', key: seconds[0][0], min: seconds[0][1] });
  blocks.push({ kind: 'IDLE', min: i2 });
  for (const [k, m] of seconds.slice(1)) blocks.push({ kind: 'WORK', key: k, min: m });
  if (p.review) blocks.push({ kind: 'WORK', key: 'AT-110', min: p.review });
  return blocks.filter((b) => b.min > 0);
}

/** Splits long work blocks into ≤ 50-minute segments (the device closes a segment on every switch / sync). */
function explode(blocks: Block[]): Block[] {
  const out: Block[] = [];
  for (const b of blocks) {
    if (b.kind !== 'WORK' || b.min <= 50) {
      out.push(b);
      continue;
    }
    let left = b.min;
    while (left > 0) {
      const m = Math.min(50, left);
      out.push({ ...b, min: m });
      left -= m;
    }
  }
  return out;
}

async function placeholderPng(lines: string[], accent: string, blurred: boolean): Promise<Buffer> {
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
  let img = sharp(Buffer.from(svg));
  if (blurred) img = img.blur(6);
  return img.png({ compressionLevel: 9 }).toBuffer();
}

export async function seed_tracker(prisma: PrismaClient, ctx: SeedCtx): Promise<void> {
  const { tenantId, emp, user } = ctx;
  if (!emp.priya) return;
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
  /** Preferred keys that exist, else the employee's own open tasks, else standing internal tasks. */
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
  const devices: Record<string, Dev> = {
    priyaOld: dev({
      userId: user.priya!, employeeId: emp.priya, hostname: 'PRIYA-LAPTOP', os: 'Windows 11 Pro 23H2', appVersion: '1.3.8', status: 'REVOKED',
      pairedAt: ist('2024-01-15', '10:05'), lastSeenAt: ist('2026-09-29', '09:18'), lastSyncAt: ist('2026-09-28', '18:43'), approvalMethod: 'PORTAL_CODE', approvedByUserId: user.priya,
      revokedAt: ist('2026-09-29', '09:18'), revokedByUserId: user.priya, revokeReason: 'Signed out & unpaired on the device', createdAt: ist('2024-01-15', '10:02'),
    }),
    priya: dev({
      userId: user.priya!, employeeId: emp.priya, hostname: 'PRIYA-LAPTOP', os: 'Windows 11', appVersion: '1.4.2', status: 'ACTIVE',
      pairedAt: ist('2026-09-29', '09:24'), lastSeenAt: agoMin(2), lastSyncAt: agoMin(3), liveStatus: 'WORKING', approvalMethod: 'PORTAL_CODE', approvedByUserId: user.priya, displays: 2, createdAt: ist('2026-09-29', '09:21'),
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
      userId: user.arjun, employeeId: emp.arjun, hostname: 'ARJUN-SURFACE', os: 'Windows 11', appVersion: '1.4.2', status: 'PENDING', createdAt: ist('2026-09-29', '10:05'),
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
  if (devices.arjunNew) pr(devices.arjunNew, 'AWAITING_HR', ist('2026-09-29', '10:05'), { sessionExpiresAt: ist('2026-10-02', '10:05'), ip: '10.20.4.18' });
  await prisma.devicePairingRequest.createMany({ data: pairing });

  // ── plans (21–25 Sep week + Priya 28 & 29 Sep) ─────────────────────────
  type Person = { key: string; employeeId: string; device: Dev; managerId: string | null; remote: boolean; days: DayPlan[] };
  const people: Person[] = [];
  const mgr = async (id: string) => (await prisma.employee.findUnique({ where: { id }, select: { managerId: true } }))?.managerId ?? null;

  {
    const [A, B] = pick(emp.priya, ['AT-101', 'AT-103'], 2) as [string, string];
    people.push({
      key: 'priya', employeeId: emp.priya, device: devices.priyaOld!, managerId: await mgr(emp.priya), remote: true,
      days: [
        { date: '2026-09-21', start: '09:30', standup: 30, main: [[A, 240], [B, 180]], review: 50, idle: 20, brk: 60 },
        { date: '2026-09-22', start: '09:25', standup: 30, main: [[A, 330], [B, 120]], review: 30, idle: 15, brk: 45 },
        { date: '2026-09-23', start: '09:30', standup: 30, main: [[A, 180], [B, 270]], review: 40, idle: 30, brk: 60, claims: [{ min: 25, key: A, note: 'Client call with the Atlas billing team' }] },
        { date: '2026-09-24', start: '09:52', standup: 30, main: [[A, 360], [B, 90]], review: 30, idle: 10, brk: 50, claims: [{ min: 15, key: B, note: 'Whiteboard session on menu permissions' }] },
        { date: '2026-09-25', start: '09:35', standup: 30, main: [[A, 120], [B, 240]], review: 60, idle: 45, brk: 60 },
        { date: '2026-09-28', start: '09:28', standup: 30, main: [[A, 300], [B, 120]], review: 30, idle: 20, brk: 55 },
      ],
    });
  }
  if (emp.rahul && devices.rahul) {
    const [A, B] = pick(emp.rahul, ['AT-102', 'AT-105'], 2) as [string, string];
    const worked = [480, 470, 475, 460, 460];
    const idle = [10, 15, 5, 10, 10];
    people.push({
      key: 'rahul', employeeId: emp.rahul, device: devices.rahul, managerId: await mgr(emp.rahul), remote: false,
      days: ['2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25'].map((date, i) => {
        const main = worked[i]! - 60;
        return { date, start: ['09:38', '09:41', '09:35', '09:44', '09:40'][i]!, standup: 30, main: [[A, Math.round(main * 0.6)], [B, main - Math.round(main * 0.6)]], review: 30, idle: idle[i]!, brk: 45 };
      }),
    });
  }
  if (emp.sneha && devices.sneha) {
    const [A, B] = pick(emp.sneha, ['AT-105', 'AT-102'], 2) as [string, string];
    const idle = [5, 10, 0, 5, 10];
    people.push({
      key: 'sneha', employeeId: emp.sneha, device: devices.sneha, managerId: await mgr(emp.sneha), remote: false,
      days: ['2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25'].map((date, i) => ({
        date, start: ['09:48', '09:40', '09:45', '09:42', '09:39'][i]!, standup: 30, main: [[A, 225], [B, 225]], idle: idle[i]!, brk: 60,
      })),
    });
  }
  if (emp.vikram && devices.vikram) {
    const [A, B] = pick(emp.vikram, ['AT-106', 'AT-104'], 2) as [string, string];
    const worked = [450, 440, 460, 420, 430];
    const idle = [40, 15, 45, 30, 40]; // + 20 min rejected claim on Tue = 3h 10m deducted
    people.push({
      key: 'vikram', employeeId: emp.vikram, device: devices.vikram, managerId: await mgr(emp.vikram), remote: true,
      days: ['2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25'].map((date, i) => ({
        date, start: ['09:34', '09:40', '09:31', '09:45', '09:36'][i]!, standup: 30, main: [[A, Math.round((worked[i]! - 30) * 0.65)], [B, worked[i]! - 30 - Math.round((worked[i]! - 30) * 0.65)]],
        idle: idle[i]!, brk: 60,
        ...(i === 1 ? { claims: [{ min: 20, key: A, note: 'Design review on a call (no keyboard)', status: 'REJECTED' as const }] } : {}),
        ...(i === 3 ? { gapAfterLunch: 35 } : {}),
      })),
    });
  }

  // ── build rows ─────────────────────────────────────────────────────────
  const segRows: Prisma.ActivitySegmentCreateManyInput[] = [];
  const evRows: Prisma.TrackerEventCreateManyInput[] = [];
  const claimRows: Prisma.IdleClaimCreateManyInput[] = [];
  const integrity: Prisma.TrackerIntegrityEventCreateManyInput[] = [];
  type Shot = { employeeId: string; deviceId: string; hostname: string; at: Date; workDate: string; taskKey: string | null; inIdle: boolean };
  const shots: Shot[] = [];
  const reviewerFor = (p: Person, key: string | null) => {
    const t = key ? byKey.get(key) : undefined;
    return pickClaimReviewer({ employeeId: p.employeeId, projectLeadId: t?.project.leadEmployeeId, projectIsInternal: t?.project.isInternal, managerId: p.managerId });
  };
  const ev = (p: Person, deviceId: string, type: string, at: Date, date: string, extra: Partial<Prisma.TrackerEventCreateManyInput> = {}) =>
    evRows.push({ tenantId, clientId: randomUUID(), deviceId, employeeId: p.employeeId, type, at, clientAt: at, workDate: dbDate(date), receivedAt: addMin(at, 1), ...extra });

  const addDay = (p: Person, date: string, start: Date, blocks: Block[], deviceId: string, opts: { open?: boolean; skewSec?: number } = {}) => {
    let cursor = start;
    const gaps: Date[] = [];
    ev(p, deviceId, 'APP_START', addMin(start, -2), date);
    if (p.remote) ev(p, deviceId, 'PUNCH_IN', start, date);
    let lastKey: string | null = null;
    let shotClock = Math.ceil(start.getTime() / 600_000) * 600_000 + 60_000 * ((p.key.length * 3) % 7); // per-person offset
    for (const b of blocks) {
      const s = cursor;
      const e = addMin(s, b.min);
      cursor = e;
      if (b.kind === 'GAP') {
        gaps.push(s);
        shotClock = Math.max(shotClock, e.getTime() + 60_000);
        continue;
      }
      const task = b.key ? byKey.get(b.key) : undefined;
      const id = randomUUID();
      const kind = b.kind === 'CLAIM' ? 'IDLE_WORK' : b.kind;
      segRows.push({
        id, tenantId, clientId: randomUUID(), employeeId: p.employeeId, deviceId, workDate: dbDate(date), kind,
        taskId: b.kind === 'WORK' || b.kind === 'CLAIM' ? (task?.id ?? null) : null,
        projectId: b.kind === 'WORK' || b.kind === 'CLAIM' ? (task?.projectId ?? null) : null,
        startAt: s, endAt: e, durationSec: b.min * 60,
        idleResolution: b.kind === 'IDLE' ? 'DEDUCTED' : b.kind === 'CLAIM' ? 'CLAIMED_WORK' : null,
        idleCause: b.kind === 'IDLE' || b.kind === 'CLAIM' ? 'NO_INPUT' : null,
        note: b.note ?? null,
        keyboardEvents: b.kind === 'WORK' ? b.min * (38 + (b.min % 11)) : 0,
        mouseEvents: b.kind === 'WORK' ? b.min * (22 + (b.min % 7)) : 0,
        flags: opts.skewSec ? ['SKEW_CORRECTED'] : [],
        createdAt: addMin(e, 2),
      });
      if (b.kind === 'WORK' && b.key !== lastKey) {
        ev(p, deviceId, 'TASK_SWITCH', s, date, { taskId: task?.id ?? null });
        lastKey = b.key ?? null;
      }
      if (b.kind === 'BREAK') {
        ev(p, deviceId, 'BREAK_START', s, date);
        ev(p, deviceId, 'BREAK_END', e, date);
      }
      if (b.kind === 'IDLE' || b.kind === 'CLAIM') {
        ev(p, deviceId, 'IDLE_START', s, date);
        ev(p, deviceId, 'IDLE_RESOLVED', addMin(e, 0), date, { idleFrom: s, resolution: b.kind === 'CLAIM' ? 'WORKING' : 'IDLE', note: b.note ?? null, taskId: task?.id ?? null });
      }
      if (b.kind === 'CLAIM') {
        const status = b.claimStatus ?? 'PENDING';
        const reviewer = reviewerFor(p, b.key ?? null);
        claimRows.push({
          tenantId, employeeId: p.employeeId, segmentId: id, workDate: dbDate(date), startAt: s, endAt: e, minutes: b.min,
          taskId: task?.id ?? null, projectId: task?.projectId ?? null, note: b.note ?? null, status, reviewerEmployeeId: reviewer,
          ...(status !== 'PENDING'
            ? { decidedAt: ist('2026-09-28', '11:20'), decidedByUserId: reviewer === emp.arjun ? user.arjun : null, comment: status === 'REJECTED' ? 'No activity in the design file during this window' : null }
            : {}),
          createdAt: addMin(e, 3),
        });
      }
      // screenshots every 10 min while punched in (not during breaks)
      if (b.kind !== 'BREAK') {
        while (shotClock < e.getTime()) {
          if (shotClock >= s.getTime()) shots.push({ employeeId: p.employeeId, deviceId, hostname: p.device.hostname, at: new Date(shotClock), workDate: date, taskKey: b.kind === 'WORK' || b.kind === 'CLAIM' ? (b.key ?? null) : lastKey, inIdle: b.kind !== 'WORK' });
          shotClock += 600_000;
        }
      } else shotClock = Math.max(shotClock, e.getTime() + 60_000);
    }
    if (!opts.open && p.remote) ev(p, deviceId, 'PUNCH_OUT', cursor, date);
    return { end: cursor, gaps };
  };

  for (const p of people) {
    for (const d of p.days) {
      const start = ist(d.date, d.start);
      const { gaps } = addDay(p, d.date, start, explode(layout(d)), p.device.id, { skewSec: p.key === 'rahul' && d.date === '2026-09-23' ? 420 : 0 });
      if (p.key === 'vikram' && gaps[0]) {
        const quitAt = gaps[0];
        ev(p, p.device.id, 'APP_QUIT', quitAt, d.date);
        integrity.push(
          { tenantId, employeeId: p.employeeId, deviceId: p.device.id, workDate: dbDate(d.date), type: 'APP_QUIT_WHILE_PUNCHED_IN', severity: 'INFO', occurredAt: quitAt, details: { message: `Tracker closed while punched in at ${fmtHm(quitAt)}` }, dedupeKey: `${tenantId}:seed:quit:${p.key}:${d.date}` },
          { tenantId, employeeId: p.employeeId, deviceId: p.device.id, workDate: dbDate(d.date), type: 'GAP', severity: 'WARN', occurredAt: quitAt, details: { from: quitAt.toISOString(), to: addMin(quitAt, d.gapAfterLunch ?? 0).toISOString(), minutes: d.gapAfterLunch ?? 0, message: `No tracker data ${fmtHm(quitAt)}–${fmtHm(addMin(quitAt, d.gapAfterLunch ?? 0))} while punched in` }, dedupeKey: `${tenantId}:seed:gap:${p.key}:${d.date}` },
        );
      }
      if (p.key === 'rahul' && d.date === '2026-09-23') {
        integrity.push({ tenantId, employeeId: p.employeeId, deviceId: p.device.id, workDate: dbDate(d.date), type: 'CLOCK_SKEW', severity: 'INFO', occurredAt: addMin(start, 64), details: { skewSeconds: 420, message: 'Device clock ahead by 7 min; times corrected' }, dedupeKey: `${tenantId}:seed:skew:${p.key}:${d.date}`, acknowledgedAt: ist('2026-09-24', '10:12'), acknowledgedByUserId: user.arjun ?? null, comment: 'Windows time sync was off after an update' });
      }
    }
  }

  // Priya today (Tue 29 Sep): paired PRIYA-LAPTOP v1.4.2 at 09:24, punched in 09:32 from the desktop, still working.
  const priya = people[0]!;
  {
    const [A, B] = pick(emp.priya, ['AT-101', 'AT-103'], 2) as [string, string];
    const todayBlocks: Block[] = [
      { kind: 'WORK', key: A, min: 28 },
      { kind: 'WORK', key: 'INT-1', min: 30 },
      { kind: 'WORK', key: A, min: 45 },
      { kind: 'WORK', key: A, min: 25 },
      { kind: 'IDLE', min: 10 },
      { kind: 'WORK', key: B, min: 40 },
      { kind: 'WORK', key: B, min: 25 },
    ];
    addDay({ ...priya, device: devices.priya! }, '2026-09-29', ist('2026-09-29', '09:32'), todayBlocks, devices.priya!.id, { open: true });
  }

  await prisma.activitySegment.createMany({ data: segRows });
  await prisma.trackerEvent.createMany({ data: evRows });
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
        const png = await placeholderPng(
          [s.taskKey ?? 'No task', t?.title ?? (s.taskKey ? 'Task' : 'Unallocated'), `${fmtDay(s.at)} · ${fmtHm(s.at)} IST`, `${s.hostname}${s.inIdle ? ' · idle' : ''}`],
          accent,
          false,
        );
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
          taskId: t?.id ?? null, projectId: t?.projectId ?? null, fileId, thumbFileId: fileId, blurred: false, inIdle: s.inIdle, monitorCount: 1,
          purgeAfter: new Date(s.at.getTime() + retentionDays * 86400_000), createdAt: addMin(s.at, 1),
        });
      }),
    );
  }
  for (let i = 0; i < fileRows.length; i += 500) await prisma.fileObject.createMany({ data: fileRows.slice(i, i + 500) });
  for (let i = 0; i < shotRows.length; i += 500) await prisma.screenshot.createMany({ data: shotRows.slice(i, i + 500) });

  // ── day summaries (same projection as IngestService.projectDay) ─────────
  const claimBySeg = new Map(claimRows.map((c) => [c.segmentId, c.status]));
  const groups = new Map<string, Prisma.ActivitySegmentCreateManyInput[]>();
  for (const s of segRows) {
    const k = `${s.employeeId}|${(s.workDate as Date).toISOString().slice(0, 10)}`;
    groups.set(k, [...(groups.get(k) ?? []), s]);
  }
  const shotCount = new Map<string, number>();
  for (const s of shots) shotCount.set(`${s.employeeId}|${s.workDate}`, (shotCount.get(`${s.employeeId}|${s.workDate}`) ?? 0) + 1);
  const flagCount = new Map<string, number>();
  for (const f of integrity) {
    const k = `${f.employeeId}|${(f.workDate as Date).toISOString().slice(0, 10)}`;
    flagCount.set(k, (flagCount.get(k) ?? 0) + 1);
  }
  const summaries: Prisma.TrackerDaySummaryCreateManyInput[] = [];
  for (const [k, segs] of groups) {
    const [employeeId, date] = k.split('|') as [string, string];
    const withClaims = segs
      .map((s) => ({ kind: s.kind as 'WORK', idleResolution: s.idleResolution ?? null, taskId: s.taskId ?? null, durationSec: s.durationSec, claimStatus: (claimBySeg.get(s.id!) ?? null) as 'PENDING' | null, startAt: s.startAt as Date, endAt: s.endAt as Date }))
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
      confirmedAt: date < '2026-09-29' ? ist(date, '18:50') : null, lastProjectedAt: new Date(),
    });
  }
  await prisma.trackerDaySummary.createMany({ data: summaries });

  ctx.extra.tracker = {
    devices: Object.fromEntries(Object.entries(devices).map(([k, d]) => [k, d.id])),
    screenshots: shotRows.length,
    pendingClaims: claimRows.filter((c) => c.status === 'PENDING').length,
  };
}
