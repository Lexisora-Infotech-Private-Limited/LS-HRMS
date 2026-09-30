import type { Prisma, PrismaClient } from '@prisma/client';
import type { SeedCtx } from './core';
import { SOURCE_BITS } from '../../src/modules/time/lib/day-calc';
import { addDays, dateOf, daysBetween, dowOf, istInstant, parseHm } from '../../src/modules/time/lib/time-utils';

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
    where: { tenantId },
    select: { id: true, key: true, name: true, isInternal: true, billable: true, leadEmployeeId: true },
  });
  if (!allTasks.length || !projects.length) return;
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
    const own = allTasks.filter((t) => t.assigneeEmployeeId === E(k) && !projById.get(t.projectId)?.isInternal).map((t) => t.key);
    const any = allTasks.filter((t) => !projById.get(t.projectId)?.isInternal && !['AT-101', 'AT-103', 'AT-110'].includes(t.key)).map((t) => t.key);
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
}
