import { z } from 'zod';
import { createPurchaseSchema, finCreateVendorSchema, finRoundHalfUp, type FinInvoiceTax } from './finance';
import { clientInputBase } from './work';

/**
 * UK (region GB) finance contracts: VAT maths, VAT numbers, VAT return boxes and the UK
 * client / vendor / purchase schemas. Money is in pence (stored in the same integer "paise"
 * columns); VAT rates are basis points (2000 = 20%).
 *
 * Storage reuse (no schema change): the single VAT amount lives in the IGST column (CGST and
 * SGST stay 0), `gstRateBp` holds the VAT rate, and `gstin` columns hold VAT registration
 * numbers. Invoices keep `supplyType = 'INTER'` (one tax head) and leave `placeOfSupply` empty.
 */

// ── VAT rates and treatments ──────────────────────────────────────────────────────────

export const UK_VAT_STANDARD_BP = 2000;
export const UK_VAT_REDUCED_BP = 500;
export const UK_VAT_ZERO_BP = 0;

/**
 * How VAT applies to a sale:
 *  STANDARD 20% · REDUCED 5% · ZERO 0% (zero-rated, still a taxable supply) ·
 *  EXEMPT (no VAT, not a taxable supply) · OUTSIDE_SCOPE (e.g. B2B services to an overseas
 *  customer — reverse charge) · NOT_REGISTERED (the seller is not VAT registered).
 */
export const UK_VAT_TREATMENTS = ['STANDARD', 'REDUCED', 'ZERO', 'EXEMPT', 'OUTSIDE_SCOPE', 'NOT_REGISTERED'] as const;
export type UkVatTreatment = (typeof UK_VAT_TREATMENTS)[number];
/** Treatments a user may pick on an invoice for a UK customer. */
export const UK_VAT_PICKABLE = ['STANDARD', 'REDUCED', 'ZERO', 'EXEMPT'] as const satisfies readonly UkVatTreatment[];

export const UK_VAT_RATE_BP: Record<UkVatTreatment, number> = {
  STANDARD: UK_VAT_STANDARD_BP,
  REDUCED: UK_VAT_REDUCED_BP,
  ZERO: 0,
  EXEMPT: 0,
  OUTSIDE_SCOPE: 0,
  NOT_REGISTERED: 0,
};

export const UK_VAT_TREATMENT_LABELS: Record<UkVatTreatment, string> = {
  STANDARD: '20% standard rate',
  REDUCED: '5% reduced rate',
  ZERO: '0% zero rated',
  EXEMPT: 'Exempt',
  OUTSIDE_SCOPE: 'Outside the scope of UK VAT',
  NOT_REGISTERED: 'No VAT (not VAT registered)',
};

/** Note printed on invoices for B2B services to an overseas customer. */
export const UK_REVERSE_CHARGE_NOTE = 'Reverse charge: customer to account for VAT';
export const UK_OUTSIDE_SCOPE_NOTE = `Services supplied to a business customer outside the UK are outside the scope of UK VAT. ${UK_REVERSE_CHARGE_NOTE}.`;

const pct = (bp: number) => `${+(bp / 100).toFixed(2)}%`;

/** "20% VAT", "Exempt", "Outside the scope of UK VAT". */
export function ukVatLabel(treatment: UkVatTreatment, rateBp = UK_VAT_RATE_BP[treatment]): string {
  if (treatment === 'STANDARD' || treatment === 'REDUCED' || treatment === 'ZERO') return `${pct(rateBp)} VAT`;
  return UK_VAT_TREATMENT_LABELS[treatment];
}

/** Treatment of a stored rate (when no treatment was saved): 2000 → STANDARD, 500 → REDUCED, 0 → ZERO. */
export function ukTreatmentFromRate(rateBp: number): UkVatTreatment {
  return rateBp === UK_VAT_REDUCED_BP ? 'REDUCED' : rateBp === 0 ? 'ZERO' : 'STANDARD';
}

export const isUkVatTreatment = (v: unknown): v is UkVatTreatment => typeof v === 'string' && (UK_VAT_TREATMENTS as readonly string[]).includes(v);

/**
 * The VAT treatment of an invoice:
 *  - seller not VAT registered → NOT_REGISTERED (no VAT, plain "Invoice");
 *  - customer outside the UK (country ≠ GB) → OUTSIDE_SCOPE with the reverse-charge note
 *    (Lexisora sells B2B services; their place of supply is where the customer belongs);
 *  - otherwise the requested treatment, default 20% standard.
 */
export function ukDeriveVatTreatment(i: { vatRegistered: boolean; clientCountryCode?: string | null; requested?: UkVatTreatment | null }): { treatment: UkVatTreatment; rateBp: number; note: string | null; reverseCharge: boolean } {
  if (!i.vatRegistered) return { treatment: 'NOT_REGISTERED', rateBp: 0, note: null, reverseCharge: false };
  const country = (i.clientCountryCode ?? 'GB').trim().toUpperCase() || 'GB';
  if (country !== 'GB') return { treatment: 'OUTSIDE_SCOPE', rateBp: 0, note: UK_OUTSIDE_SCOPE_NOTE, reverseCharge: true };
  const requested = i.requested && (UK_VAT_PICKABLE as readonly string[]).includes(i.requested) ? i.requested : 'STANDARD';
  return { treatment: requested, rateBp: UK_VAT_RATE_BP[requested], note: null, reverseCharge: false };
}

/** VAT on a net line amount: round half up to the penny. */
export function ukVatForNet(netPence: number, rateBp: number): number {
  return finRoundHalfUp((netPence * rateBp) / 10000);
}

/**
 * VAT invoice figures in the shared invoice shape: VAT sits in `igstPaise`, CGST/SGST are 0,
 * no rounding of the total to the pound (round-off 0).
 */
export function ukVatFromTaxable(taxablePence: number, treatment: UkVatTreatment, rateBp = UK_VAT_RATE_BP[treatment]): FinInvoiceTax {
  const vat = treatment === 'STANDARD' || treatment === 'REDUCED' || treatment === 'ZERO' ? ukVatForNet(taxablePence, rateBp) : 0;
  return { taxablePaise: taxablePence, cgstPaise: 0, sgstPaise: 0, igstPaise: vat, taxPaise: vat, roundOffPaise: 0, totalPaise: taxablePence + vat };
}

/** Hours × hourly rate → net (rounded to the penny) → VAT. */
export function ukComputeInvoiceVat(input: { minutes: number; ratePaise: number; treatment: UkVatTreatment; rateBp?: number }): FinInvoiceTax {
  const taxable = finRoundHalfUp((input.minutes * input.ratePaise) / 60);
  return ukVatFromTaxable(taxable, input.treatment, input.rateBp);
}

/** VAT summary per rate (HMRC: net amount and VAT per rate on a VAT invoice). */
export function ukVatAnalysis(lines: { netPence: number; vatPence: number; treatment: UkVatTreatment; rateBp: number }[]): { label: string; treatment: UkVatTreatment; rateBp: number; netPence: number; vatPence: number }[] {
  const by = new Map<string, { label: string; treatment: UkVatTreatment; rateBp: number; netPence: number; vatPence: number }>();
  for (const l of lines) {
    const k = `${l.treatment}:${l.rateBp}`;
    const cur = by.get(k) ?? { label: ukVatLabel(l.treatment, l.rateBp), treatment: l.treatment, rateBp: l.rateBp, netPence: 0, vatPence: 0 };
    cur.netPence += l.netPence;
    cur.vatPence += l.vatPence;
    by.set(k, cur);
  }
  return [...by.values()].sort((a, b) => b.rateBp - a.rateBp);
}

/** VAT inside a VAT-inclusive amount: gross × r / (100% + r). */
export function ukEstimateInputVat(grossPence: number, rateBp = UK_VAT_STANDARD_BP): number {
  return finRoundHalfUp((grossPence * rateBp) / (10000 + rateBp));
}

// ── VAT registration numbers ─────────────────────────────────────────────────────────

const UK_VAT_RE = /^(GB|XI)(\d{9}|\d{12}|GD[0-4]\d{2}|HA[5-9]\d{2})$/;

/** "gb 123 4567 89" / "123456789" → "GB123456789" (bare 9/12 digits get the GB prefix). */
export function normalizeUkVatNumber(v: string | null | undefined): string {
  const s = (v ?? '').toUpperCase().replace(/[\s.\-]/g, '');
  return /^(\d{9}|\d{12})$/.test(s) ? `GB${s}` : s;
}

/**
 * UK VAT number format: GB + 9 digits, GB + 12 digits (branch traders), GBGD000–499
 * (government departments) or GBHA500–999 (health authorities); XI for Northern Ireland.
 * The check digits are NOT enforced (see `ukVatChecksumOk` for a soft warning).
 */
export function isValidUkVatNumber(v: string | null | undefined): boolean {
  return UK_VAT_RE.test(normalizeUkVatNumber(v));
}

/** HMRC modulus 97 / 9755 check of a 9 (or 12) digit number; GD/HA numbers always pass. */
export function ukVatChecksumOk(v: string | null | undefined): boolean {
  const s = normalizeUkVatNumber(v);
  if (!UK_VAT_RE.test(s)) return false;
  const digits = s.slice(2);
  if (!/^\d/.test(digits)) return true;
  const d = digits.slice(0, 9).split('').map(Number);
  const weighted = d.slice(0, 7).reduce((sum, n, i) => sum + n * (8 - i), 0);
  const total = weighted + Number(digits.slice(7, 9));
  return total % 97 === 0 || (total + 55) % 97 === 0;
}

/** "GB123456789" → "GB 123 4567 89". */
export function formatUkVatNumber(v: string | null | undefined): string {
  const s = normalizeUkVatNumber(v);
  const m = /^(GB|XI)(\d{3})(\d{4})(\d{2})(\d{3})?$/.exec(s);
  return m ? `${m[1]} ${m[2]} ${m[3]} ${m[4]}${m[5] ? ` ${m[5]}` : ''}` : s;
}

/** Optional VAT number field: '' / null → null, otherwise normalized and format-checked. */
export const ukVatNumberField = z
  .union([z.string(), z.null()])
  .optional()
  .transform((v) => (v ? normalizeUkVatNumber(v) : null))
  .refine((v) => v === null || isValidUkVatNumber(v), 'Enter a valid UK VAT number, e.g. GB123456789');

// ── Schemas (region GB) ───────────────────────────────────────────────────────────────

/**
 * Client for a UK tenant: VAT number optional (UK format checked for UK customers), country
 * defaults to GB; no GST registration type, state or PAN. Same output shape as `clientInput`.
 */
export const ukClientInput = clientInputBase
  .extend({
    countryCode: z.string().trim().toUpperCase().length(2, 'Pick a country').default('GB'),
    gstin: z.union([z.string().trim(), z.null()]).optional().transform((v) => (v ? v : null)),
  })
  .transform((v) => ({
    ...v,
    gstin: v.gstin && v.countryCode === 'GB' ? normalizeUkVatNumber(v.gstin) : v.gstin ? v.gstin.toUpperCase().replace(/\s+/g, '') : null,
    gstRegType: v.countryCode !== 'GB' ? ('OVERSEAS' as const) : v.gstin ? ('REGULAR' as const) : ('UNREGISTERED' as const),
    stateCode: null,
    pan: null,
  }))
  .superRefine((v, ctx) => {
    if (v.gstin && v.countryCode === 'GB' && !isValidUkVatNumber(v.gstin)) ctx.addIssue({ code: 'custom', path: ['gstin'], message: 'Enter a valid UK VAT number, e.g. GB123456789' });
    if (v.gstin && v.gstin.length > 20) ctx.addIssue({ code: 'custom', path: ['gstin'], message: 'VAT number is too long' });
  });
export type UkClientInput = z.infer<typeof ukClientInput>;

/** Purchase for a UK tenant: the vendor's VAT number instead of a GSTIN. */
export const ukCreatePurchaseSchema = createPurchaseSchema.extend({ vendorGstin: ukVatNumberField });

/** Vendor for a UK tenant: VAT number; no PAN / state. */
export const ukCreateVendorSchema = finCreateVendorSchema.extend({
  gstin: ukVatNumberField,
  pan: z.any().optional().transform(() => null),
  stateCode: z.any().optional().transform(() => null),
});

/** Countries offered on the UK client form (ISO 3166-1 alpha-2). */
export const UK_CLIENT_COUNTRIES: { code: string; name: string }[] = [
  { code: 'GB', name: 'United Kingdom' }, { code: 'IE', name: 'Ireland' }, { code: 'US', name: 'United States' }, { code: 'CA', name: 'Canada' },
  { code: 'DE', name: 'Germany' }, { code: 'FR', name: 'France' }, { code: 'NL', name: 'Netherlands' }, { code: 'BE', name: 'Belgium' },
  { code: 'ES', name: 'Spain' }, { code: 'IT', name: 'Italy' }, { code: 'SE', name: 'Sweden' }, { code: 'DK', name: 'Denmark' },
  { code: 'NO', name: 'Norway' }, { code: 'CH', name: 'Switzerland' }, { code: 'PL', name: 'Poland' }, { code: 'PT', name: 'Portugal' },
  { code: 'AU', name: 'Australia' }, { code: 'NZ', name: 'New Zealand' }, { code: 'IN', name: 'India' }, { code: 'SG', name: 'Singapore' },
  { code: 'AE', name: 'United Arab Emirates' }, { code: 'ZA', name: 'South Africa' }, { code: 'JP', name: 'Japan' },
];
export const ukCountryName = (code: string | null | undefined) => UK_CLIENT_COUNTRIES.find((c) => c.code === code)?.name ?? code ?? '—';

// ── VAT return (9 boxes) ──────────────────────────────────────────────────────────────

export const ukVatReturnQuery = z.object({ period: z.string().regex(/^\d{4}-\d{2}$/, 'Use the quarter end month, e.g. 2026-09').optional() });

/**
 * HMRC VAT return boxes. Boxes 1–5 in pence; boxes 6–9 are whole pounds (stored as pence,
 * pence truncated). Box 2/8/9 (EU acquisitions and Northern Ireland movements) are 0 here.
 */
export type UkVatBoxes = { box1: number; box2: number; box3: number; box4: number; box5: number; box6: number; box7: number; box8: number; box9: number };

export type UkVatReturn = {
  /** Quarter end month "2026-09". */
  period: string;
  periodLabel: string;
  start: string;
  end: string;
  dueDate: string;
  boxes: UkVatBoxes;
  /** Box 3 − Box 4 > 0: payable to HMRC; < 0: repayment due. */
  netPence: number;
  invoices: number;
  creditNotes: number;
  bills: number;
  /** VAT on bills that cannot be reclaimed (business entertainment, no valid VAT invoice). */
  nonReclaimablePence: number;
};

const wholePounds = (pence: number) => Math.trunc(pence / 100) * 100;

export function ukVatReturnBoxes(i: { outputVatPence: number; salesNetPence: number; inputVatPence: number; purchasesNetPence: number; acquisitionVatPence?: number; euSalesNetPence?: number; euPurchasesNetPence?: number }): UkVatBoxes {
  const box1 = i.outputVatPence;
  const box2 = i.acquisitionVatPence ?? 0;
  const box3 = box1 + box2;
  const box4 = i.inputVatPence;
  const box5 = Math.abs(box3 - box4);
  return { box1, box2, box3, box4, box5, box6: wholePounds(i.salesNetPence), box7: wholePounds(i.purchasesNetPence), box8: wholePounds(i.euSalesNetPence ?? 0), box9: wholePounds(i.euPurchasesNetPence ?? 0) };
}

export const UK_VAT_BOX_LABELS: Record<keyof UkVatBoxes, string> = {
  box1: 'VAT due on sales and other outputs',
  box2: 'VAT due on acquisitions from the EU (Northern Ireland only)',
  box3: 'Total VAT due (box 1 + box 2)',
  box4: 'VAT reclaimed on purchases and other inputs',
  box5: 'Net VAT to pay to HMRC or reclaim',
  box6: 'Total value of sales and other outputs, excluding VAT',
  box7: 'Total value of purchases and other inputs, excluding VAT',
  box8: 'Total value of supplies of goods to the EU (Northern Ireland only)',
  box9: 'Total acquisitions of goods from the EU (Northern Ireland only)',
};

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const p2 = (n: number) => String(n).padStart(2, '0');
const lastDayOf = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/**
 * VAT quarter containing a month. `staggerEndMonth` is one of the quarter-end months
 * (3 → Mar/Jun/Sep/Dec, the default; 1 → Jan/Apr/Jul/Oct; 2 → Feb/May/Aug/Nov).
 */
export function ukVatQuarterOf(month: string, staggerEndMonth = 3): { period: string; start: string; end: string; label: string } {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  const s = ((staggerEndMonth - 1) % 3) + 1; // 1, 2 or 3
  // Quarter end months are s, s+3, s+6, s+9.
  let endM = m;
  while ((endM - s) % 3 !== 0) endM++;
  let endY = y;
  if (endM > 12) {
    endM -= 12;
    endY += 1;
  }
  const startIdx = endY * 12 + endM - 1 - 2;
  const startY = Math.floor(startIdx / 12);
  const startM = (startIdx % 12) + 1;
  return {
    period: `${endY}-${p2(endM)}`,
    start: `${startY}-${p2(startM)}-01`,
    end: `${endY}-${p2(endM)}-${p2(lastDayOf(endY, endM))}`,
    label: `${MON[startM - 1]}–${MON[endM - 1]} ${endY}`,
  };
}

/** VAT return and payment due: 1 calendar month and 7 days after the period ends. */
export function ukVatDueDate(periodEndMonth: string): string {
  const y = Number(periodEndMonth.slice(0, 4));
  const m = Number(periodEndMonth.slice(5, 7));
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  const d = new Date(Date.UTC(ny, nm - 1, lastDayOf(ny, nm)) + 7 * 86_400_000);
  return d.toISOString().slice(0, 10);
}

/** VAT returns register row (Filing › VAT returns). */
export type FinVatReturnRow = {
  period: string;
  periodLabel: string;
  start: string;
  end: string;
  box1: number;
  box4: number;
  box5: number;
  netPence: number;
  box6: number;
  invoices: number;
  bills: number;
  status: { status: 'FILED' | 'OVERDUE' | 'DUE' | 'OPEN'; dueDate: string; filedOn: string | null; ref: string | null };
  workingDocumentId: string | null;
};

/** UK finance settings shown on forms (company year end, VAT quarter stagger). */
export type UkFinanceProfile = { vatRegistered: boolean; vatNumber: string | null; vatStaggerEndMonth: number; yearEnd: { month: number; day: number } };
