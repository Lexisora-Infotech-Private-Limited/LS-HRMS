/**
 * UK payroll item calculation (pure, deterministic). Same day classification and pro-rata
 * earnings as India; statutory part is UK:
 *   paidDays = eligibleDays − unpaid (unpaid leave incl. statutory-pay absences, absent days)
 *   earned_c = monthly_c × paidDays / workingDays
 *   + statutory payments (SSP, SMP, …) for statutory absences
 *   − salary sacrifice → taxable / NIable pay → PAYE, NI, pension, student loans
 *   Net is paid to the penny (no rounding line). Idle-time deductions are not made for UK
 *   staff: deducting wages needs a written contract term (Employment Rights Act 1996 s.13).
 */
import {
  UK_STATUTORY_PAY_LABELS,
  type UkPayrollProfile,
  type UkStatutory,
  type UkStatutoryPayCode,
} from '@lexisora/shared';
import type { CalcAdjustment, CalcLine, CalcResult } from '../payroll-calc';
import type { StructureLine } from '../salary';
import type { UkRates } from './uk-rates';
import {
  ageOn,
  computeDirectorNi,
  computeNi,
  computePaye,
  computePension,
  computeStatutoryPay,
  computeStudentLoans,
  parseTaxCode,
  type StatutoryDay,
} from './uk-statutory';

export type UkCalcInput = {
  period: string;
  periodEnd: string;
  taxYear: number;
  taxMonth: number;
  structure: StructureLine[];
  customDeductions?: StructureLine[];
  grossFixedPaise: number;
  days: {
    workingDays: number;
    eligibleDays: number;
    paidLeaveDays: number;
    unpaidLeaveDays: number;
    absentDays: number;
    projectedDays: number;
    latePenaltyLopDays?: number;
  };
  profile: UkPayrollProfile;
  dateOfBirth: string | null;
  /** Earlier periods this tax year (from finalised runs), excluding a P45 from another job. */
  ytd: { taxablePayPence: number; taxPence: number; niablePayPence: number; niEmployeePence: number; niEmployerPence: number };
  statutoryDays: StatutoryDay[];
  /** Shift hours per day, for the minimum wage check. */
  shiftNetMinutes: number;
  adjustments?: CalcAdjustment[];
  rates: UkRates;
};

export type UkCalcResult = CalcResult & { ukStatutory: UkStatutory; warnings: string[] };

const r2 = (x: number) => Math.round(x * 100) / 100;
const gbp = (p: number) => `£${(p / 100).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function calculateItemUk(input: UkCalcInput): UkCalcResult {
  const trace: string[] = [];
  const errors: string[] = [];
  const warnings: string[] = [];
  const lines: CalcLine[] = [];
  const WD = input.days.workingDays;
  const p = input.profile;
  const rates = input.rates;

  if (!input.structure.length || input.grossFixedPaise <= 0) errors.push('No salary structure');
  if (WD <= 0) errors.push('No working days in the period');
  let codeOk = true;
  try {
    parseTaxCode(p.taxCode);
  } catch {
    codeOk = false;
    errors.push(`Invalid tax code ${p.taxCode}`);
  }

  const unpaid = r2(input.days.unpaidLeaveDays + input.days.absentDays + (input.days.latePenaltyLopDays ?? 0));
  const paidDays = Math.max(0, r2(input.days.eligibleDays - unpaid));
  trace.push(`Working days ${WD}; eligible ${input.days.eligibleDays}; paid leave ${input.days.paidLeaveDays}; unpaid ${unpaid} → paid days ${paidDays}`);

  // Earnings (pro-rata on paid days).
  let order = 0;
  let grossEarned = 0;
  for (const c of input.structure) {
    const amt = WD > 0 ? Math.round((c.monthlyPaise * paidDays) / WD) : 0;
    grossEarned += amt;
    lines.push({ componentCode: c.code, label: c.label, kind: 'EARNING', fullAmountPaise: c.monthlyPaise, amountPaise: amt, order: order++ });
  }
  const lopAmount = Math.max(0, input.grossFixedPaise - grossEarned);
  if (lopAmount > 0) {
    const short = r2(WD - paidDays);
    lines.push({ componentCode: 'LOP', label: `Unpaid leave / absence (${short} ${short === 1 ? 'day' : 'days'})`, kind: 'INFO', amountPaise: lopAmount, order: 90 });
    trace.push(`Salary ${gbp(input.grossFixedPaise)} × ${paidDays}/${WD} = ${gbp(grossEarned)}`);
  }

  // Statutory payments for statutory absences (average weekly earnings from the contractual salary).
  const awe = Math.round((input.grossFixedPaise * 12) / 52);
  const stat = computeStatutoryPay(input.statutoryDays, awe, rates.statutoryPay);
  let statutoryTotal = 0;
  for (const [i, s] of stat.lines.entries()) {
    if (s.amountPence <= 0) continue;
    statutoryTotal += s.amountPence;
    lines.push({ componentCode: s.code, label: `${UK_STATUTORY_PAY_LABELS[s.code as UkStatutoryPayCode]} (${s.days} ${s.days === 1 ? 'day' : 'days'})`, kind: 'EARNING', amountPaise: s.amountPence, order: 40 + i });
  }
  trace.push(...stat.trace);

  // Adjustments: taxable ones count for tax and NI; non-taxable ones (e.g. expense refunds) for neither.
  let adjPos = 0;
  let adjNeg = 0;
  let adjTaxable = 0;
  for (const a of input.adjustments ?? []) {
    if (a.amountPaise >= 0) {
      adjPos += a.amountPaise;
      lines.push({ componentCode: a.type, label: a.label, kind: 'EARNING', amountPaise: a.amountPaise, adjustmentId: a.id, order: 50 + order++ });
    } else {
      adjNeg += -a.amountPaise;
      lines.push({ componentCode: a.type, label: a.label, kind: 'DEDUCTION', amountPaise: -a.amountPaise, adjustmentId: a.id, order: 150 + order++ });
    }
    if (a.taxable) adjTaxable += a.amountPaise;
  }

  // Pension (assessed on earnings before any sacrifice).
  const grossForAe = Math.max(0, grossEarned + statutoryTotal + adjTaxable);
  const age = ageOn(input.dateOfBirth, input.periodEnd);
  const basicRate = rates.bands.rUK[0]?.ratePct ?? 20;
  const pension = computePension({ settings: p.pension, ageYears: age, qualifyingEarningsPence: grossForAe, periodEnd: input.periodEnd, rates: rates.pension, basicRatePct: basicRate });
  trace.push(pension.trace);
  if (age === null) warnings.push('Date of birth missing: pension auto-enrolment could not be assessed');

  const sacrifice = pension.sacrificePence;
  if (sacrifice > 0) lines.push({ componentCode: 'PENSION_SS', label: 'Salary sacrifice (pension)', kind: 'DEDUCTION', amountPaise: sacrifice, order: 95 });
  const netPayPension = p.pension.scheme === 'NET_PAY' ? pension.employeeDeductedPence : 0;

  const niable = Math.max(0, grossEarned + statutoryTotal + adjTaxable - sacrifice);
  const taxable = Math.max(0, niable - netPayPension);

  // PAYE (P45 figures count only for the same tax year).
  const p45 = p.previousTaxYear === input.taxYear || p.previousTaxYear == null ? { pay: p.previousPayPence ?? 0, tax: p.previousTaxPence ?? 0 } : { pay: 0, tax: 0 };
  const paye = computePaye({
    // An invalid code is reported as an error above; calculate the rest on 0T so HR sees figures.
    taxCode: codeOk ? p.taxCode : '0T',
    cumulative: p.taxBasis !== 'NON_CUMULATIVE',
    taxMonth: input.taxMonth,
    taxablePayPence: taxable,
    previousTaxablePayPence: input.ytd.taxablePayPence + p45.pay,
    previousTaxPence: input.ytd.taxPence + p45.tax,
    rates,
  });
  trace.push(paye.trace);

  // NI.
  const ni = p.director
    ? computeDirectorNi(p.niCategory, niable, { niablePence: input.ytd.niablePayPence, employeePence: input.ytd.niEmployeePence, employerPence: input.ytd.niEmployerPence }, rates.ni)
    : computeNi(p.niCategory, niable, rates.ni.monthly, rates.ni);
  trace.push(ni.trace);

  // Student and postgraduate loans (on NIable pay).
  const loans = computeStudentLoans(niable, p.studentLoanPlans ?? [], !!p.postgraduateLoan, rates.studentLoan);
  if (loans.trace) trace.push(loans.trace);

  if (paye.taxPence) lines.push({ componentCode: 'PAYE', label: paye.taxPence < 0 ? 'Income tax refund (PAYE)' : 'Income tax (PAYE)', kind: paye.taxPence < 0 ? 'EARNING' : 'DEDUCTION', amountPaise: Math.abs(paye.taxPence), order: 100 });
  if (ni.employeePence) lines.push({ componentCode: 'NI_EE', label: 'National Insurance', kind: 'DEDUCTION', amountPaise: ni.employeePence, order: 101 });
  if (pension.employeeDeductedPence) lines.push({ componentCode: 'PENSION_EE', label: 'Pension (employee)', kind: 'DEDUCTION', amountPaise: pension.employeeDeductedPence, order: 102 });
  if (loans.studentLoanPence) lines.push({ componentCode: 'SL', label: 'Student loan', kind: 'DEDUCTION', amountPaise: loans.studentLoanPence, order: 103 });
  if (loans.postgradLoanPence) lines.push({ componentCode: 'PGL', label: 'Postgraduate loan', kind: 'DEDUCTION', amountPaise: loans.postgradLoanPence, order: 104 });
  if (ni.employerPence) lines.push({ componentCode: 'NI_ER', label: "Employer's National Insurance", kind: 'EMPLOYER', amountPaise: ni.employerPence, order: 200 });
  if (pension.employerPence) lines.push({ componentCode: 'PENSION_ER', label: 'Pension (employer)', kind: 'EMPLOYER', amountPaise: pension.employerPence, order: 201 });

  const taxDeduction = Math.max(0, paye.taxPence);
  const taxRefund = Math.max(0, -paye.taxPence);
  const statutoryDeductions = taxDeduction + ni.employeePence + pension.employeeDeductedPence + loans.studentLoanPence + loans.postgradLoanPence;

  // Company deductions from the template: never more than the pay left.
  let customDed = 0;
  for (const [i, c] of (input.customDeductions ?? []).entries()) {
    if (paidDays <= 0 || c.monthlyPaise <= 0) continue;
    const room = Math.max(0, grossEarned + statutoryTotal + adjPos + taxRefund - (statutoryDeductions + sacrifice + adjNeg) - customDed);
    const amt = Math.min(c.monthlyPaise, room);
    if (amt <= 0) continue;
    customDed += amt;
    lines.push({ componentCode: c.code, label: c.label, kind: 'DEDUCTION', amountPaise: amt, order: 110 + i });
  }

  const totalEarnings = grossEarned + statutoryTotal + adjPos + taxRefund;
  const totalDeductions = statutoryDeductions + sacrifice + adjNeg + customDed;
  const net = totalEarnings - totalDeductions;
  if (net < 0) errors.push('Negative net pay; defer recoveries to next period');

  // National Minimum / Living Wage check on basic pay for hours worked.
  const hours = paidDays * ((input.shiftNetMinutes || 450) / 60);
  if (age !== null && hours > 0 && grossEarned > 0) {
    const min = age >= 21 ? rates.minimumWage.age21Plus : age >= 18 ? rates.minimumWage.age18to20 : rates.minimumWage.under18;
    const hourly = (grossEarned - sacrifice) / hours;
    if (hourly + 0.5 < min) warnings.push(`Pay ${gbp(Math.round(hourly))}/hour is below the minimum wage of ${gbp(min)}/hour for age ${age}`);
  }
  for (const w of warnings) trace.push(`WARNING: ${w}`);

  const ukStatutory: UkStatutory = {
    taxYear: input.taxYear,
    taxMonth: input.taxMonth,
    taxCode: p.taxCode,
    taxBasis: p.taxBasis,
    niCategory: p.niCategory,
    grossPayPence: grossEarned + statutoryTotal + adjTaxable,
    taxablePayPence: taxable,
    niablePayPence: niable,
    taxPence: paye.taxPence,
    niEmployeePence: ni.employeePence,
    niEmployerPence: ni.employerPence,
    pensionablePayPence: pension.pensionablePence,
    pensionEmployeePence: pension.employeeGrossPence,
    pensionEmployerPence: pension.employerPence,
    pensionScheme: p.pension.scheme,
    aeAssessment: pension.assessment,
    aeAction: pension.action,
    studentLoanPence: loans.studentLoanPence,
    postgradLoanPence: loans.postgradLoanPence,
    statutoryPay: stat.lines,
    salarySacrificePence: sacrifice,
    // computePaye's to-date figures already include the P45 pay and tax.
    taxablePayYtdPence: paye.taxablePayYtdPence,
    taxYtdPence: paye.taxYtdPence,
    ratesVersion: rates.version,
  };

  return {
    lopDays: unpaid,
    paidDays,
    grossEarnedPaise: grossEarned,
    lopAmountPaise: lopAmount,
    hourlyRatePaise: r2(hours > 0 ? grossEarned / hours : 0),
    perDayRatePaise: r2(WD > 0 ? input.grossFixedPaise / WD : 0),
    idleMinutesDeductible: 0,
    idleDeductionPaise: 0,
    pfWagePaise: 0,
    esiWagePaise: 0,
    pfEePaise: 0,
    pfErPaise: 0,
    esiEePaise: 0,
    esiErPaise: 0,
    ptPaise: 0,
    tdsPaise: paye.taxPence,
    adjustmentsPaise: adjPos - adjNeg,
    totalEarningsPaise: totalEarnings,
    totalDeductionsPaise: totalDeductions,
    employerContribPaise: ni.employerPence + pension.employerPence,
    roundingPaise: 0,
    netPaise: net,
    taxableMonthlyPaise: taxable,
    lines: lines.sort((a, b) => a.order - b.order),
    trace,
    errors,
    ukStatutory,
    warnings,
  };
}
