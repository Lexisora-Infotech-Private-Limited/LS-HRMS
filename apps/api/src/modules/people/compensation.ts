import { activeRegion, regionText, type ProfilePayRow } from '@lexisora/shared';
import type { CryptoService } from '../../core/crypto/crypto.service';
import type { PrismaService } from '../../core/prisma/prisma.service';
import { splitCtc } from './people.rules';
import { dbDateKey } from './people.util';

export type Compensation = { rows: ProfilePayRow[]; ctcAnnualPaise: number; effectiveFrom: string | null; source: 'PAYROLL' | 'OFFER' };

type StructRow = { code?: string; label?: string; monthlyPaise?: number; annualPaise?: number };

/**
 * Components of an annual package when no payroll structure exists. India: the CTC split with
 * employer PF (unchanged). UK: no CTC split and no PF; the annual salary is the only line.
 */
function packageRows(annualPaise: number): ProfilePayRow[] {
  if (activeRegion() === 'GB') return [];
  return splitCtc(annualPaise).map((r) => ({ component: r.label, monthlyPaise: r.monthlyPaise, annualPaise: r.annualPaise }));
}

/**
 * Compensation for Offer & pay / offer Annexure A: the active Payroll `EmployeeSalary`
 * (leavepay spine, structure decrypted with CryptoService), else the recruitment offer's CTC.
 */
export async function loadCompensation(prisma: PrismaService, crypto: CryptoService, employeeId: string): Promise<Compensation | null> {
  try {
    const sal = await prisma.employeeSalary.findFirst({ where: { employeeId, status: 'ACTIVE' }, orderBy: { effectiveFrom: 'desc' } });
    if (sal) {
      const struct = (crypto.decryptJson<StructRow[]>(sal.structureEnc) ?? []).filter((r) => !/^(CTC|GROSS|NET|TOTAL|NET_PAY)$/i.test(r.code ?? '') && (r as { kind?: string }).kind !== 'DEDUCTION');
      const rows: ProfilePayRow[] = struct
        .filter((r) => (r.monthlyPaise ?? 0) > 0 || (r.annualPaise ?? 0) > 0)
        .map((r) => ({ component: r.label ?? r.code ?? '—', monthlyPaise: r.monthlyPaise ?? Math.round((r.annualPaise ?? 0) / 12), annualPaise: r.annualPaise ?? (r.monthlyPaise ?? 0) * 12 }));
      const rowsOrSplit: ProfilePayRow[] = rows.length ? rows : packageRows(sal.ctcAnnualPaise);
      rowsOrSplit.push({ component: regionText('CTC'), monthlyPaise: Math.round(sal.ctcAnnualPaise / 12), annualPaise: sal.ctcAnnualPaise, isTotal: true });
      return { rows: rowsOrSplit, ctcAnnualPaise: sal.ctcAnnualPaise, effectiveFrom: dbDateKey(sal.effectiveFrom), source: 'PAYROLL' };
    }
  } catch {
    /* payroll tables unavailable in this build */
  }
  const app = await prisma.jobApplication.findFirst({ where: { employeeId }, include: { offer: true } });
  if (app?.offer) {
    const rows: ProfilePayRow[] = packageRows(app.offer.annualCtcPaise);
    rows.push({ component: regionText('CTC'), monthlyPaise: Math.round(app.offer.annualCtcPaise / 12), annualPaise: app.offer.annualCtcPaise, isTotal: true });
    return { rows, ctcAnnualPaise: app.offer.annualCtcPaise, effectiveFrom: dbDateKey(app.offer.joiningDate), source: 'OFFER' };
  }
  return null;
}
