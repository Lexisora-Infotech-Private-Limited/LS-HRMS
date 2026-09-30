import type { Prisma, PrismaClient } from '@prisma/client';
import type { SeedCtx } from './core';
import { PrismaService } from '../../src/core/prisma/prisma.service';
import { CryptoService } from '../../src/core/crypto/crypto.service';
import { runAsTenant } from '../../src/core/context/request-context';
import { makeCalendar, WorkCalendarService, DEFAULT_WEEKLY_OFFS, type HolidayRow } from '../../src/modules/leavepay/common/calendar.service';
import { dd, dk, eachDay, monthBounds, type DateKey } from '../../src/modules/leavepay/common/dates';
import { expandLeaveDays, prorateYearly } from '../../src/modules/leavepay/leave/leave-calc';
import { LeaveLedgerService } from '../../src/modules/leavepay/leave/leave-ledger.service';
import { SalaryService } from '../../src/modules/leavepay/payroll/salary.service';
import { PayrollEngineService } from '../../src/modules/leavepay/payroll/payroll-engine.service';
import { buildStructure } from '../../src/modules/leavepay/payroll/salary';

/**
 * Demo data for the leavepay domain (wireframe sample rows):
 *  - leave types CL 12 / SL 8 / EL 18 (carry fwd up to 30, encashable) / Comp-off (60 days) + hidden LWP
 *  - credit rules (EL 1.5/month) with their 2026 batches, ledger + balances
 *    (Priya: EL 11/18, CL 6/12, SL 4/8, Comp-off 1/1)
 *  - Priya's history (EL 14–16 Oct pending RM, SL 4 Sep, CL 14 Aug, CL 2 Jul ½ rejected, older rows)
 *  - 3 pending team requests for Neha; Sep leave for Rahul (1 EL) and Vikram (2 CL)
 *  - salary structures for everyone (Priya CTC ₹10,29,600 / gross ₹84,000) + payroll profiles
 *  - finalized Jun/Jul/Aug 2026 runs computed by the real payroll engine with published payslips,
 *    and a calculated (not finalized) Sep 2026 run.
 */

const TODAY = '2026-09-29';
const YEAR = 2026;

type LT = { id: string; code: string; name: string; sandwichWeeklyOffs: boolean; sandwichHolidays: boolean };

export async function seed_leavepay(prisma: PrismaClient, ctx: SeedCtx): Promise<void> {
  const { tenantId, emp } = ctx;
  const has = (k: string) => !!emp[k];

  // ── Leave types ─────────────────────────────────────────────────────
  const typeDefs = [
    { code: 'EL', name: 'Earned leave', shortLabel: 'EL', displayOrder: 1, annualQuota: 18, accrualFrequency: 'MONTHLY', carryForwardMax: 30, encashable: true, appliesTo: ['FULL_TIME'], minNoticeDays: 7, noticeEnforcement: 'WARN', sandwichWeeklyOffs: true, color: '#1d6b57' },
    { code: 'CL', name: 'Casual leave', shortLabel: 'CL', displayOrder: 2, annualQuota: 12, accrualFrequency: 'YEARLY', carryForwardMax: null, appliesTo: ['FULL_TIME'], maxConsecutiveDays: 3, color: '#b7791f' },
    { code: 'SL', name: 'Sick leave', shortLabel: 'SL', displayOrder: 3, annualQuota: 8, accrualFrequency: 'YEARLY', carryForwardMax: null, appliesTo: ['FULL_TIME', 'INTERN'], documentRequiredAfterDays: 3, backdateLimitDays: 7, color: '#9b2c2c' },
    { code: 'CO', name: 'Comp-off', shortLabel: 'CO', displayOrder: 4, annualQuota: 0, accrualFrequency: 'ON_APPROVAL', isCompOff: true, expiryDays: 60, appliesTo: ['FULL_TIME'], color: '#2b6cb0' },
    { code: 'LWP', name: 'Leave without pay', shortLabel: 'LWP', displayOrder: 9, annualQuota: 0, accrualFrequency: 'NONE', isPaid: false, hidden: true, appliesTo: ['FULL_TIME', 'INTERN', 'CONTRACT'], color: '#555555' },
  ];
  const types: Record<string, LT> = {};
  for (const t of typeDefs) {
    const row = await prisma.leaveType.create({ data: { tenantId, ...t } as any });
    types[t.code] = row;
  }

  // ── Credit rules + 2026 batches ─────────────────────────────────────
  const rules = [
    { code: 'EL', employmentType: 'FULL_TIME', frequency: 'MONTHLY', daysPerPeriod: 1.5, lastPeriodKey: '2026-09' },
    { code: 'CL', employmentType: 'FULL_TIME', frequency: 'YEARLY', daysPerPeriod: 12, lastPeriodKey: '2026' },
    { code: 'SL', employmentType: 'FULL_TIME', frequency: 'YEARLY', daysPerPeriod: 8, lastPeriodKey: '2026' },
    { code: 'SL', employmentType: 'INTERN', frequency: 'YEARLY', daysPerPeriod: 8, lastPeriodKey: '2026' },
  ];
  const ruleIds: Record<string, string> = {};
  for (const r of rules) {
    const row = await prisma.leaveCreditRule.create({
      data: { tenantId, leaveTypeId: types[r.code]!.id, employmentType: r.employmentType, frequency: r.frequency as any, daysPerPeriod: r.daysPerPeriod, creditDay: 1, prorateOnJoin: true, effectiveFrom: dd('2026-01-01'), active: true, lastRunAt: new Date(r.frequency === 'MONTHLY' ? '2026-09-01T00:30:00Z' : '2026-01-01T00:30:00Z'), lastPeriodKey: r.lastPeriodKey, lastRunStatus: 'COMPLETED' },
    });
    ruleIds[`${r.code}:${r.employmentType}`] = row.id;
  }

  const employees = await prisma.employee.findMany({ where: { tenantId }, select: { id: true, fullName: true, employmentType: true, status: true, joiningDate: true, managerId: true, workLocationId: true, shiftId: true } });
  const byId = new Map(employees.map((e) => [e.id, e]));
  const eligible = employees.filter((e) => ['ACTIVE', 'NOTICE_PERIOD'].includes(e.status) && e.joiningDate && dk(e.joiningDate) <= TODAY);
  const fullTime = eligible.filter((e) => e.employmentType === 'FULL_TIME');
  const interns = eligible.filter((e) => e.employmentType === 'INTERN');

  const ledger: Prisma.LeaveLedgerEntryCreateManyInput[] = [];
  const credit = (employeeId: string, code: string, txType: string, days: number, effectiveDate: string, extra: Partial<Prisma.LeaveLedgerEntryCreateManyInput> = {}) =>
    ledger.push({ tenantId, employeeId, leaveTypeId: types[code]!.id, leaveYear: YEAR, txType: txType as any, days, effectiveDate: dd(effectiveDate), createdByName: 'System', ...extra });

  // Annual CL / SL (full-time)
  for (const code of ['CL', 'SL']) {
    const quota = code === 'CL' ? 12 : 8;
    const members = fullTime.map((e) => ({ e, days: prorateYearly(quota, dk(e.joiningDate!), YEAR) })).filter((x) => x.days > 0);
    const batch = await prisma.leaveCreditBatch.create({
      data: { tenantId, type: 'ANNUAL', leaveTypeId: types[code]!.id, ruleId: ruleIds[`${code}:FULL_TIME`], periodKey: '2026', leaveYear: YEAR, status: 'COMPLETED', employeeCount: members.length, totalDays: members.reduce((s, m) => s + m.days, 0), note: `Annual ${code} credit 2026`, startedAt: new Date('2026-01-01T00:30:00Z'), completedAt: new Date('2026-01-01T00:31:00Z') },
    });
    for (const m of members) credit(m.e.id, code, 'ACCRUAL', m.days, maxKey('2026-01-01', dk(m.e.joiningDate!)), { batchId: batch.id, note: `Annual credit ${YEAR}` });
  }
  // Interns: SL prorated on joining (Sep 15 → 2.5 days)
  for (const e of interns) {
    const d = prorateYearly(8, dk(e.joiningDate!), YEAR);
    if (d > 0) credit(e.id, 'SL', 'PRORATED_ACCRUAL', d, dk(e.joiningDate!), { note: 'Joining proration' });
  }
  // Monthly EL accrual Jan–Sep (1.5 / month)
  for (let m = 1; m <= 9; m++) {
    const key = `2026-${String(m).padStart(2, '0')}`;
    const members = fullTime.filter((e) => {
      const j = dk(e.joiningDate!);
      return j < `${key}-01` || (j.slice(0, 7) === key && Number(j.slice(8, 10)) <= 15);
    });
    const batch = await prisma.leaveCreditBatch.create({
      data: { tenantId, type: 'MONTHLY', leaveTypeId: types.EL!.id, ruleId: ruleIds['EL:FULL_TIME'], periodKey: key, leaveYear: YEAR, status: 'COMPLETED', employeeCount: members.length, totalDays: members.length * 1.5, note: `Monthly EL accrual ${key}`, startedAt: new Date(`${key}-01T00:30:00Z`), completedAt: new Date(`${key}-01T00:31:00Z`) },
    });
    for (const e of members) credit(e.id, 'EL', 'ACCRUAL', 1.5, `${key}-01`, { batchId: batch.id, note: `EL accrual ${key}` });
  }
  // EL carried forward from 2025 (Priya 0.5 → wireframe 11 / 18)
  const carried: Record<string, number> = { rohit: 12, kavya: 8, neha: 10, arjun: 6, priya: 0.5, rahul: 4, sneha: 3, vikram: 2, ananya: 5 };
  for (const [k, days] of Object.entries(carried)) if (has(k) && fullTime.some((e) => e.id === emp[k])) credit(emp[k]!, 'EL', 'CARRY_FORWARD_IN', days, '2026-01-01', { note: 'Carried forward from 2025' });

  // Comp-off: Priya worked Sun 20 Sep (release support) → 1 day, expires 19 Nov
  if (has('priya')) {
    const g = await prisma.compOffGrant.create({
      data: { tenantId, employeeId: emp.priya!, workedDate: dd('2026-09-20'), units: 1, remaining: 1, expiresOn: dd('2026-11-19'), status: 'APPROVED', source: 'REQUEST', reason: 'Production release support (Atlas v2.4)', workedMinutes: 450, approverEmployeeId: emp.neha ?? null, decidedByName: 'Neha Kapoor', decidedAt: new Date('2026-09-21T06:00:00Z') },
    });
    credit(emp.priya!, 'CO', 'COMP_OFF_GRANT', 1, '2026-09-21', { compOffGrantId: g.id, note: 'Comp-off for 20 Sep' });
  }

  // ── Leave requests ──────────────────────────────────────────────────
  const holidays: HolidayRow[] = (await prisma.holiday.findMany({ where: { tenantId } })).map((h: any) => ({ id: h.id, date: dk(h.date), name: h.name, type: h.type, locationIds: h.locationIds ?? [] }));
  const shifts = await prisma.shift.findMany({ where: { tenantId } });
  const defShift = shifts.find((s) => s.isDefault) ?? shifts[0];
  const calendarFor = (employeeId: string) => {
    const e = byId.get(employeeId);
    const s = shifts.find((x) => x.id === e?.shiftId) ?? defShift;
    return makeCalendar(s?.weeklyOffDays?.length ? s.weeklyOffDays : DEFAULT_WEEKLY_OFFS, holidays, e?.workLocationId ?? null);
  };
  const nameOf = (k: string) => (has(k) ? byId.get(emp[k]!)?.fullName ?? null : null);
  let seq = 0;
  type Req = { who: string; code: string; from: DateKey; to?: DateKey; half?: 'NONE' | 'FIRST_HALF' | 'SECOND_HALF'; reason: string; status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'WITHDRAWN'; applied: string; decided?: string; note?: string };
  const reqs: Req[] = [
    // Priya — wireframe history (latest first) + older rows that explain the balances
    { who: 'priya', code: 'EL', from: '2026-10-14', to: '2026-10-16', reason: 'Family function', status: 'PENDING', applied: '2026-09-24T05:10:00Z' },
    // Wireframe shows "4 Sep", but 4 Sep 2026 is Janmashtami in the time domain's holiday calendar
    // (and its attendance marks Priya on LEAVE on 18 Sep), so the sick day is 18 Sep.
    { who: 'priya', code: 'SL', from: '2026-09-18', reason: 'Fever', status: 'APPROVED', applied: '2026-09-18T03:20:00Z', decided: '2026-09-18T06:05:00Z' },
    { who: 'priya', code: 'CL', from: '2026-08-14', reason: 'Personal', status: 'APPROVED', applied: '2026-08-10T09:00:00Z', decided: '2026-08-10T11:30:00Z' },
    { who: 'priya', code: 'CL', from: '2026-07-02', half: 'FIRST_HALF', reason: 'Bank work', status: 'REJECTED', applied: '2026-07-01T12:40:00Z', decided: '2026-07-01T14:00:00Z', note: 'Sprint demo that morning — please pick another slot' },
    { who: 'priya', code: 'CL', from: '2026-05-11', to: '2026-05-12', reason: 'Cousin’s wedding', status: 'APPROVED', applied: '2026-04-27T08:00:00Z', decided: '2026-04-27T10:00:00Z' },
    { who: 'priya', code: 'CL', from: '2026-03-02', to: '2026-03-03', reason: 'Holi travel', status: 'APPROVED', applied: '2026-02-20T08:00:00Z', decided: '2026-02-20T09:30:00Z' },
    { who: 'priya', code: 'SL', from: '2026-02-16', to: '2026-02-18', reason: 'Viral fever', status: 'APPROVED', applied: '2026-02-16T03:00:00Z', decided: '2026-02-16T05:00:00Z' },
    { who: 'priya', code: 'CL', from: '2026-01-23', reason: 'Personal', status: 'APPROVED', applied: '2026-01-19T08:00:00Z', decided: '2026-01-19T09:00:00Z' },
    // Neha's pending team requests (3 incl. Priya's EL)
    { who: 'rahul', code: 'CL', from: '2026-10-05', reason: 'Passport appointment', status: 'PENDING', applied: '2026-09-28T06:30:00Z' },
    { who: 'sneha', code: 'EL', from: '2026-10-26', to: '2026-10-28', reason: 'Family trip to Udaipur', status: 'PENDING', applied: '2026-09-27T10:15:00Z' },
    // September leave that flows into the Sep payroll
    { who: 'rahul', code: 'EL', from: '2026-09-18', reason: 'Personal work', status: 'APPROVED', applied: '2026-09-11T07:00:00Z', decided: '2026-09-11T09:00:00Z' },
    { who: 'vikram', code: 'CL', from: '2026-09-10', to: '2026-09-11', reason: 'Moving house', status: 'APPROVED', applied: '2026-09-03T07:00:00Z', decided: '2026-09-03T10:00:00Z' },
    // Other history
    { who: 'arjun', code: 'EL', from: '2026-07-20', to: '2026-07-24', reason: 'Vacation', status: 'APPROVED', applied: '2026-06-30T07:00:00Z', decided: '2026-07-01T05:00:00Z' },
    { who: 'kavya', code: 'SL', from: '2026-08-12', reason: 'Migraine', status: 'APPROVED', applied: '2026-08-12T03:00:00Z', decided: '2026-08-12T04:00:00Z' },
    { who: 'sneha', code: 'CL', from: '2026-06-19', reason: 'Personal', status: 'APPROVED', applied: '2026-06-15T07:00:00Z', decided: '2026-06-15T09:00:00Z' },
    { who: 'rahul', code: 'SL', from: '2026-06-08', to: '2026-06-09', reason: 'Dental surgery', status: 'APPROVED', applied: '2026-06-08T03:00:00Z', decided: '2026-06-08T06:00:00Z' },
    { who: 'ananya', code: 'EL', from: '2026-08-24', to: '2026-08-26', reason: 'Family visit', status: 'APPROVED', applied: '2026-08-10T07:00:00Z', decided: '2026-08-10T08:00:00Z' },
    { who: 'vikram', code: 'SL', from: '2026-07-06', reason: 'Fever', status: 'WITHDRAWN', applied: '2026-07-05T15:00:00Z' },
    { who: 'karan', code: 'SL', from: '2026-09-25', reason: 'Cold and fever', status: 'APPROVED', applied: '2026-09-25T03:30:00Z', decided: '2026-09-25T05:00:00Z' },
  ];
  const touched = new Set<string>();
  for (const r of reqs) {
    const employeeId = emp[r.who];
    const e = employeeId ? byId.get(employeeId) : undefined;
    if (!employeeId || !e) continue;
    const t = types[r.code]!;
    const to = r.to ?? r.from;
    const half = r.half ?? 'NONE';
    const exp = expandLeaveDays({ from: r.from, to, halfDay: from1(r.from, to, half), calendar: calendarFor(employeeId), sandwichWeeklyOffs: t.sandwichWeeklyOffs, sandwichHolidays: t.sandwichHolidays });
    const days = exp.days.map((d) => ({ ...d, isPaid: true }));
    const approverId = e.managerId;
    const approverKey = Object.keys(emp).find((k) => emp[k] === approverId) ?? '';
    const approverName = nameOf(approverKey);
    const req = await prisma.leaveRequest.create({
      data: {
        tenantId,
        requestNo: `LV-${YEAR}-${String(++seq).padStart(5, '0')}`,
        employeeId,
        leaveTypeId: t.id,
        fromDate: dd(r.from),
        toDate: dd(to),
        halfDay: r.from === to ? half : 'NONE',
        days: exp.totalDays,
        paidDays: exp.totalDays,
        lopDays: 0,
        sandwichDays: exp.sandwichDays,
        dayBreakdown: days as unknown as Prisma.InputJsonValue,
        reason: r.reason,
        status: r.status,
        approverEmployeeId: approverId,
        approverSource: 'RM',
        notifyEmployeeIds: [],
        appliedByUserId: ctx.user[r.who] ?? null,
        decidedAt: r.decided ? new Date(r.decided) : null,
        decidedByName: r.decided ? approverName : null,
        decisionNote: r.note ?? null,
        cancelledAt: r.status === 'WITHDRAWN' ? new Date(r.applied) : null,
        createdAt: new Date(r.applied),
      },
    });
    touched.add(`${employeeId}|${t.id}`);
    if (r.status === 'APPROVED') {
      const worked = days.filter((d) => d.units > 0);
      await prisma.leaveRequestDay.createMany({
        data: worked.map((d) => ({ tenantId, requestId: req.id, employeeId, leaveTypeId: t.id, date: dd(d.date), session: d.session, dayKind: d.kind, units: d.units, isSandwich: d.isSandwich, isPaid: true, leaveYear: YEAR, active: true })),
      });
      credit(employeeId, r.code, 'AVAIL', -worked.reduce((s, d) => s + d.units, 0), r.from, { requestId: req.id, note: req.requestNo, createdByName: approverName ?? 'System' });
    }
  }
  // Keep the live sequence ahead of the seeded request numbers.
  await prisma.numberSequence.upsert({
    where: { tenantId_key_period: { tenantId, key: 'leave.request', period: String(YEAR) } },
    create: { id: `seq_${tenantId}_leave.request_${YEAR}`, tenantId, key: 'leave.request', period: String(YEAR), nextValue: seq + 1 },
    update: { nextValue: seq + 1 },
  });

  // Manual credit example (Manual credit tab)
  if (has('rahul')) credit(emp.rahul!, 'EL', 'MANUAL_CREDIT', 1, '2026-08-20', { note: 'Weekend release support — Atlas go-live (approved by Neha)', createdByName: 'Kavya Iyer' });

  await prisma.leaveLedgerEntry.createMany({ data: ledger });

  // ── Salaries + payroll profiles ─────────────────────────────────────
  const crypto = new CryptoService();
  const pay: Record<string, { gross: number; regime?: 'OLD' | 'NEW'; decl?: Record<string, unknown>; from?: string; prev?: number; stipend?: boolean }> = {
    rohit: { gross: 3_50_000 },
    kavya: { gross: 95_000, prev: 88_000 },
    neha: { gross: 1_60_000, prev: 1_45_000 },
    arjun: { gross: 1_30_000, prev: 1_18_000 },
    // OLD-regime declarations tuned so the engine lands on the wireframe figures.
    priya: { gross: 84_000, prev: 70_000, regime: 'OLD', decl: { sec80CPaise: 1_28_400_00, sec80DPaise: 25_000_00, rentMonthlyPaise: 15_580_00, metro: false } },
    rahul: { gross: 1_12_000, prev: 1_00_000, regime: 'OLD', decl: { sec80CPaise: 1_28_400_00, sec80DPaise: 25_000_00, rentMonthlyPaise: 27_960_00, metro: false } },
    sneha: { gross: 98_000, prev: 90_000 },
    vikram: { gross: 62_000, regime: 'OLD', decl: { sec80CPaise: 35_700_00 } },
    ananya: { gross: 58_000, prev: 54_000 },
    isha: { gross: 15_000, stipend: true },
    karan: { gross: 15_000, stipend: true },
    divya: { gross: 15_000, stipend: true },
    meera: { gross: 55_000 },
  };
  for (const [k, p] of Object.entries(pay)) {
    const employeeId = emp[k];
    const e = employeeId ? byId.get(employeeId) : undefined;
    if (!employeeId || !e) continue;
    const payType = p.stipend ? 'STIPEND' : 'SALARY';
    await prisma.employeePayrollProfile.create({
      data: { tenantId, employeeId, payType, pfEnabled: !p.stipend, pfCeilingOpted: true, esiMode: 'AUTO', taxRegime: p.regime ?? 'NEW', declarations: (p.decl ?? undefined) as any, paymentMode: 'BANK_TRANSFER', bankVerified: true },
    });
    const join = e.joiningDate ? dk(e.joiningDate) : '2026-01-01';
    const revs: { from: string; gross: number; reason: string; status: string }[] = [];
    if (p.prev && join < '2026-04-01') {
      revs.push({ from: join, gross: p.prev, reason: 'JOINING', status: 'SUPERSEDED' });
      revs.push({ from: '2026-04-01', gross: p.gross, reason: 'APPRAISAL', status: 'ACTIVE' });
    } else revs.push({ from: join, gross: p.gross, reason: 'JOINING', status: 'ACTIVE' });
    for (const r of revs) {
      const s = buildStructure({ grossMonthlyPaise: r.gross * 100 }, { payType, pfEnabled: !p.stipend, pfCeilingOpted: true, esiMode: 'AUTO' });
      await prisma.employeeSalary.create({
        data: { tenantId, employeeId, effectiveFrom: dd(r.from), ctcAnnualPaise: s.ctcAnnualPaise, grossMonthlyPaise: s.grossMonthlyPaise, structureEnc: crypto.encryptJson(s.lines)!, status: r.status, payType, reason: r.reason, note: r.reason === 'APPRAISAL' ? 'Annual appraisal FY 2026-27' : null, createdByName: 'Kavya Iyer', createdAt: new Date(`${r.from}T06:00:00Z`) },
      });
    }
  }

  // ── Leave balances (ledger projection) + payroll runs through the real engine ──
  const svc = new PrismaService();
  try {
    await runAsTenant(tenantId, async () => {
      const ledgerSvc = new LeaveLedgerService(svc);
      for (const e of eligible) {
        const typeIds = Object.values(types).filter((t) => t.code !== 'LWP').map((t) => t.id);
        for (const typeId of typeIds) {
          const t = await svc.leaveType.findUniqueOrThrow({ where: { id: typeId } });
          if (!t.appliesTo.includes(e.employmentType)) continue;
          await ledgerSvc.recompute(e.id, typeId, YEAR);
        }
      }

      // Historical attendance the Jun–Aug payslips were based on (Priya: ½ day LOP on 2 Jul — the
      // rejected CL she took anyway — and 3h 27m deducted idle in July). Injected into the engine's
      // attendance read only; the time domain owns AttendanceDay.
      const synthetic: { employeeId: string; date: DateKey; status: string; presentFraction: number; idleDeductibleMinutes: number }[] = [];
      if (has('priya')) {
        synthetic.push({ employeeId: emp.priya!, date: '2026-07-02', status: 'HALF_DAY', presentFraction: 0.5, idleDeductibleMinutes: 0 });
        for (const [d, m] of [['2026-07-08', 62], ['2026-07-15', 55], ['2026-07-22', 48], ['2026-07-29', 42]] as const) synthetic.push({ employeeId: emp.priya!, date: d, status: 'PRESENT', presentFraction: 1, idleDeductibleMinutes: m });
        synthetic.push({ employeeId: emp.priya!, date: '2026-08-12', status: 'PRESENT', presentFraction: 1, idleDeductibleMinutes: 25 });
        synthetic.push({ employeeId: emp.priya!, date: '2026-06-17', status: 'PRESENT', presentFraction: 1, idleDeductibleMinutes: 35 });
      }
      const enginePrisma = new Proxy(svc, {
        get(target, prop, receiver) {
          if (prop !== 'attendanceDay') return Reflect.get(target, prop, receiver);
          const real = (target as any).attendanceDay;
          return {
            findMany: async (args: any) => {
              const rows = await real.findMany(args);
              const gte = args?.where?.date?.gte as Date | undefined;
              const lte = args?.where?.date?.lte as Date | undefined;
              if (!gte || !lte || dk(gte) > '2026-08-31') return rows;
              const ids: string[] = args?.where?.employeeId?.in ?? [];
              const extra = synthetic
                .filter((s) => ids.includes(s.employeeId) && s.date >= dk(gte) && s.date <= dk(lte) && !rows.some((r: any) => r.employeeId === s.employeeId && dk(r.date) === s.date))
                .map((s) => ({ employeeId: s.employeeId, date: dd(s.date), status: s.status, presentFraction: s.presentFraction, idleDeductibleMinutes: s.idleDeductibleMinutes }));
              return [...rows, ...extra];
            },
          };
        },
      }) as PrismaService;
      const salarySvc = new SalaryService(svc, crypto, null as any);
      const engine = new PayrollEngineService(enginePrisma, new WorkCalendarService(svc), salarySvc);

      const runFor = async (period: string, finalize: boolean) => {
        const b = monthBounds(period);
        const payDate = lastWorkingDay(b.end);
        const run = await svc.payrollRun.create({
          data: {
            runNo: `PR-${period}`,
            period,
            periodYear: b.year,
            periodMonth: b.month,
            periodStart: dd(b.start),
            periodEnd: dd(b.end),
            runType: 'REGULAR',
            status: 'CALCULATING',
            attendanceLockDate: dd(b.end),
            includeIdleDeduction: true,
            pendingTimesheetMode: 'EXCLUDE',
            paymentDate: dd(payDate),
            calcVersion: 1,
            createdByName: 'Kavya Iyer',
            createdAt: new Date(finalize ? `${b.end}T05:00:00Z` : `${TODAY}T05:00:00Z`),
          } as any,
        });
        // "Today" is pinned to the demo date so the Sep run doesn't drift with the wall clock.
        const rows = await engine.compute({ period, lockDate: b.end, includeIdle: true, today: TODAY });
        await engine.persist(run.id, 1, rows);
        if (finalize) {
          // Historic months: every calculable item was paid.
          await svc.payrollItem.updateMany({ where: { runId: run.id, status: { in: ['READY', 'TIMESHEET_PENDING', 'ON_HOLD'] } }, data: { status: 'PAID' } });
        }
        const items = await svc.payrollItem.findMany({ where: { runId: run.id } });
        const counted = items.filter((i) => i.status !== 'EXCLUDED');
        const sum = (f: (i: (typeof items)[number]) => number) => counted.reduce((s, i) => s + f(i), 0);
        const GATE_OK = ['APPROVED', 'NOT_REQUIRED'];
        await svc.payrollRun.update({
          where: { id: run.id },
          data: {
            status: finalize ? 'PAID' : 'CALCULATED',
            employeeCount: items.length,
            internCount: items.filter((i) => i.payType === 'STIPEND').length,
            timesheetApprovedCount: items.filter((i) => GATE_OK.includes(i.timesheetGate)).length,
            timesheetPendingCount: items.filter((i) => !GATE_OK.includes(i.timesheetGate)).length,
            readyCount: items.filter((i) => ['READY', 'FINALIZED', 'PAID'].includes(i.status)).length,
            errorCount: items.filter((i) => i.status === 'ERROR').length,
            grossPaise: sum((i) => i.totalEarningsPaise),
            deductionsPaise: sum((i) => i.totalDeductionsPaise),
            netPaise: sum((i) => i.netPaise),
            employerContribPaise: sum((i) => i.employerContribPaise),
            employerPfPaise: sum((i) => i.employerPfPaise),
            idleDeductionPaise: sum((i) => i.idleDeductionPaise),
            idleEmployeeCount: counted.filter((i) => i.idleDeductionPaise > 0).length,
            calculatedAt: new Date(finalize ? `${b.end}T05:05:00Z` : `${TODAY}T05:02:00Z`),
            ...(finalize ? { finalizedAt: new Date(`${b.end}T07:00:00Z`), finalizedByName: 'Kavya Iyer', paidAt: new Date(`${payDate}T10:00:00Z`) } : {}),
          },
        });
        if (finalize) {
          for (const i of items.filter((x) => x.status === 'PAID')) {
            await svc.payslip.create({
              data: { employeeId: i.employeeId, runId: run.id, itemId: i.id, period, periodYear: b.year, periodMonth: b.month, runType: 'REGULAR', workingDays: i.workingDays, paidDays: i.paidDays, lopDays: i.lopDays, idleMinutes: i.idleMinutesDeductible, idleDeductionPaise: i.idleDeductionPaise, grossPaise: i.totalEarningsPaise, deductionsPaise: i.totalDeductionsPaise, netPaise: i.netPaise, status: 'PUBLISHED', publishedAt: new Date(`${payDate}T08:00:00Z`) } as any,
            });
          }
        }
        return run.id;
      };
      for (const p of ['2026-06', '2026-07', '2026-08']) await runFor(p, true);
      await runFor('2026-09', false);
    });
  } finally {
    await svc.raw.$disconnect();
  }
}

function from1(from: string, to: string, half: 'NONE' | 'FIRST_HALF' | 'SECOND_HALF') {
  return from === to ? half : 'NONE';
}

function maxKey(a: string, b: string) {
  return a > b ? a : b;
}

function lastWorkingDay(end: DateKey): DateKey {
  const days = eachDay(end.slice(0, 8) + '01', end).reverse();
  return days.find((d) => ![0, 6].includes(dd(d).getUTCDay())) ?? end;
}
