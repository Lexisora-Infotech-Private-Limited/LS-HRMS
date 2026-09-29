import { describe, expect, it } from 'vitest';
import {
  applicationScore,
  applyOnboardingEvent,
  bandFor,
  buildIcs,
  buildVcf,
  canAssetMove,
  canMoveStage,
  computeLwd,
  currentStep,
  defaultNoticeDays,
  eligibleForCycle,
  empCodeSeries,
  employeeStatusLabel,
  exitBlockers,
  formatEmpCode,
  idCardMissing,
  incompleteSteps,
  isValidAadhaar,
  isValidIfsc,
  isValidPan,
  istDateTime,
  kitStatus,
  maskAadhaar,
  maskPan,
  maxCodeNumber,
  OnboardingRuleError,
  orderByManager,
  overallFromRatings,
  parseFlexibleDate,
  resultFromRecommendation,
  slugify,
  suggestCycleName,
  suggestResult,
  templateWeightsValid,
  validateBank,
  validateCsvRow,
  validateCsvRows,
  verhoeffDigit,
  warrantyThreshold,
  weightedScore,
  whatsappLink,
  type CsvLookupCtx,
  type ObKey,
  type ObStepStatus,
} from './people.rules';

describe('employee codes', () => {
  it('formats full-time codes as LX-#### and interns as LX-I-###', () => {
    expect(formatEmpCode('FULL_TIME', 161)).toBe('LX-0161');
    expect(formatEmpCode('CONTRACT', 7)).toBe('LX-0007');
    expect(formatEmpCode('INTERN', 24)).toBe('LX-I-024');
    expect(formatEmpCode('FULL_TIME', 12345)).toBe('LX-12345');
  });
  it('uses separate sequence keys per series', () => {
    expect(empCodeSeries('FULL_TIME').key).toBe('employee.fulltime');
    expect(empCodeSeries('CONTRACT').key).toBe('employee.fulltime');
    expect(empCodeSeries('INTERN').key).toBe('employee.intern');
  });
  it('rejects non-positive sequence values', () => {
    expect(() => formatEmpCode('INTERN', 0)).toThrow();
  });
  it('finds the highest used number per series', () => {
    const codes = ['LX-0001', 'LX-0160', 'LX-I-021', 'LX-I-023', 'X-9999'];
    expect(maxCodeNumber(codes, 'FULL_TIME')).toBe(160);
    expect(maxCodeNumber(codes, 'INTERN')).toBe(23);
  });
  it('labels statuses like the wireframe', () => {
    expect(employeeStatusLabel('ACTIVE', 'FULL_TIME')).toBe('Active');
    expect(employeeStatusLabel('ACTIVE', 'INTERN')).toBe('Intern');
    expect(employeeStatusLabel('NOTICE_PERIOD', 'FULL_TIME')).toBe('Notice period');
    expect(employeeStatusLabel('ONBOARDING', 'FULL_TIME')).toBe('Onboarding');
  });
});

describe('statutory validation', () => {
  it('validates PAN format with P as the 4th character', () => {
    expect(isValidPan('ABCPS1234K')).toBe(true);
    expect(isValidPan('ABCD1234F')).toBe(false);
    expect(isValidPan('ABCCS1234K')).toBe(false);
    expect(maskPan('ABCPS1234K')).toBe('XXXXX1234X');
  });
  it('validates Aadhaar with the Verhoeff checksum', () => {
    const base = '23456789012';
    const good = base + verhoeffDigit(base);
    expect(isValidAadhaar(good)).toBe(true);
    const bad = base + ((verhoeffDigit(base) + 1) % 10);
    expect(isValidAadhaar(bad)).toBe(false);
    expect(isValidAadhaar('1' + good.slice(1))).toBe(false); // first digit 2-9
    expect(maskAadhaar('4821')).toBe('XXXX XXXX 4821');
  });
  it('validates IFSC and account confirmation', () => {
    expect(isValidIfsc('HDFC0001234')).toBe(true);
    expect(isValidIfsc('HDFC1001234')).toBe(false);
    expect(validateBank({ accountNumber: '50100234567890', confirmAccountNumber: '50100234567890', ifsc: 'HDFC0001234' })).toBeNull();
    expect(validateBank({ accountNumber: '50100234567890', confirmAccountNumber: '50100234567891', ifsc: 'HDFC0001234' })).toMatch(/do not match/);
    expect(validateBank({ accountNumber: '1234', confirmAccountNumber: '1234', ifsc: 'HDFC0001234' })).toMatch(/9 to 18/);
  });
});

describe('dates', () => {
  it('accepts YYYY-MM-DD and DD-MM-YYYY', () => {
    expect(parseFlexibleDate('2026-10-06')).toBe('2026-10-06');
    expect(parseFlexibleDate('06-10-2026')).toBe('2026-10-06');
    expect(parseFlexibleDate('6/10/2026')).toBe('2026-10-06');
    expect(parseFlexibleDate('31-02-2026')).toBeNull();
    expect(parseFlexibleDate('Oct 6')).toBeNull();
  });
});

describe('CSV row validation', () => {
  const ctx: CsvLookupCtx = {
    departments: new Map([['development', 'd1'], ['qa', 'd2']]),
    designations: new Map([['software engineer', 'g1'], ['intern', 'g2']]),
    branches: new Map([['ahmedabad', 'b1']]),
    managersByEmail: new Map([['neha.kapoor@lexisora.com', 'e-neha']]),
    existingEmails: new Set(['priya.sharma@lexisora.com']),
    today: '2026-09-29',
  };
  const row = (o: Record<string, string> = {}) => ({
    full_name: 'Aditya Kulkarni',
    official_email: 'aditya.kulkarni@lexisora.com',
    phone: '+91 98250 11111',
    department: 'Development',
    designation: 'Software Engineer',
    manager_email: 'neha.kapoor@lexisora.com',
    employment_type: 'Full-time',
    work_mode: 'Remote',
    joining_date: '06-10-2026',
    ...o,
  });

  it('normalises a valid row', () => {
    const r = validateCsvRow(row(), 1, ctx);
    expect(r.ok).toBe(true);
    expect(r.value).toMatchObject({ departmentId: 'd1', designationId: 'g1', managerId: 'e-neha', employmentType: 'FULL_TIME', workMode: 'REMOTE', joiningDate: '2026-10-06' });
  });
  it('reports each invalid field with its row number', () => {
    const r = validateCsvRow(row({ official_email: 'bad', department: 'Sales', employment_type: 'Temp', joining_date: '2026/13/40', phone: '12' }), 7, ctx);
    expect(r.ok).toBe(false);
    const fields = r.errors.map((e) => e.field);
    expect(fields).toEqual(expect.arrayContaining(['official_email', 'department', 'employment_type', 'joining_date', 'phone']));
    expect(r.errors.every((e) => e.row === 7)).toBe(true);
  });
  it('rejects existing emails and unknown managers', () => {
    expect(validateCsvRow(row({ official_email: 'priya.sharma@lexisora.com' }), 1, ctx).errors[0]!.message).toMatch(/already exists/);
    expect(validateCsvRow(row({ manager_email: 'nobody@lexisora.com' }), 1, ctx).errors[0]!.message).toMatch(/not found/);
  });
  it('allows unknown masters when "Create missing masters" is ticked', () => {
    expect(validateCsvRow(row({ department: 'Sales' }), 1, { ...ctx, createMissingMasters: true }).ok).toBe(true);
  });
  it('resolves managers defined in the same file and orders them first', () => {
    const rows = [
      row({ official_email: 'report@lexisora.com', manager_email: 'lead@lexisora.com' }),
      row({ official_email: 'lead@lexisora.com', manager_email: '' }),
      row({ official_email: 'report@lexisora.com' }), // duplicate
      row({ official_email: 'x@lexisora.com', phone: '1' }), // invalid
    ];
    const { valid, errors } = validateCsvRows(rows, ctx);
    expect(valid.map((v) => v.officialEmail)).toEqual(['report@lexisora.com', 'lead@lexisora.com']);
    expect(errors.map((e) => e.row)).toEqual([3, 4]);
    expect(orderByManager(valid).map((v) => v.officialEmail)).toEqual(['lead@lexisora.com', 'report@lexisora.com']);
  });
  it('fails a report whose in-file manager row is invalid', () => {
    const rows = [row({ official_email: 'r@lexisora.com', manager_email: 'm@lexisora.com' }), row({ official_email: 'm@lexisora.com', phone: 'x' })];
    const { valid, errors } = validateCsvRows(rows, ctx);
    expect(valid).toHaveLength(0);
    expect(errors.some((e) => e.row === 1 && e.field === 'manager_email')).toBe(true);
  });
});

describe('onboarding step state machine', () => {
  const fresh = (): Record<ObKey, ObStepStatus> => ({ offer: 'PENDING', nda: 'PENDING', docs: 'PENDING', bank: 'PENDING', kit: 'PENDING' });

  it('moves to IN_PROGRESS on the first completed step', () => {
    const r = applyOnboardingEvent('NOT_STARTED', fresh(), { type: 'STEP_DONE', key: 'offer' });
    expect(r.status).toBe('IN_PROGRESS');
    expect(r.steps.offer).toBe('DONE');
    expect(currentStep(r.steps)).toBe('nda');
  });
  it('requires the offer letter before other steps', () => {
    expect(() => applyOnboardingEvent('NOT_STARTED', fresh(), { type: 'STEP_DONE', key: 'nda' })).toThrow(/offer letter/);
  });
  it('blocks Finish until steps 1-4 are done, listing what is missing', () => {
    const s = { ...fresh(), offer: 'DONE' as const };
    try {
      applyOnboardingEvent('IN_PROGRESS', s, { type: 'FINISH' });
      throw new Error('expected failure');
    } catch (e) {
      expect(e).toBeInstanceOf(OnboardingRuleError);
      expect((e as OnboardingRuleError).code).toBe('STEPS_INCOMPLETE');
      expect((e as OnboardingRuleError).details).toEqual(['nda', 'docs', 'bank']);
    }
  });
  it('the kit step is completed by Finish only', () => {
    const s = { ...fresh(), offer: 'DONE' as const };
    expect(() => applyOnboardingEvent('IN_PROGRESS', s, { type: 'STEP_DONE', key: 'kit' })).toThrow(/Finish/);
  });
  it('Finish submits; verification completes; rejection reopens docs', () => {
    let st = fresh();
    let status: Parameters<typeof applyOnboardingEvent>[0] = 'NOT_STARTED';
    for (const k of ['offer', 'nda', 'docs', 'bank'] as ObKey[]) ({ status, steps: st } = applyOnboardingEvent(status, st, { type: 'STEP_DONE', key: k }));
    expect(incompleteSteps(st)).toEqual([]);
    ({ status, steps: st } = applyOnboardingEvent(status, st, { type: 'FINISH' }));
    expect(status).toBe('SUBMITTED');
    expect(st.kit).toBe('DONE');
    expect(() => applyOnboardingEvent(status, st, { type: 'FINISH' })).toThrow(/already submitted/);
    expect(() => applyOnboardingEvent(status, st, { type: 'STEP_DONE', key: 'bank' })).toThrow(/reopen/);

    ({ status, steps: st } = applyOnboardingEvent(status, st, { type: 'DOC_REJECTED' }));
    expect(status).toBe('IN_PROGRESS');
    expect(st.docs).toBe('NEEDS_ATTENTION');
    expect(currentStep(st)).toBe('docs');
    // ALL_VERIFIED is ignored while a step is open
    expect(applyOnboardingEvent(status, st, { type: 'ALL_VERIFIED' }).status).toBe('IN_PROGRESS');

    ({ status, steps: st } = applyOnboardingEvent(status, st, { type: 'STEP_DONE', key: 'docs' }));
    expect(status).toBe('SUBMITTED');
    ({ status } = applyOnboardingEvent(status, st, { type: 'ALL_VERIFIED' }));
    expect(status).toBe('COMPLETED');
    expect(() => applyOnboardingEvent('COMPLETED', st, { type: 'STEP_DONE', key: 'offer' })).toThrow(/already complete/);
  });
  it('HR reopen and override', () => {
    const done: Record<ObKey, ObStepStatus> = { offer: 'DONE', nda: 'DONE', docs: 'DONE', bank: 'DONE', kit: 'DONE' };
    const r = applyOnboardingEvent('SUBMITTED', done, { type: 'REOPEN', key: 'bank' });
    expect(r).toMatchObject({ status: 'IN_PROGRESS', steps: { bank: 'NEEDS_ATTENTION' } });
    const o = applyOnboardingEvent('IN_PROGRESS', { ...done, nda: 'PENDING' }, { type: 'OVERRIDE' });
    expect(o.status).toBe('COMPLETED');
    expect(o.steps.nda).toBe('SKIPPED');
    expect(() => applyOnboardingEvent('CANCELLED', done, { type: 'FINISH' })).toThrow(/cancelled/);
  });
});

describe('notice & exit', () => {
  it('computes notice days and LWD = resignation + notice − 1', () => {
    expect(defaultNoticeDays('FULL_TIME', '2024-01-12', '2026-09-29')).toBe(30);
    expect(defaultNoticeDays('FULL_TIME', '2026-06-01', '2026-09-29')).toBe(15);
    expect(defaultNoticeDays('INTERN', '2026-09-15', '2026-09-29')).toBe(7);
    expect(computeLwd('2026-09-10', 30)).toEqual({ lastWorkingDay: '2026-10-09', shortfallDays: 0 });
    expect(computeLwd('2026-09-10', 30, '2026-09-30')).toEqual({ lastWorkingDay: '2026-09-30', shortfallDays: 9 });
    expect(() => computeLwd('2026-09-10', 30, '2026-09-01')).toThrow();
  });
  it('blocks completion while assets are held or blocking items pending', () => {
    const items = [
      { key: 'ASSET_RETURN', status: 'PENDING', blocking: true },
      { key: 'IDCARD_SURRENDER', status: 'DONE', blocking: true },
      { key: 'KT_HANDOVER', status: 'PENDING', blocking: true },
      { key: 'EXIT_INTERVIEW', status: 'PENDING', blocking: false },
    ];
    expect(exitBlockers(items, 2)).toEqual(['2 assets not returned', 'Knowledge transfer & handover']);
    expect(exitBlockers(items.map((i) => ({ ...i, status: 'DONE' })), 0)).toEqual([]);
  });
});

describe('appraisal scoring', () => {
  it('weights must total 100', () => {
    expect(templateWeightsValid([40, 30, 20])).toBe(false);
    expect(templateWeightsValid([40, 30, 30])).toBe(true);
    expect(templateWeightsValid([])).toBe(false);
  });
  it('computes the weighted score and band', () => {
    const s = weightedScore([
      { weight: 40, rating: 5 },
      { weight: 30, rating: 4 },
      { weight: 30, rating: 3 },
    ]);
    expect(s).toBe(4.1);
    expect(bandFor(s)).toBe('Exceeds expectations');
    expect(bandFor(3.9)).toBe('Exceeds expectations');
    expect(bandFor(4.5)).toBe('Outstanding');
    expect(bandFor(2.4)).toBe('Needs improvement');
    expect(weightedScore([{ weight: 50, rating: 4 }, { weight: 50, rating: null }])).toBeNull();
  });
  it('suggests Indian FY half-year cycle names', () => {
    expect(suggestCycleName('2026-09-29')).toEqual({ name: 'H1 FY26-27', from: '2026-04-01', to: '2026-09-30' });
    expect(suggestCycleName('2026-02-10')).toEqual({ name: 'H2 FY25-26', from: '2025-10-01', to: '2026-03-31' });
  });
  it('eligibility uses tenure before period end', () => {
    const cyc = { periodTo: '2026-09-30', minTenureDays: 90, types: ['FULL_TIME'] };
    expect(eligibleForCycle({ status: 'ACTIVE', employmentType: 'FULL_TIME', joiningDate: '2026-07-02' }, cyc)).toBe(true);
    expect(eligibleForCycle({ status: 'ACTIVE', employmentType: 'FULL_TIME', joiningDate: '2026-07-03' }, cyc)).toBe(false);
    expect(eligibleForCycle({ status: 'ACTIVE', employmentType: 'INTERN', joiningDate: '2026-01-01' }, cyc)).toBe(false);
    expect(eligibleForCycle({ status: 'NOTICE_PERIOD', employmentType: 'FULL_TIME', joiningDate: '2020-01-01' }, cyc)).toBe(false);
  });
});

describe('recruitment', () => {
  it('derives result from recommendations and averages scores', () => {
    expect(resultFromRecommendation('HIRE')).toBe('SELECTED');
    expect(resultFromRecommendation('STRONG_NO_HIRE')).toBe('REJECTED');
    expect(suggestResult(['HIRE', 'NO_HIRE'])).toBe('ON_HOLD');
    expect(suggestResult(['HIRE', 'STRONG_HIRE', 'NO_HIRE'])).toBe('SELECTED');
    expect(applicationScore([8.2])).toBe(8.2);
    expect(applicationScore([8, 7.5, null])).toBe(7.8);
    expect(applicationScore([])).toBeNull();
    expect(overallFromRatings([4, 5, 4])).toBe(8.7);
  });
  it('restricts stage moves', () => {
    expect(canMoveStage('SCREENING', 'INTERVIEW')).toBe(true);
    expect(canMoveStage('HIRED', 'REJECTED')).toBe(false);
    expect(canMoveStage('REJECTED', 'SCREENING')).toBe(true);
  });
  it('builds an RFC 5545 invite in IST', () => {
    const start = istDateTime('2026-09-30', '11:00');
    expect(start.toISOString()).toBe('2026-09-30T05:30:00.000Z');
    const ics = buildIcs({
      uid: 'abc@lexisora.hrms.app',
      sequence: 1,
      method: 'REQUEST',
      start,
      durationMin: 60,
      summary: 'Interview – Aditya Kulkarni – Technical 2 (React Developer)',
      organizer: { name: 'Lexisora Recruiting', email: 'careers@lexisora.com' },
      attendees: [{ name: 'Aditya', email: 'aditya@example.com' }],
      now: new Date('2026-09-29T04:00:00Z'),
    });
    expect(ics).toContain('METHOD:REQUEST');
    expect(ics).toContain('UID:abc@lexisora.hrms.app');
    expect(ics).toContain('SEQUENCE:1');
    expect(ics).toContain('DTSTART;TZID=Asia/Kolkata:20260930T110000');
    expect(ics).toContain('DTEND;TZID=Asia/Kolkata:20260930T120000');
    expect(ics).toContain('TRIGGER:-PT15M');
    expect(ics).toContain('SUMMARY:Interview – Aditya Kulkarni – Technical 2 (React Developer)');
  });
});

describe('assets, kits, cards', () => {
  it('warranty thresholds 30 / 7 / 0 days', () => {
    expect(warrantyThreshold('2027-01-01', '2026-12-02')).toBe(30);
    expect(warrantyThreshold('2027-01-01', '2026-12-26')).toBe(7);
    expect(warrantyThreshold('2027-01-01', '2027-01-01')).toBe(0);
    expect(warrantyThreshold('2027-01-01', '2026-09-29')).toBeNull();
    expect(warrantyThreshold(null, '2026-09-29')).toBeNull();
  });
  it('asset state machine', () => {
    expect(canAssetMove('IN_STOCK', 'ASSIGNED')).toBe(true);
    expect(canAssetMove('ASSIGNED', 'ASSIGNED')).toBe(false);
    expect(canAssetMove('RETURNED', 'UNDER_REPAIR')).toBe(true);
    expect(canAssetMove('LOST', 'IN_STOCK')).toBe(false);
  });
  it('kit status from lines', () => {
    expect(kitStatus([{ issued: false }, { issued: false }])).toBe('PENDING');
    expect(kitStatus([{ issued: true }, { issued: false }])).toBe('PARTIAL');
    expect(kitStatus([{ issued: true }, { issued: true }])).toBe('ISSUED');
  });
  it('ID card completeness', () => {
    expect(idCardMissing({ fullName: 'Meera Iyer', designation: 'QA Engineer' }, true)).toEqual(['employee.photo', 'employee.blood_group']);
    expect(idCardMissing({ fullName: 'A', designation: 'B', photoFileId: 'f', bloodGroup: null }, false)).toEqual([]);
  });
  it('visiting card helpers', () => {
    expect(slugify('Priya Sharma')).toBe('priya-sharma');
    const vcf = buildVcf({ name: 'Priya Sharma', org: 'Lexisora Infotech', title: 'Software Engineer', email: 'priya.sharma@lexisora.com', phone: '+91 98250 12345' });
    expect(vcf).toContain('FN:Priya Sharma');
    expect(vcf).toContain('N:Sharma;Priya;;;');
    expect(vcf).toContain('ORG:Lexisora Infotech');
    expect(whatsappLink('98250 12345', 'Hi https://x/c/p')).toBe('https://wa.me/919825012345?text=Hi%20https%3A%2F%2Fx%2Fc%2Fp');
    expect(whatsappLink('', 'Hi')).toBe('https://wa.me/?text=Hi');
  });
});
