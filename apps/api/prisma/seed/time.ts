import type { Prisma, PrismaClient } from '@prisma/client';
import sharp from 'sharp';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import type { SeedCtx } from './core';
import { SOURCE_BITS } from '../../src/modules/time/lib/day-calc';
import { addDays, dateOf, daysBetween, dowOf, istInstant, keyOf, parseHm } from '../../src/modules/time/lib/time-utils';

/**
 * Demo data for the time domain (matches the wireframe sample rows):
 * policies (GEN settings matrix), shifts, locations, holidays 2026, shift/location assignment,
 * September 2026 attendance (punches + sessions + days; Priya: 18 present, 1 late) and the
 * week 21–27 Sep timesheets awaiting approval (Priya & Rahul → PL, Vikram & Sneha → RM).
 * "Today" = Tue 29 Sep 2026.
 */
const TODAY = '2026-09-29';
type Src = 'BIOMETRIC' | 'WEB' | 'DESKTOP';

function rng(seedStr: string) {
  let h = 2166136261;
  for (let i = 0; i < seedStr.length; i++) h = Math.imul(h ^ seedStr.charCodeAt(i), 16777619);
  return (min: number, max: number) => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return min + ((h >>> 0) % (max - min + 1));
  };
}

export async function seed_time(prisma: PrismaClient, ctx: SeedCtx): Promise<void> {
  const tenantId = ctx.tenantId;
  const E = (k: string) => ctx.emp[k];

  // Idempotent: clear this tenant's time data first (safe on a fresh db:reset too).
  const w = { where: { tenantId } };
  await prisma.timesheetEvent.deleteMany(w);
  await prisma.outsideHoursEntry.deleteMany(w);
  await prisma.timesheetAdjustment.deleteMany(w);
  await prisma.timesheet.deleteMany(w); // cascades lines/cells/steps/idle days
  await prisma.workSession.deleteMany(w);
  await prisma.attendancePunch.deleteMany(w);
  await prisma.attendanceDay.deleteMany(w);
  await prisma.shiftAssignment.deleteMany(w);
  await prisma.holiday.deleteMany(w);

  // ── Attendance policy (GEN settings matrix) ────────────────────────────────
  const common = { autoIdleEnabled: true, autoIdleMinutes: 5, screenshotsEnabled: true, screenshotIntervalMinutes: 10, blurScreenshots: false, deductIdleFromPayroll: true, updatedByName: 'Kavya Iyer' };
  await prisma.attendancePolicy.upsert({
    where: { tenantId_audience: { tenantId, audience: 'OFFICE' } },
    create: { tenantId, audience: 'OFFICE', biometricMandatory: true, allowWebPunch: false, allowDesktopPunch: false, ...common },
    update: { biometricMandatory: true, allowWebPunch: false, allowDesktopPunch: false, ...common },
  });
  await prisma.attendancePolicy.upsert({
    where: { tenantId_audience: { tenantId, audience: 'REMOTE' } },
    create: { tenantId, audience: 'REMOTE', biometricMandatory: false, allowWebPunch: true, allowDesktopPunch: true, ...common },
    update: { biometricMandatory: false, allowWebPunch: true, allowDesktopPunch: true, ...common },
  });

  // ── Shifts ─────────────────────────────────────────────────────────────────
  const shiftDefs = [
    { name: 'General', start: '09:30', end: '18:30', grace: 15, brk: 60, off: [6, 0], isDefault: true },
    { name: 'Early', start: '07:00', end: '16:00', grace: 10, brk: 60, off: [0], isDefault: false },
    { name: 'US overlap', start: '13:00', end: '22:00', grace: 15, brk: 45, off: [6, 0], isDefault: false },
  ];
  const shifts: Record<string, { id: string; startMinute: number; endMinute: number; graceMinutes: number; breakMinutes: number; weeklyOffDays: number[] }> = {};
  for (const s of shiftDefs) {
    const data = { startMinute: parseHm(s.start), endMinute: parseHm(s.end), graceMinutes: s.grace, breakMinutes: s.brk, weeklyOffDays: s.off, isDefault: s.isDefault, minFullDayMinutes: 450, minHalfDayMinutes: 240, archivedAt: null };
    shifts[s.name] = await prisma.shift.upsert({ where: { tenantId_name: { tenantId, name: s.name } }, create: { tenantId, name: s.name, ...data }, update: data });
  }

  // ── Work locations ─────────────────────────────────────────────────────────
  const locDefs = [
    { name: 'Ahmedabad HQ', code: 'AMD', address: '4th Floor, Titanium City Centre, Satellite, Ahmedabad 380015', lat: 23.0128, lng: 72.5258, geoRadiusM: 150, punchMode: 'BIOMETRIC_ONLY', isRemote: false, isSystem: false },
    { name: 'Pune studio', code: 'PNQ', address: 'Baner Road, Baner, Pune 411045', lat: 18.559, lng: 73.7868, geoRadiusM: 100, punchMode: 'BIOMETRIC_ONLY', isRemote: false, isSystem: false },
    { name: 'Remote', code: 'REM', address: null, lat: null, lng: null, geoRadiusM: null, punchMode: 'WEB_DESKTOP_ALLOWED', isRemote: true, isSystem: true },
  ];
  const loc: Record<string, string> = {};
  for (const l of locDefs) {
    const { name, ...data } = l;
    loc[name] = (await prisma.workLocation.upsert({ where: { tenantId_name: { tenantId, name } }, create: { tenantId, name, ...data }, update: { ...data, archivedAt: null } })).id;
  }

  // ── Holidays 2026 (company calendar: national + Gujarat; Ganesh Chaturthi for Pune) ──
  const hol: { date: string; name: string; type: 'MANDATORY' | 'OPTIONAL'; calendar: string; locs?: string[] }[] = [
    { date: '2026-01-14', name: 'Makar Sankranti / Uttarayan', type: 'MANDATORY', calendar: 'Gujarat', locs: [loc['Ahmedabad HQ']!] },
    { date: '2026-01-26', name: 'Republic Day', type: 'MANDATORY', calendar: 'National' },
    { date: '2026-03-04', name: 'Holi', type: 'MANDATORY', calendar: 'National' },
    { date: '2026-03-21', name: 'Id-ul-Fitr', type: 'OPTIONAL', calendar: 'National' },
    { date: '2026-04-03', name: 'Good Friday', type: 'OPTIONAL', calendar: 'National' },
    { date: '2026-05-01', name: 'Maharashtra / Gujarat Day', type: 'MANDATORY', calendar: 'Gujarat' },
    { date: '2026-08-15', name: 'Independence Day', type: 'MANDATORY', calendar: 'National' },
    { date: '2026-08-28', name: 'Raksha Bandhan', type: 'OPTIONAL', calendar: 'Gujarat' },
    { date: '2026-09-04', name: 'Janmashtami', type: 'MANDATORY', calendar: 'Gujarat' },
    { date: '2026-09-14', name: 'Ganesh Chaturthi', type: 'MANDATORY', calendar: 'Maharashtra', locs: [loc['Pune studio']!] },
    { date: '2026-10-02', name: 'Gandhi Jayanti', type: 'MANDATORY', calendar: 'National' },
    { date: '2026-10-20', name: 'Dussehra', type: 'MANDATORY', calendar: 'National' },
    { date: '2026-11-08', name: 'Diwali', type: 'MANDATORY', calendar: 'National' },
    { date: '2026-11-09', name: 'Diwali', type: 'MANDATORY', calendar: 'National' },
    { date: '2026-11-10', name: 'Gujarati New Year', type: 'MANDATORY', calendar: 'Gujarat' },
    { date: '2026-11-11', name: 'Bhai Dooj', type: 'OPTIONAL', calendar: 'Gujarat' },
    { date: '2026-12-25', name: 'Christmas', type: 'MANDATORY', calendar: 'National' },
  ];
  await prisma.holiday.createMany({ data: hol.map((h) => ({ tenantId, date: dateOf(h.date), name: h.name, type: h.type, calendar: h.calendar, locationIds: h.locs ?? [] })) });
  const holidayOn = (date: string, locationId: string | null) => hol.find((h) => h.date === date && h.type === 'MANDATORY' && (!h.locs || (locationId && h.locs.includes(locationId))));

  // ── Employees: shift + location assignment ──────────────────────────────────
  const emps = await prisma.employee.findMany({
    where: { tenantId },
    select: { id: true, fullName: true, workMode: true, status: true, joiningDate: true, branchId: true, managerId: true },
  });
  const key = new Map(Object.entries(ctx.emp).map(([k, id]) => [id, k]));
  const puneBranch = ctx.branch?.Pune;
  const shiftFor = (k: string | undefined) => (k === 'karan' || k === 'ananya' ? 'Early' : k === 'divya' || k === 'meera' ? 'US overlap' : 'General');
  const locFor = (e: (typeof emps)[number]) => (e.workMode !== 'OFFICE' ? loc.Remote! : e.branchId && e.branchId === puneBranch ? loc['Pune studio']! : loc['Ahmedabad HQ']!);
  const empShift = new Map<string, (typeof shifts)[string]>();
  const empLoc = new Map<string, string>();
  for (const e of emps) {
    const sName = shiftFor(key.get(e.id));
    const s = shifts[sName]!;
    const l = locFor(e);
    empShift.set(e.id, s);
    empLoc.set(e.id, l);
    await prisma.employee.update({ where: { id: e.id }, data: { shiftId: s.id, workLocationId: l } });
    const from = e.joiningDate && e.joiningDate > dateOf('2026-01-01') ? e.joiningDate : dateOf('2026-01-01');
    await prisma.shiftAssignment.create({ data: { tenantId, employeeId: e.id, shiftId: s.id, effectiveFrom: from, assignedByName: 'Kavya Iyer' } });
  }

  // ── September 2026 attendance ──────────────────────────────────────────────
  const days: Prisma.AttendanceDayCreateManyInput[] = [];
  const punches: Prisma.AttendancePunchCreateManyInput[] = [];
  const sessions: { employeeId: string; date: string; start: Date; end: Date | null; source: Src; inId: string; outId: string | null }[] = [];
  let pid = 0;
  const punchId = () => `seedpunch${String(++pid).padStart(6, '0')}${tenantId.slice(-6)}`;

  /** Priya: exact wireframe rows (attRows) + a steady rest of month → 18 present, 1 late, 142h active, 3h 40m idle. */
  const PRIYA: Record<string, { in: string; out: string; src: Src; brk: number; idle: number } | 'CL'> = {
    '2026-09-28': { in: '09:28', out: '18:42', src: 'DESKTOP', brk: 55, idle: 20 },
    '2026-09-25': { in: '09:35', out: '18:30', src: 'DESKTOP', brk: 60, idle: 45 },
    '2026-09-24': { in: '09:52', out: '18:40', src: 'WEB', brk: 50, idle: 10 },
    '2026-09-23': { in: '09:30', out: '18:35', src: 'DESKTOP', brk: 60, idle: 30 },
    '2026-09-18': 'CL',
  };
  // Remaining 14 working days share 142h − 30h32m = 6688 min worked and 115 min idle.
  const priyaRest = { worked: 142 * 60 - (479 + 430 + 468 + 455), idle: 220 - 105 };

  const monthDays = daysBetween('2026-09-01', TODAY);
  const active = emps.filter((e) => e.status !== 'ONBOARDING' && e.status !== 'EXITED');
  for (const e of active) {
    const k = key.get(e.id);
    const s = empShift.get(e.id)!;
    const locationId = empLoc.get(e.id)!;
    const r = rng(`${e.id}:att`);
    const joined = e.joiningDate ? e.joiningDate.toISOString().slice(0, 10) : '2020-01-01';
    const mode = e.workMode === 'OFFICE' ? 'OFFICE' : 'REMOTE';
    const priyaDays = k === 'priya' ? monthDays.filter((d) => d < TODAY && !s.weeklyOffDays.includes(dowOf(d)) && !holidayOn(d, locationId) && !PRIYA[d]) : [];
    let pw = priyaRest.worked;
    let pi = priyaRest.idle;

    for (const d of monthDays) {
      if (d < joined) continue;
      const base = { tenantId, employeeId: e.id, date: dateOf(d), shiftId: s.id, locationId, effectiveMode: mode as 'OFFICE' | 'REMOTE', expectedStart: istInstant(d, s.startMinute), expectedEnd: istInstant(d, s.endMinute) };
      if (s.weeklyOffDays.includes(dowOf(d))) {
        if (d < TODAY) days.push({ ...base, status: 'WEEKLY_OFF' });
        continue;
      }
      const h = holidayOn(d, locationId);
      if (h) {
        days.push({ ...base, status: 'HOLIDAY', holidayName: h.name });
        continue;
      }
      const fixed = k === 'priya' ? PRIYA[d] : undefined;
      if (fixed === 'CL') {
        days.push({ ...base, status: 'LEAVE', leaveFraction: 1, leaveTypeCode: 'CL' });
        continue;
      }
      // Source by work mode: office → biometric; remote → desktop (occasional web); hybrid → biometric on Wednesdays.
      let src: Src = e.workMode === 'OFFICE' ? 'BIOMETRIC' : e.workMode === 'HYBRID' && dowOf(d) === 3 ? 'BIOMETRIC' : r(1, 10) === 1 ? 'WEB' : 'DESKTOP';
      let inMin: number;
      let outMin: number;
      let brk: number;
      let idle: number;
      if (fixed) {
        inMin = parseHm(fixed.in);
        outMin = parseHm(fixed.out);
        brk = fixed.brk;
        idle = fixed.idle;
        src = fixed.src;
      } else if (k === 'priya') {
        if (d === TODAY) continue; // Priya has not punched in yet today (wireframe)
        const left = priyaDays.filter((x) => x >= d).length;
        idle = left === 1 ? pi : Math.min(pi, r(4, 12));
        const worked = left === 1 ? pw : Math.round(pw / left) + r(-8, 8);
        pw -= worked;
        pi -= idle;
        brk = r(50, 60);
        inMin = s.startMinute + r(-12, 8);
        outMin = inMin + worked + brk + idle;
        src = r(1, 7) === 1 ? 'WEB' : 'DESKTOP';
      } else {
        if (d === TODAY && k === 'karan') continue; // not yet in today
        const late = r(1, 14) === 1;
        inMin = s.startMinute + (late ? r(s.graceMinutes + 1, s.graceMinutes + 25) : r(-15, Math.min(8, s.graceMinutes)));
        outMin = s.endMinute + r(-5, 30);
        brk = r(40, s.breakMinutes);
        idle = e.workMode === 'OFFICE' ? r(0, 15) : r(5, 40);
        // Keep the wireframe approval figures plausible (Vikram's week is idle-heavy).
        if (k === 'vikram' && d >= '2026-09-21' && d <= '2026-09-25') idle = [40, 35, 45, 30, 40][dowOf(d) - 1]!;
      }

      const lateBy = Math.max(0, inMin - s.startMinute);
      const isLate = inMin > s.startMinute + s.graceMinutes;
      const inAt = istInstant(d, inMin);
      const isToday = d === TODAY;
      const lunchAt = inMin + 210 + r(0, 30);
      const lunchEnd = lunchAt + brk;
      const rec = (dir: 'IN' | 'OUT', minute: number) => {
        const id = punchId();
        punches.push({ id, tenantId, employeeId: e.id, attendanceDate: dateOf(d), punchedAt: istInstant(d, minute), direction: dir, source: src, status: 'ACCEPTED', locationId, geoStatus: 'NOT_REQUIRED', createdByName: e.fullName });
        return id;
      };
      if (isToday) {
        const i1 = rec('IN', inMin);
        sessions.push({ employeeId: e.id, date: d, start: inAt, end: null, source: src, inId: i1, outId: null });
        days.push({ ...base, status: 'PENDING', firstInAt: inAt, primarySource: src, sourcesMask: SOURCE_BITS[src], isLate, lateByMinutes: isLate ? lateBy : 0 });
        continue;
      }
      const i1 = rec('IN', inMin);
      const o1 = rec('OUT', lunchAt);
      const i2 = rec('IN', lunchEnd);
      const o2 = rec('OUT', outMin);
      sessions.push({ employeeId: e.id, date: d, start: inAt, end: istInstant(d, lunchAt), source: src, inId: i1, outId: o1 });
      sessions.push({ employeeId: e.id, date: d, start: istInstant(d, lunchEnd), end: istInstant(d, outMin), source: src, inId: i2, outId: o2 });
      const presence = outMin - inMin;
      const worked = presence - brk - idle;
      days.push({
        ...base,
        status: 'PRESENT',
        firstInAt: inAt,
        lastOutAt: istInstant(d, outMin),
        primarySource: src,
        sourcesMask: SOURCE_BITS[src],
        workedMinutes: worked,
        breakMinutes: brk,
        idleMinutes: idle,
        presenceMinutes: presence - brk,
        isLate,
        lateByMinutes: isLate ? lateBy : 0,
        presentFraction: 1,
        idleDeductibleMinutes: 0,
      });
    }
  }
  for (let i = 0; i < punches.length; i += 500) await prisma.attendancePunch.createMany({ data: punches.slice(i, i + 500) });
  for (let i = 0; i < days.length; i += 500) await prisma.attendanceDay.createMany({ data: days.slice(i, i + 500) });
  const sessRows = sessions.map((x) => ({ tenantId, employeeId: x.employeeId, attendanceDate: dateOf(x.date), inPunchId: x.inId, outPunchId: x.outId, startedAt: x.start, endedAt: x.end, source: x.source }));
  for (let i = 0; i < sessRows.length; i += 500) await prisma.workSession.createMany({ data: sessRows.slice(i, i + 500) });

  // ── Timesheets · week 21–27 Sep (wireframe approvals) ───────────────────────
  const WS = '2026-09-21';
  const WE = '2026-09-27';
  const week = daysBetween(WS, WE);
  // Work seeds before time (ARCHITECTURE §10); read its tables (spine models) directly.
  const allTasks = await prisma.task.findMany({
    where: { tenantId },
    select: { id: true, key: true, title: true, projectId: true, moduleName: true, assigneeEmployeeId: true },
  });
  const projects = await prisma.project.findMany({
    where: { tenantId, status: { in: ['PLANNING', 'ACTIVE', 'ON_HOLD'] } }, // archived/completed work is not on this week's sheets
    select: { id: true, key: true, name: true, isInternal: true, billable: true, leadEmployeeId: true },
  });
  if (!allTasks.length || !projects.length) {
    await seed_time_compliance(prisma, ctx); // no work data: still seed the attendance-side screens
    return;
  }
  const projById = new Map(projects.map((x) => [x.id, x]));
  const taskByKey = new Map(allTasks.map((t) => [t.key, t]));
  const nameOf = new Map(emps.map((e) => [e.id, e.fullName]));

  type Plan = { emp: string; lines: { taskKey?: string; label?: string; minutes: number[] }[]; idle: number[]; shots: number; stage: 'PL' | 'RM'; submitted: string; outside?: { taskKey: string; date: string; from: string; to: string; text: string; reason: string } };
  const hm = (s: string) => (s === '–' ? 0 : parseHm(s));
  const spread = (total: number, weights: number[]) => {
    const sum = weights.reduce((a, b) => a + b, 0);
    const out = weights.map((wt) => Math.round((total * wt) / sum / 5) * 5);
    out[out.length - 1]! += total - out.reduce((a, b) => a + b, 0);
    return [...out, 0, 0];
  };
  const tasksOf = (k: string, n: number, fallback: string[]) => {
    const live = (t: (typeof allTasks)[number]) => projById.has(t.projectId) && !projById.get(t.projectId)!.isInternal;
    const own = allTasks.filter((t) => t.assigneeEmployeeId === E(k) && live(t)).map((t) => t.key);
    const any = allTasks.filter((t) => live(t) && !['AT-101', 'AT-103', 'AT-110'].includes(t.key)).map((t) => t.key);
    return [...new Set([...own, ...fallback, ...any])].filter((x) => taskByKey.has(x)).slice(0, n);
  };
  const INT = [30, 30, 30, 30, 30, 0, 0];
  const plans: Plan[] = [
    {
      emp: 'priya',
      stage: 'PL',
      shots: 248,
      submitted: '2026-09-25T18:40',
      idle: [20, 45, 10, 30, 15, 0, 0],
      lines: [
        { taskKey: 'AT-101', minutes: ['4:00', '5:30', '3:00', '6:00', '2:00', '–', '–'].map(hm) },
        { taskKey: 'AT-103', minutes: ['3:00', '2:00', '4:30', '1:30', '4:00', '–', '–'].map(hm) },
        { taskKey: 'AT-110', label: 'Code review', minutes: ['0:50', '0:30', '0:40', '0:30', '1:00', '–', '–'].map(hm) },
        { taskKey: 'INT-1', minutes: INT },
      ],
    },
  ];
  const rahulTasks = tasksOf('rahul', 2, ['AT-102', 'AT-104', 'AT-105']);
  if (rahulTasks.length) {
    const t = 39 * 60 + 5 - 150 - 90;
    plans.push({
      emp: 'rahul', stage: 'PL', shots: 234, submitted: '2026-09-25T19:05', idle: [10, 15, 5, 10, 10, 0, 0],
      lines: [
        { taskKey: rahulTasks[0], minutes: spread(Math.round(t * (rahulTasks.length > 1 ? 0.6 : 1)), [5, 6, 5, 6, 4]) },
        ...(rahulTasks[1] ? [{ taskKey: rahulTasks[1], minutes: spread(t - Math.round(t * 0.6), [3, 2, 3, 2, 4]) }] : []),
        { taskKey: 'INT-1', minutes: INT },
      ],
      outside: { taskKey: rahulTasks[0]!, date: '2026-09-26', from: '11:00', to: '12:30', text: 'Production hotfix: invoice rounding', reason: 'Nimbus reported wrong GST totals on Saturday; patched and deployed.' },
    });
  }
  const vikramTasks = tasksOf('vikram', 2, ['KS-201', 'AT-106', 'AT-107']);
  if (vikramTasks.length) {
    const t = 36 * 60 + 40 - 150;
    plans.push({
      emp: 'vikram', stage: 'RM', shots: 220, submitted: '2026-09-25T18:55', idle: [40, 35, 45, 30, 40, 0, 0],
      lines: [
        { taskKey: vikramTasks[0], minutes: spread(Math.round(t * (vikramTasks.length > 1 ? 0.55 : 1)), [4, 5, 4, 5, 4]) },
        ...(vikramTasks[1] ? [{ taskKey: vikramTasks[1], minutes: spread(t - Math.round(t * 0.55), [4, 3, 4, 3, 4]) }] : []),
        { taskKey: 'INT-1', minutes: INT },
      ],
    });
  }
  const snehaTasks = tasksOf('sneha', 2, ['AT-108', 'AT-109', 'KS-202']);
  if (snehaTasks.length) {
    const t = 40 * 60 - 150;
    plans.push({
      emp: 'sneha', stage: 'RM', shots: 240, submitted: '2026-09-25T18:30', idle: [5, 10, 5, 5, 5, 0, 0],
      lines: [
        { taskKey: snehaTasks[0], minutes: spread(Math.round(t * (snehaTasks.length > 1 ? 0.65 : 1)), [5, 5, 5, 5, 5]) },
        ...(snehaTasks[1] ? [{ taskKey: snehaTasks[1], minutes: spread(t - Math.round(t * 0.65), [2, 3, 2, 3, 2]) }] : []),
        { taskKey: 'INT-1', minutes: INT },
      ],
    });
  }

  const ist = (s: string) => {
    const [d, t] = s.split('T') as [string, string];
    return istInstant(d, parseHm(t));
  };
  for (const plan of plans) {
    const employeeId = E(plan.emp);
    if (!employeeId) continue;
    const emp = emps.find((x) => x.id === employeeId);
    if (!emp) continue;
    const empName = emp.fullName;
    const submittedAt = ist(plan.submitted);
    const lines = plan.lines.filter((l) => l.taskKey && taskByKey.has(l.taskKey));
    const ohMin = plan.outside ? parseHm(plan.outside.to) - parseHm(plan.outside.from) : 0;
    const tracked = lines.reduce((s, l) => s + l.minutes.reduce((a, b) => a + b, 0), 0);
    const idleTotal = plan.idle.reduce((a, b) => a + b, 0);
    const status = plan.stage === 'PL' ? 'SUBMITTED' : 'PENDING_RM';
    const ts = await prisma.timesheet.create({
      data: {
        tenantId, employeeId, weekStart: dateOf(WS), weekEnd: dateOf(WE), status, submittedAt, cycle: 1, version: 3,
        totalMinutes: tracked + ohMin, trackedMinutes: tracked, outsideHoursMinutes: ohMin, idleMinutes: idleTotal, screenshotCount: plan.shots,
      },
    });
    let sort = 0;
    const lineIdByTask = new Map<string, string>();
    const l1Projects = new Map<string, string>(); // projectId → lead
    for (const l of lines) {
      const task = taskByKey.get(l.taskKey!)!;
      const project = projById.get(task.projectId);
      const line = await prisma.timesheetLine.create({
        data: {
          tenantId, timesheetId: ts.id, taskId: task.id, projectId: task.projectId,
          label: l.label ?? (project?.isInternal ? task.title : `${task.key} ${task.title}`),
          subLabel: project ? (project.isInternal ? 'Internal' : `${project.name}${task.moduleName ? ` · ${task.moduleName}` : ''}`) : null,
          billable: !!project && project.billable && !project.isInternal, sortOrder: ++sort,
        },
      });
      lineIdByTask.set(task.key, line.id);
      const oh = plan.outside && plan.outside.taskKey === task.key ? plan.outside : null;
      const cells = week
        .map((d, i) => {
          const m = l.minutes[i] ?? 0;
          const o = oh && oh.date === d ? ohMin : 0;
          return { tenantId, lineId: line.id, date: dateOf(d), trackedMinutes: m, outsideHoursMinutes: o, finalMinutes: m + o };
        })
        .filter((c) => c.finalMinutes > 0);
      if (cells.length) await prisma.timesheetCell.createMany({ data: cells });
      // L1 routing (audit G3): internal projects and self-lead are skipped.
      if (project && !project.isInternal && project.leadEmployeeId && project.leadEmployeeId !== employeeId) l1Projects.set(project.id, project.leadEmployeeId);
    }
    const idleRows = week.map((d, i) => ({ tenantId, timesheetId: ts.id, date: dateOf(d), idleMinutes: plan.idle[i] ?? 0 })).filter((x) => x.idleMinutes > 0);
    if (idleRows.length) await prisma.timesheetIdleDay.createMany({ data: idleRows });
    if (plan.outside) {
      const o = plan.outside;
      const task = taskByKey.get(o.taskKey)!;
      await prisma.outsideHoursEntry.create({
        data: { tenantId, employeeId, timesheetId: ts.id, lineId: lineIdByTask.get(o.taskKey) ?? null, projectId: task.projectId, taskId: task.id, taskText: o.text, date: dateOf(o.date), startAt: istInstant(o.date, parseHm(o.from)), endAt: istInstant(o.date, parseHm(o.to)), minutes: ohMin, reason: o.reason, reviewStatus: 'PENDING_PL' },
      });
    }
    const due = istInstant('2026-09-29', 18 * 60);
    await prisma.timesheetEvent.create({ data: { tenantId, timesheetId: ts.id, type: 'submitted', actorName: empName, at: submittedAt } });
    for (const [projectId, lead] of l1Projects) {
      const approved = plan.stage === 'RM';
      await prisma.timesheetApprovalStep.create({
        data: {
          tenantId, timesheetId: ts.id, cycle: 1, level: 1, projectId, approverEmployeeId: lead, dueAt: due,
          status: approved ? 'APPROVED' : 'PENDING',
          actedByName: approved ? (nameOf.get(lead) ?? null) : null,
          actedAt: approved ? istInstant('2026-09-28', 11 * 60 + 20) : null,
          comment: approved ? 'Hours match the board and screenshots.' : null,
        },
      });
      if (approved) await prisma.timesheetEvent.create({ data: { tenantId, timesheetId: ts.id, type: 'approved', actorName: nameOf.get(lead) ?? null, level: 1, comment: 'Hours match the board and screenshots.', at: istInstant('2026-09-28', 11 * 60 + 20) } });
    }
    if (plan.stage === 'RM' && emp.managerId) {
      await prisma.timesheetApprovalStep.create({ data: { tenantId, timesheetId: ts.id, cycle: 1, level: 2, projectId: null, approverEmployeeId: emp.managerId, dueAt: istInstant('2026-09-30', 18 * 60), status: 'PENDING' } });
    }
  }

  // ── ID card checks, corrections, period locks, biometric devices (phase 2 screens) ──
  await seed_time_compliance(prisma, ctx);
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 2: ID card compliance (wireframe GEN idcompliance), attendance corrections, period locks
// and biometric devices. Reads the attendance rows seeded above from the database so it can be
// re-run on its own (idempotent: clears its own rows for the tenant first).
// ─────────────────────────────────────────────────────────────────────────────

const ist = (key: string, hm: string) => istInstant(key, parseHm(hm));
const localStamp = (at: Date) => new Date(at.getTime() + 330 * 60_000).toISOString().slice(0, 19).replace('T', ' ');
const hmOf = (at: Date) => new Date(at.getTime() + 330 * 60_000).toISOString().slice(11, 16);

/** Smallest miss count that makes round(yes/total) hit the target percentage. */
function missesFor(total: number, targetPct: number, atLeast: number): number {
  for (let m = atLeast; m <= total; m++) if (Math.round(((total - m) / total) * 100) === targetPct) return m;
  return Math.max(atLeast, Math.round((total * (100 - targetPct)) / 100));
}

async function savePng(prisma: PrismaClient, tenantId: string, name: string, svg: string, createdAt: Date, ownerUserId: string | null): Promise<string> {
  const buf = await sharp(Buffer.from(svg)).png().toBuffer();
  const storageRoot = resolve(process.env.STORAGE_DIR || './storage');
  const key = `${tenantId}/idcheck/${randomUUID()}-${name}`;
  const path = join(storageRoot, key);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, buf);
  const row = await prisma.fileObject.create({
    data: { tenantId, ownerUserId, storageKey: key, filename: name, mime: 'image/png', size: buf.length, sha256: createHash('sha256').update(buf).digest('hex'), category: 'idcheck', isPrivate: true, createdAt },
  });
  return row.id;
}

function checkPhotoSvg(name: string, caption: string, wearing: boolean): string {
  const badge = wearing
    ? '<line x1="161" y1="122" x2="161" y2="150" stroke="#8a6d3b" stroke-width="2"/><rect x="146" y="150" width="30" height="40" rx="3" fill="#f6f1e7" stroke="#8a6d3b" stroke-width="2"/><rect x="151" y="158" width="20" height="12" fill="#c8b48a"/>'
    : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="240" viewBox="0 0 320 240">
  <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e8e3da"/><stop offset="1" stop-color="#bdb6aa"/></linearGradient></defs>
  <rect width="320" height="240" fill="url(#g)"/>
  <circle cx="160" cy="86" r="34" fill="#6f665a"/>
  <path d="M86 240 Q92 128 160 124 Q228 128 234 240 Z" fill="#4c463e"/>
  ${badge}
  <rect x="0" y="206" width="320" height="34" fill="#000" fill-opacity="0.55"/>
  <text x="12" y="228" font-family="Helvetica, Arial, sans-serif" font-size="13" fill="#fff">${name} · ${caption}</text>
</svg>`;
}

export async function seed_time_compliance(prisma: PrismaClient, ctx: SeedCtx): Promise<void> {
  const tenantId = ctx.tenantId;
  const E = (k: string) => ctx.emp[k];
  const w = { where: { tenantId } };
  await prisma.idCardCheck.deleteMany(w);
  await prisma.attendanceRegularization.deleteMany(w);
  await prisma.periodLock.deleteMany(w);
  await prisma.biometricRawLog.deleteMany(w);
  await prisma.biometricEnrollment.deleteMany(w);
  await prisma.biometricDevice.deleteMany(w);
  await prisma.notification.deleteMany({ where: { tenantId, type: { in: ['idcheck.missing', 'regularization.requested', 'regularization.decided'] } } });

  const emps = await prisma.employee.findMany({ where: { tenantId }, select: { id: true, fullName: true, empCode: true, workMode: true, status: true, joiningDate: true, managerId: true, userId: true, workLocationId: true } });
  const byId = new Map(emps.map((e) => [e.id, e]));
  const locs = await prisma.workLocation.findMany({ where: { tenantId }, select: { id: true, name: true } });
  const locId = (name: string) => locs.find((l) => l.name === name)?.id ?? null;
  const AMD = locId('Ahmedabad HQ');
  const PNQ = locId('Pune studio');

  // ── Hybrid Vikram is at the Pune studio today (wireframe ID check 10:02) → biometric punch ──
  const vik = E('vikram');
  if (vik) {
    const day = await prisma.attendanceDay.findFirst({ where: { tenantId, employeeId: vik, date: dateOf(TODAY) } });
    if (day?.firstInAt) {
      await prisma.attendanceDay.update({ where: { id: day.id }, data: { effectiveMode: 'OFFICE', primarySource: 'BIOMETRIC', sourcesMask: SOURCE_BITS.BIOMETRIC, locationId: PNQ ?? day.locationId } });
      await prisma.attendancePunch.updateMany({ where: { tenantId, employeeId: vik, attendanceDate: dateOf(TODAY) }, data: { source: 'BIOMETRIC', locationId: PNQ } });
      await prisma.workSession.updateMany({ where: { tenantId, employeeId: vik, attendanceDate: dateOf(TODAY) }, data: { source: 'BIOMETRIC' } });
    }
  }

  // ── Biometric devices (ZKTeco ADMS), enrolment and raw logs ─────────────────
  const h = createHash('sha1').update(tenantId).digest('hex').slice(0, 6).toUpperCase();
  const amd = await prisma.biometricDevice.create({
    data: { tenantId, serialNumber: `CQZ7${h}01`, name: 'Ahmedabad HQ · Main entrance', locationId: AMD, model: 'SpeedFace-V5L', firmware: 'ZAM180-NF-Ver6.4.1', directionMode: 'FIRST_LAST', lastSeenAt: ist(TODAY, '19:12'), attLogStamp: '9999', createdAt: ist('2026-01-05', '11:00') },
  });
  const pnq = await prisma.biometricDevice.create({
    data: { tenantId, serialNumber: `CQZ7${h}02`, name: 'Pune studio · Reception', locationId: PNQ, model: 'MB160', firmware: 'Ver 6.60 Apr 28 2022', directionMode: 'DEVICE_STATUS', lastSeenAt: ist(TODAY, '19:40'), attLogStamp: '9999', createdAt: ist('2026-03-02', '11:00') },
  });
  const deviceFor = (employeeId: string, locationId: string | null) => (locationId === PNQ || employeeId === vik ? pnq : amd);
  // Every biometric punch came from one of the two devices.
  if (PNQ) await prisma.attendancePunch.updateMany({ where: { tenantId, source: 'BIOMETRIC', locationId: PNQ }, data: { biometricDeviceId: pnq.id } });
  if (vik) await prisma.attendancePunch.updateMany({ where: { tenantId, source: 'BIOMETRIC', employeeId: vik }, data: { biometricDeviceId: pnq.id } });
  await prisma.attendancePunch.updateMany({ where: { tenantId, source: 'BIOMETRIC', biometricDeviceId: null }, data: { biometricDeviceId: amd.id } });

  // PIN = numeric part of the employee code (interns 9xxx). Remote staff and new joiners are not enrolled.
  const pinOf = (code: string) => (code.includes('-I-') ? `9${code.split('-').pop()}` : String(Number(code.replace(/\D/g, ''))));
  const enrol = emps.filter((e) => e.workMode !== 'REMOTE' && e.status !== 'ONBOARDING' && e.status !== 'EXITED');
  await prisma.biometricEnrollment.createMany({ data: enrol.map((e) => ({ tenantId, employeeId: e.id, pin: pinOf(e.empCode), createdAt: ist('2026-01-05', '12:00') })) });
  const pinByEmp = new Map(enrol.map((e) => [e.id, pinOf(e.empCode)]));

  const bioPunches = await prisma.attendancePunch.findMany({
    where: { tenantId, source: 'BIOMETRIC', attendanceDate: { in: [dateOf('2026-09-28'), dateOf(TODAY)] } },
    orderBy: { punchedAt: 'asc' },
    select: { id: true, employeeId: true, punchedAt: true, direction: true, locationId: true },
  });
  const raw: Prisma.BiometricRawLogCreateManyInput[] = [];
  for (const p of bioPunches) {
    const pin = pinByEmp.get(p.employeeId);
    if (!pin) continue;
    const dev = deviceFor(p.employeeId, p.locationId);
    const local = localStamp(p.punchedAt);
    const status = p.direction === 'IN' ? 0 : 1;
    raw.push({ tenantId, deviceId: dev.id, pin, punchedAtLocal: local, punchedAt: p.punchedAt, statusCode: status, verifyCode: 15, workCode: '0', raw: `${pin}\t${local}\t${status}\t15\t0`, receivedAt: new Date(p.punchedAt.getTime() + 20_000), processed: true, punchId: p.id, employeeId: p.employeeId });
  }
  // A PIN the device knows but HR has not mapped yet (Meera's orientation visit) → stays for review.
  const unknownLocal = `${TODAY} 09:58:12`;
  raw.push({ tenantId, deviceId: amd.id, pin: '160', punchedAtLocal: unknownLocal, punchedAt: ist(TODAY, '09:58'), statusCode: 0, verifyCode: 15, workCode: '0', raw: `160\t${unknownLocal}\t0\t15\t0`, receivedAt: ist(TODAY, '09:58'), processed: false, error: 'UNKNOWN_PIN' });
  await prisma.biometricRawLog.createMany({ data: raw });

  // ── Period locks: payroll locked July and August ───────────────────────────
  await prisma.periodLock.createMany({
    data: [
      { tenantId, month: '2026-07', lockedUpTo: dateOf('2026-07-31'), lockedByName: 'Kavya Iyer', lockedAt: ist('2026-08-01', '10:30') },
      { tenantId, month: '2026-08', lockedUpTo: dateOf('2026-08-31'), lockedByName: 'Kavya Iyer', lockedAt: ist('2026-09-01', '10:30') },
    ],
  });

  // ── Attendance corrections (regularizations) ───────────────────────────────
  const candidates = ['rahul', 'sneha', 'ananya', 'isha', 'karan', 'neha', 'kavya'].map(E).filter((x): x is string => !!x);
  const lateDays = await prisma.attendanceDay.findMany({
    where: { tenantId, date: { gte: dateOf('2026-09-01'), lt: dateOf(TODAY) }, isLate: true, employeeId: { in: candidates } },
    orderBy: [{ date: 'desc' }],
    select: { id: true, employeeId: true, date: true },
  });
  const seen = new Set<string>();
  const picks = lateDays.filter((d) => (seen.has(d.employeeId) ? false : (seen.add(d.employeeId), true))).slice(0, 3);
  const nameOf = (id: string | null | undefined) => (id ? (byId.get(id)?.fullName ?? null) : null);
  const regs: Prisma.AttendanceRegularizationCreateManyInput[] = [];
  const excuses = [
    'Metro was suspended between Thaltej and Gurukul this morning; I reached at the time shown and informed my manager on chat.',
    'Took my father for a blood test at 8 am; the lab opened late. Informed my manager on the team chat.',
    'Heavy rain and waterlogging near Shivranjani; traffic was diverted for 40 minutes.',
  ];
  picks.forEach((d, i) => {
    const e = byId.get(d.employeeId);
    if (!e) return;
    const key = keyOf(d.date);
    const approved = i === 2;
    regs.push({
      tenantId, employeeId: e.id, date: d.date, type: 'LATE_EXCUSE', reason: excuses[i]!, approverEmployeeId: e.managerId,
      status: approved ? 'APPROVED' : 'PENDING', decidedByName: approved ? nameOf(e.managerId) : null, decidedAt: approved ? ist(addDays(key, 1), '12:10') : null,
      decisionComment: approved ? 'Okay, noted. Please leave a little earlier on rainy days.' : null, createdAt: ist(addDays(key, 1), '10:15'),
    });
  });
  // Isha: the sensor did not read her finger at the first attempt on Mon 28 Sep → wrong first-in time.
  const ishaId = E('isha');
  const ishaDay = ishaId ? await prisma.attendanceDay.findFirst({ where: { tenantId, employeeId: ishaId, date: dateOf('2026-09-28'), status: 'PRESENT' } }) : null;
  if (ishaDay?.firstInAt) {
    const isha = byId.get(ishaDay.employeeId)!;
    regs.push({
      tenantId, employeeId: isha.id, date: ishaDay.date, type: 'WRONG_TIME', requestedIn: new Date(ishaDay.firstInAt.getTime() - 20 * 60_000), requestedOut: ishaDay.lastOutAt,
      reason: "The fingerprint sensor didn't read my finger at the first attempt; I was at my desk 20 minutes earlier (Arjun saw me at stand-up).",
      approverEmployeeId: isha.managerId, status: 'PENDING', createdAt: ist('2026-09-28', '19:05'),
    });
  }
  // Rahul: claimed a missed out punch on Fri 25 Sep (rejected: the device has his out punch).
  const rahulId = E('rahul');
  const rahulDay = rahulId ? await prisma.attendanceDay.findFirst({ where: { tenantId, employeeId: rahulId, date: dateOf('2026-09-25'), status: 'PRESENT' } }) : null;
  if (rahulDay?.lastOutAt) {
    const rahul = byId.get(rahulDay.employeeId)!;
    regs.push({
      tenantId, employeeId: rahul.id, date: rahulDay.date, type: 'MISSED_PUNCH', requestedIn: rahulDay.firstInAt, requestedOut: ist('2026-09-25', '20:40'),
      reason: 'Stayed back for the Nimbus Retail release call and left at 20:40; forgot to punch out at the gate.',
      approverEmployeeId: rahul.managerId, status: 'REJECTED', decidedByName: nameOf(rahul.managerId), decidedAt: ist('2026-09-26', '11:00'),
      decisionComment: `The device shows your out punch at ${hmOf(rahulDay.lastOutAt)}; log the call as an outside-hours task in your timesheet instead.`,
      createdAt: ist('2026-09-26', '09:40'),
    });
  }
  if (regs.length) await prisma.attendanceRegularization.createMany({ data: regs });
  const approvedLate = picks[2];
  if (approvedLate) await prisma.attendanceDay.update({ where: { id: approvedLate.id }, data: { lateExcused: true } });

  // ── ID card checks: Aug + Sep history and today's wireframe rows ────────────
  type Chk = { employeeId: string; date: string; checkedAt: Date; wearing: boolean; loggedByName: string; loggedByUserId: string | null; photoFileId?: string | null; locationId: string | null };
  const kavya = E('kavya');
  const loggedBy = (employeeId: string, i: number) => (i % 7 === 3 && employeeId !== kavya ? { loggedByName: 'Kavya Iyer', loggedByUserId: ctx.user.kavya ?? null } : { loggedByName: 'Security desk', loggedByUserId: null });

  // Today (Tue 29 Sep): Rahul 09:41 ✓ photo · Sneha 09:48 ✓ · Vikram 10:02 ✗ photo · Ananya 10:05 ✓ (Kavya Iyer)
  const todayPlan: { k: string; at: string; wearing: boolean; photo: boolean; byKavya: boolean }[] = [
    { k: 'rahul', at: '09:41', wearing: true, photo: true, byKavya: false },
    { k: 'sneha', at: '09:48', wearing: true, photo: false, byKavya: false },
    { k: 'vikram', at: '10:02', wearing: false, photo: true, byKavya: false },
    { k: 'ananya', at: '10:05', wearing: true, photo: false, byKavya: true },
  ];
  const todayRows: Chk[] = [];
  for (const t of todayPlan) {
    const id = E(t.k);
    const e = id ? byId.get(id) : undefined;
    if (!e) continue;
    const day = await prisma.attendanceDay.findFirst({ where: { tenantId, employeeId: e.id, date: dateOf(TODAY) }, select: { firstInAt: true } });
    let at = ist(TODAY, t.at);
    if (day?.firstInAt && day.firstInAt > at) at = new Date(day.firstInAt.getTime() + 2 * 60_000);
    const by = t.byKavya ? { loggedByName: 'Kavya Iyer', loggedByUserId: ctx.user.kavya ?? null } : { loggedByName: 'Security desk', loggedByUserId: null };
    const photoFileId = t.photo ? await savePng(prisma, tenantId, `idcheck-${t.k}-${TODAY}.png`, checkPhotoSvg(e.fullName, `${hmOf(at)} · Security desk`, t.wearing), at, null) : null;
    todayRows.push({ employeeId: e.id, date: TODAY, checkedAt: at, wearing: t.wearing, photoFileId, locationId: e.workLocationId, ...by });
  }

  const sepDays = await prisma.attendanceDay.findMany({
    where: { tenantId, date: { gte: dateOf('2026-09-01'), lt: dateOf(TODAY) }, effectiveMode: 'OFFICE', firstInAt: { not: null } },
    orderBy: [{ date: 'asc' }, { employeeId: 'asc' }],
    select: { employeeId: true, date: true, firstInAt: true, locationId: true },
  });
  const r = rng(`${tenantId}:idcheck`);
  const sepHist: Chk[] = sepDays.map((d, i) => ({ employeeId: d.employeeId, date: keyOf(d.date), checkedAt: new Date(d.firstInAt!.getTime() + r(3, 35) * 60_000), wearing: true, locationId: d.locationId, ...loggedBy(d.employeeId, i) }));
  const todayMissing = todayRows.filter((x) => !x.wearing).length;
  const sepMiss = sepHist.length ? missesFor(sepHist.length + todayRows.length, 96, todayMissing) - todayMissing : 0;
  for (let k = 0; k < sepMiss; k++) sepHist[Math.floor(((k + 0.5) * sepHist.length) / sepMiss)]!.wearing = false;

  // August: office staff on weekdays (no attendance rows are seeded for August, so use the shift start).
  const augStaff = emps.filter((e) => e.workMode === 'OFFICE' && (e.status === 'ACTIVE' || e.status === 'NOTICE_PERIOD') && (!e.joiningDate || e.joiningDate < dateOf('2026-08-01')));
  const augHist: Chk[] = [];
  let ai = 0;
  for (const d of daysBetween('2026-08-03', '2026-08-31')) {
    const dow = dowOf(d);
    if (dow === 0 || dow === 6) continue;
    for (const e of augStaff) augHist.push({ employeeId: e.id, date: d, checkedAt: ist(d, `09:${String(r(32, 59)).padStart(2, '0')}`), wearing: true, locationId: e.workLocationId, ...loggedBy(e.id, ai++) });
  }
  const augMiss = augHist.length ? missesFor(augHist.length, 94, 0) : 0;
  for (let k = 0; k < augMiss; k++) augHist[Math.floor(((k + 0.5) * augHist.length) / augMiss)]!.wearing = false;

  const allChecks = [...augHist, ...sepHist, ...todayRows];
  for (let i = 0; i < allChecks.length; i += 500) {
    await prisma.idCardCheck.createMany({
      data: allChecks.slice(i, i + 500).map((c) => ({
        tenantId, employeeId: c.employeeId, date: dateOf(c.date), checkedAt: c.checkedAt, wearing: c.wearing, photoFileId: c.photoFileId ?? null,
        method: c.loggedByName === 'Security desk' ? 'BADGE_SCAN' : 'MANUAL_PICK', loggedByName: c.loggedByName, loggedByUserId: c.loggedByUserId, locationId: c.locationId, createdAt: c.checkedAt,
      })),
    });
  }

  // "Missing · Reminder sent": Vikram got the in-app nudge at 10:02.
  const vikRow = todayRows.find((x) => !x.wearing);
  const vikUser = vikRow ? byId.get(vikRow.employeeId)?.userId : null;
  if (vikRow && vikUser) {
    await prisma.notification.create({
      data: { tenantId, userId: vikUser, type: 'idcheck.missing', title: `Please wear your ID card (logged ${hmOf(vikRow.checkedAt)} by Security desk)`, link: '/attendance', fromLabel: 'Security desk', createdAt: vikRow.checkedAt },
    });
  }
  // Pending corrections reach the approvers' inbox.
  for (const g of regs.filter((x) => x.status === 'PENDING')) {
    const approverUser = g.approverEmployeeId ? byId.get(g.approverEmployeeId)?.userId : null;
    if (!approverUser) continue;
    const who = byId.get(g.employeeId)?.fullName ?? 'An employee';
    const label = new Date(g.date as Date).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
    await prisma.notification.create({
      data: { tenantId, userId: approverUser, type: 'regularization.requested', title: `${who} requested an attendance correction for ${label}`, body: g.reason, link: '/approvals?tab=corrections', fromLabel: who, createdAt: g.createdAt as Date },
    });
  }
}
