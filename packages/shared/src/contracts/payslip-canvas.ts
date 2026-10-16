import { z } from 'zod';
import { payslipStyleSchema, PAYSLIP_FIELDS, type PayslipDesign } from './payslip-design';

// ── Payslip design v3: a free canvas. Every element sits at its own x / y on an A4 page (points) ──
// Text is whatever the company types. Only the earnings and deductions amounts (and any {{field}} the company
// chooses to insert) are filled in from payroll for each employee.

export const PAYSLIP_PAGE = { width: 595, height: 842 } as const;

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a colour like #b68235');
const pt = (min: number, max: number, def: number) => z.coerce.number().min(min).max(max).default(def);
const elementId = z.string().min(1).max(40);
const geometry = { x: pt(0, PAYSLIP_PAGE.width, 40), y: pt(0, PAYSLIP_PAGE.height, 40), w: pt(1, PAYSLIP_PAGE.width, 200), h: pt(1, PAYSLIP_PAGE.height, 24) };
const rowSchema = z.object({ label: z.string().max(40), value: z.string().max(160) });

const textEl = z.object({ type: z.literal('text'), id: elementId, ...geometry, text: z.string().max(600).default(''), style: payslipStyleSchema.default({}) });
const logoEl = z.object({ type: z.literal('logo'), id: elementId, ...geometry, w: pt(8, PAYSLIP_PAGE.width, 110), h: pt(8, PAYSLIP_PAGE.height, 48) });
const lineEl = z.object({ type: z.literal('line'), id: elementId, ...geometry, h: pt(0, PAYSLIP_PAGE.height, 0), color: hexColor.default('#d7d3d3'), thickness: pt(0.25, 6, 0.8), dashed: z.boolean().default(false) });
const boxEl = z.object({
  type: z.literal('box'),
  id: elementId,
  ...geometry,
  fill: hexColor.nullable().default(null),
  border: hexColor.nullable().default('#d7d3d3'),
  borderWidth: pt(0.25, 6, 0.8),
  radius: pt(0, 40, 6),
  /** Which corners the radius applies to: ALL, only the TOP two, only the BOTTOM two, or NONE (square). */
  corners: z.enum(['ALL', 'TOP', 'BOTTOM', 'NONE']).default('ALL'),
});
const detailsEl = z.object({
  type: z.literal('details'),
  id: elementId,
  ...geometry,
  w: pt(60, PAYSLIP_PAGE.width, 250),
  h: pt(10, PAYSLIP_PAGE.height, 150),
  rows: z.array(rowSchema).max(30).default([]),
  rowHeight: pt(8, 40, 16),
  labelWidth: pt(30, 300, 95),
  separator: z.string().max(2).default(''),
  labelColor: hexColor.default('#605d5d'),
  style: payslipStyleSchema.default({}),
});
/** Per-row settings in a table, matched to the pay component's name (e.g. "Basic"). */
const rowOverrideSchema = z.object({
  label: z.string().min(1).max(40),
  /** 0 = the table's row height. */
  height: pt(0, 60, 0),
  gapAfter: pt(0, 60, 0),
  /** DEFAULT follows the table's "lines between rows"; SHOW / HIDE force the line under this row. */
  line: z.enum(['DEFAULT', 'SHOW', 'HIDE']).default('DEFAULT'),
});
export type PayslipRowOverride = z.infer<typeof rowOverrideSchema>;

const tableEl = z.object({
  type: z.literal('table'),
  id: elementId,
  ...geometry,
  w: pt(80, PAYSLIP_PAGE.width, 515),
  h: pt(20, PAYSLIP_PAGE.height, 140),
  /** EARNINGS rows come from each employee's salary, DEDUCTIONS rows from their payroll. */
  kind: z.enum(['EARNINGS', 'DEDUCTIONS']).default('EARNINGS'),
  heading: z.string().max(40).default('Earnings'),
  amountHeading: z.string().max(30).default('Amount'),
  fullMonthHeading: z.string().max(30).default('Full month'),
  showFullMonth: z.boolean().default(false),
  showTotal: z.boolean().default(true),
  totalLabel: z.string().max(40).default('Total earnings'),
  rowHeight: pt(10, 40, 20),
  rules: z.boolean().default(true),
  headColor: hexColor.default('#605d5d'),
  totalFill: hexColor.nullable().default(null),
  style: payslipStyleSchema.default({}),
  lineColor: hexColor.default('#d7d3d3'),
  lineWidth: pt(0.25, 4, 0.5),
  lineDashed: z.boolean().default(false),
  /** null = follow `rules`. */
  headerLine: z.boolean().nullable().default(null),
  totalLine: z.boolean().nullable().default(null),
  /** 0 = the row height. */
  headerHeight: pt(0, 60, 0),
  headerGap: pt(0, 60, 0),
  totalGap: pt(0, 60, 0),
  rowOverrides: z.array(rowOverrideSchema).max(40).default([]),
});

export const payslipElementSchema = z.discriminatedUnion('type', [textEl, logoEl, lineEl, boxEl, detailsEl, tableEl]);
export type PayslipElement = z.infer<typeof payslipElementSchema>;
export type PayslipElementType = PayslipElement['type'];
export type PayslipElementOf<T extends PayslipElementType> = Extract<PayslipElement, { type: T }>;

export const PAYSLIP_ELEMENT_LABELS: Record<PayslipElementType, string> = {
  text: 'Text',
  logo: 'Logo',
  line: 'Line',
  box: 'Box',
  details: 'Details rows',
  table: 'Earnings / deductions table',
};

export const payslipCanvasSchema = z
  .object({
    version: z.literal(3).default(3),
    accentColor: hexColor.default('#b68235'),
    logoMode: z.enum(['NONE', 'COMPANY', 'CUSTOM']).default('NONE'),
    customLogo: z
      .string()
      .max(340_000, 'The logo is too large (250 KB at most)')
      .regex(/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/, 'Upload a PNG or JPEG image')
      .nullable()
      .default(null),
    elements: z.array(payslipElementSchema).max(80, 'At most 80 elements'),
  })
  .refine((v) => v.logoMode !== 'CUSTOM' || !!v.customLogo, { message: 'Upload a logo, or choose another logo option', path: ['customLogo'] })
  .refine((v) => new Set(v.elements.map((e) => e.id)).size === v.elements.length, { message: 'Each element needs its own id' });
export type PayslipCanvas = z.infer<typeof payslipCanvasSchema>;

/** A new element of a type, placed at (x, y) with sensible defaults. */
export function newPayslipElement(type: PayslipElementType, id: string, x = 40, y = 40): PayslipElement {
  const extra: Record<string, unknown> =
    type === 'text'
      ? { text: 'Your text here', w: 200, h: 20 }
      : type === 'details'
        ? { rows: [{ label: 'Employee', value: '{{employee.name}}' }, { label: 'Employee ID', value: '{{employee.code}}' }], h: 40 }
        : type === 'line'
          ? { w: 515, h: 0 }
          : type === 'box'
            ? { w: 200, h: 60 }
            : {};
  return payslipElementSchema.parse({ type, id, x, y, ...extra });
}

// ── Starting templates (coordinates are points from the top-left of the A4 page) ──
const R = (label: string, value: string) => ({ label, value });
const muted = { size: 8.5, color: '#605d5d' };

function canvas(accentColor: string, elements: unknown[]): PayslipCanvas {
  let n = 0;
  const withIds = elements.map((e) => ({ id: `e${++n}`, ...(e as object) }));
  return payslipCanvasSchema.parse({ version: 3, accentColor, logoMode: 'COMPANY', customLogo: null, elements: withIds });
}

const classicPreset = (accent: string): PayslipCanvas =>
  canvas(accent, [
    { type: 'logo', x: 48, y: 40, w: 110, h: 42 },
    { type: 'text', x: 48, y: 90, w: 499, h: 30, text: '{{company.name}}', style: { font: 'TIMES', size: 22, bold: true } },
    { type: 'text', x: 48, y: 120, w: 499, h: 14, text: 'PAYSLIP · {{pay.period}}', style: { size: 8, color: accent } },
    { type: 'line', x: 48, y: 140, w: 499, color: accent, thickness: 1 },
    { type: 'text', x: 48, y: 150, w: 499, h: 14, text: '{{company.address}}', style: muted },
    {
      type: 'details',
      x: 48,
      y: 180,
      w: 245,
      h: 130,
      rows: [R('Employee', '{{employee.name}}'), R('Employee ID', '{{employee.code}}'), R('Designation', '{{employee.designation}}'), R('Department', '{{employee.department}}'), R('Date of joining', '{{employee.joiningDate}}'), R('PAN', '{{employee.pan}}'), R('UAN', '{{employee.uan}}')],
      rowHeight: 16,
    },
    {
      type: 'details',
      x: 302,
      y: 180,
      w: 245,
      h: 130,
      rows: [R('Pay period', '{{pay.period}}'), R('Pay date', '{{pay.date}}'), R('Working days', '{{pay.workingDays}}'), R('Paid days', '{{pay.paidDays}}'), R('LOP days', '{{pay.lopDays}}'), R('Leave', '{{pay.leave}}'), R('Bank account', '{{employee.bank}}')],
      rowHeight: 16,
    },
    { type: 'table', x: 48, y: 330, w: 499, h: 150, kind: 'EARNINGS', heading: 'Earnings', showFullMonth: true, fullMonthHeading: 'Full month', amountHeading: 'Earned', totalLabel: 'Total earnings' },
    { type: 'table', x: 48, y: 495, w: 499, h: 100, kind: 'DEDUCTIONS', heading: 'Deductions', totalLabel: 'Total deductions' },
    { type: 'text', x: 48, y: 610, w: 499, h: 24, text: 'Net pay  {{pay.net}}', style: { font: 'TIMES', size: 16, bold: true } },
    { type: 'text', x: 48, y: 634, w: 499, h: 14, text: '{{pay.netInWords}}', style: { size: 9, color: '#605d5d' } },
    { type: 'text', x: 48, y: 660, w: 499, h: 14, text: '{{note.idle}}', style: muted },
    { type: 'text', x: 48, y: 674, w: 499, h: 14, text: '{{note.employer}}', style: muted },
    { type: 'text', x: 48, y: 688, w: 499, h: 14, text: '{{note.ytd}}', style: muted },
    { type: 'text', x: 48, y: 740, w: 499, h: 12, text: 'This is a computer-generated payslip and does not require a signature.', style: { size: 7.5, color: '#605d5d', align: 'CENTER' } },
  ]);

const summaryPreset = (accent: string): PayslipCanvas =>
  canvas(accent, [
    { type: 'logo', x: 48, y: 44, w: 72, h: 52 },
    { type: 'text', x: 132, y: 46, w: 270, h: 22, text: '{{company.name}}', style: { size: 15, bold: true } },
    { type: 'text', x: 132, y: 68, w: 270, h: 24, text: '{{company.address}}', style: muted },
    { type: 'text', x: 400, y: 48, w: 147, h: 12, text: 'Payslip for the month', style: { size: 8, color: '#605d5d', align: 'RIGHT' } },
    { type: 'text', x: 400, y: 60, w: 147, h: 16, text: '{{pay.period}}', style: { size: 12, bold: true, align: 'RIGHT' } },
    { type: 'line', x: 48, y: 106, w: 499 },
    { type: 'text', x: 48, y: 122, w: 200, h: 12, text: 'EMPLOYEE SUMMARY', style: { size: 7.5, bold: true, color: '#605d5d' } },
    {
      type: 'details',
      x: 48,
      y: 138,
      w: 270,
      h: 160,
      rows: [R('Employee Name', '{{employee.name}}'), R('Employee ID', '{{employee.code}}'), R('Designation', '{{employee.designation}}'), R('Department', '{{employee.department}}'), R('Date of Joining', '{{employee.joiningDate}}'), R('Pay Period', '{{pay.period}}'), R('Pay Date', '{{pay.date}}'), R('PAN', '{{employee.pan}}'), R('UAN', '{{employee.uan}}'), R('Bank Account', '{{employee.bank}}')],
      rowHeight: 16,
      labelWidth: 92,
      separator: ':',
    },
    { type: 'box', x: 342, y: 122, w: 205, h: 62, fill: '#f8f3ea', border: null, radius: 6, corners: 'TOP' },
    { type: 'box', x: 342, y: 134, w: 2.5, h: 38, fill: accent, border: null, radius: 0 },
    { type: 'text', x: 356, y: 135, w: 185, h: 24, text: '{{pay.net}}', style: { size: 18, bold: true } },
    { type: 'text', x: 356, y: 160, w: 185, h: 12, text: 'Total Net Pay', style: { size: 8.5, color: accent } },
    { type: 'box', x: 342, y: 122, w: 205, h: 110, fill: null, border: '#d7d3d3', radius: 6 },
    { type: 'details', x: 356, y: 198, w: 180, h: 34, rows: [R('Paid Days', '{{pay.paidDays}}'), R('LOP Days', '{{pay.lopDays}}')], rowHeight: 17, labelWidth: 90, separator: ':' },
    { type: 'box', x: 48, y: 318, w: 499, h: 150, fill: null, border: '#d7d3d3', radius: 6 },
    { type: 'table', x: 60, y: 326, w: 226, h: 120, kind: 'EARNINGS', heading: 'Earnings', showTotal: false, rowHeight: 18, headColor: '#201f1d' },
    { type: 'table', x: 309, y: 326, w: 226, h: 120, kind: 'DEDUCTIONS', heading: 'Deductions', showTotal: false, rowHeight: 18, headColor: '#201f1d' },
    { type: 'box', x: 49, y: 442, w: 497, h: 25, fill: '#f6f5f4', border: null, radius: 5 },
    { type: 'text', x: 60, y: 450, w: 120, h: 12, text: 'Gross Earnings', style: { size: 8.5, bold: true } },
    { type: 'text', x: 186, y: 450, w: 100, h: 12, text: '{{pay.gross}}', style: { size: 8.5, bold: true, align: 'RIGHT' } },
    { type: 'text', x: 309, y: 450, w: 120, h: 12, text: 'Total Deductions', style: { size: 8.5, bold: true } },
    { type: 'text', x: 435, y: 450, w: 100, h: 12, text: '{{pay.deductions}}', style: { size: 8.5, bold: true, align: 'RIGHT' } },
    { type: 'box', x: 48, y: 488, w: 499, h: 38, fill: null, border: '#d7d3d3', radius: 6 },
    { type: 'box', x: 407, y: 488.5, w: 139.5, h: 37, fill: '#f8f3ea', border: null, radius: 5 },
    { type: 'text', x: 60, y: 496, w: 300, h: 12, text: 'TOTAL NET PAYABLE', style: { size: 9, bold: true } },
    { type: 'text', x: 60, y: 510, w: 300, h: 12, text: 'Gross Earnings - Total Deductions', style: { size: 7.5, color: '#605d5d' } },
    { type: 'text', x: 415, y: 501, w: 124, h: 14, text: '{{pay.net}}', style: { size: 11, bold: true, align: 'RIGHT' } },
    { type: 'text', x: 48, y: 536, w: 499, h: 12, text: 'Amount In Words : {{pay.netInWords}}', style: { size: 8.5, align: 'RIGHT' } },
    { type: 'text', x: 48, y: 566, w: 499, h: 14, text: '{{note.idle}}', style: muted },
    { type: 'text', x: 48, y: 580, w: 499, h: 14, text: '{{note.employer}}', style: muted },
    { type: 'text', x: 48, y: 594, w: 499, h: 14, text: '{{note.ytd}}', style: muted },
    { type: 'line', x: 48, y: 630, w: 499 },
    { type: 'text', x: 48, y: 642, w: 499, h: 12, text: 'This is a computer-generated payslip and does not require a signature.', style: { size: 7.5, color: '#605d5d', align: 'CENTER' } },
  ]);

export const PAYSLIP_CANVAS_PRESETS = ['CLASSIC', 'SUMMARY_CARD'] as const;
export const payslipCanvasPreset = (layout: (typeof PAYSLIP_CANVAS_PRESETS)[number], accent = '#b68235'): PayslipCanvas => (layout === 'SUMMARY_CARD' ? summaryPreset(accent) : classicPreset(accent));
export const DEFAULT_PAYSLIP_CANVAS: PayslipCanvas = classicPreset('#b68235');

/** Best-effort conversion of an older block design: the closest starting template, keeping logo and colour. */
export function canvasFromBlockDesign(d: PayslipDesign): PayslipCanvas {
  const summary = d.blocks.some((b) => b.type === 'split');
  const p = payslipCanvasPreset(summary ? 'SUMMARY_CARD' : 'CLASSIC', d.accentColor);
  return { ...p, logoMode: d.logoMode, customLogo: d.customLogo };
}

/** Sample values the editor shows in place of {{fields}} (the real values come from payroll for each employee). */
export const PAYSLIP_SAMPLE: { values: Record<string, string>; earnings: { label: string; full: number; amount: number }[]; deductions: { label: string; amount: number }[] } = {
  values: {
    'company.name': 'Your Company Pvt Ltd',
    'company.address': '4th Floor, Business Centre, City',
    'company.pan': 'AAAAA0000A',
    'employee.name': 'Sample Employee',
    'employee.code': 'EMP-0001',
    'employee.designation': 'Software Engineer',
    'employee.department': 'Engineering',
    'employee.joiningDate': '2024-04-01',
    'employee.pan': 'AB••••34F',
    'employee.uan': '100123456789',
    'employee.bank': 'XXXX XXXX 4321 · HDFC0001234',
    'pay.period': 'October 2026',
    'pay.date': '2026-10-28',
    'pay.workingDays': '22',
    'pay.paidDays': '22',
    'pay.lopDays': '0',
    'pay.leave': '0',
    'pay.taxRegime': 'New',
    'pay.gross': 'Rs. 91,600.00',
    'pay.deductions': 'Rs. 2,000.00',
    'pay.net': 'Rs. 89,600.00',
    'pay.netInWords': 'Eighty-nine thousand six hundred rupees only',
    'note.employer': 'Employer contributions (not part of net pay): PF (employer) Rs. 1,800.00',
    'note.ytd': 'Year to date: gross Rs. 5,49,600.00 · TDS Rs. 0.00 · PF Rs. 10,800.00 · New tax regime',
    'note.idle': '',
  },
  earnings: [
    { label: 'Basic', full: 4_500_000, amount: 4_500_000 },
    { label: 'HRA', full: 2_250_000, amount: 2_250_000 },
    { label: 'Special allowance', full: 2_250_000, amount: 2_250_000 },
    { label: 'Conveyance', full: 160_000, amount: 160_000 },
  ],
  deductions: [
    { label: 'Provident fund', amount: 180_000 },
    { label: 'Professional tax', amount: 20_000 },
  ],
};

// ── Editing text: company details are plain typed text; per-employee values show as [Readable label] ──

const shortLabel = (label: string) => label.replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s+/g, ' ').trim();
const KEY_TO_LABEL = new Map(PAYSLIP_FIELDS.map((f) => [f.key, shortLabel(f.label)]));
const LABEL_TO_KEY = new Map(PAYSLIP_FIELDS.map((f) => [shortLabel(f.label).toLowerCase(), f.key]));

/** The bracketed label a person types or sees for a field, e.g. `[Employee name]`. */
export const payslipFieldLabel = (key: string): string => `[${KEY_TO_LABEL.get(key) ?? key}]`;
/** Stored text → what the editor shows: {{employee.name}} becomes [Employee name]. */
export const payslipTextToLabels = (text: string): string => text.replace(/\{\{\s*([A-Za-z0-9_.]+)\s*\}\}/g, (m, k: string) => (KEY_TO_LABEL.has(k) ? payslipFieldLabel(k) : m));
/** What the editor shows → stored text: [Employee name] becomes {{employee.name}} (any other bracket is left alone). */
export const payslipLabelsToText = (text: string): string => text.replace(/\[([^\][]{1,60})\]/g, (m, l: string) => (LABEL_TO_KEY.has(l.trim().toLowerCase()) ? `{{${LABEL_TO_KEY.get(l.trim().toLowerCase())}}}` : m));

/**
 * Replace the company's own details ({{company.name}}, address, PAN) with the real text, so they are ordinary
 * typed text the company can edit. Employee and payroll values are left as fields.
 */
export function bakeCompanyFields(design: PayslipCanvas, company: { name: string; address?: string | null; pan?: string | null }): PayslipCanvas {
  const values: Record<string, string> = { 'company.name': company.name, 'company.address': company.address ?? '', 'company.pan': company.pan ?? '' };
  const bake = (s: string) => s.replace(/\{\{\s*(company\.(?:name|address|pan))\s*\}\}/g, (_, k: string) => values[k] ?? '');
  return {
    ...design,
    elements: design.elements.map((e) => (e.type === 'text' ? { ...e, text: bake(e.text) } : e.type === 'details' ? { ...e, rows: e.rows.map((r) => ({ ...r, value: bake(r.value) })) } : e)),
  };
}

export type TableRowPlan = { kind: 'head' | 'row' | 'total'; label: string; height: number; line: boolean; gapBefore: number; gapAfter: number };

/** The height, line and spacing of every row of a table (header, each pay component, total), shared by the PDF and the editor. */
export function planPayslipTable(t: PayslipElementOf<'table'>, bodyLabels: string[]): TableRowPlan[] {
  const find = (label: string) => t.rowOverrides.find((o) => o.label.trim().toLowerCase() === label.trim().toLowerCase());
  const plan: TableRowPlan[] = [{ kind: 'head', label: t.heading, height: t.headerHeight || t.rowHeight, line: t.headerLine ?? t.rules, gapBefore: 0, gapAfter: t.headerGap }];
  for (const label of bodyLabels) {
    const o = find(label);
    plan.push({ kind: 'row', label, height: o?.height || t.rowHeight, line: o?.line === 'SHOW' ? true : o?.line === 'HIDE' ? false : t.rules, gapBefore: 0, gapAfter: o?.gapAfter ?? 0 });
  }
  if (t.showTotal) plan.push({ kind: 'total', label: t.totalLabel, height: t.rowHeight, line: t.totalLine ?? t.rules, gapBefore: t.totalGap, gapAfter: 0 });
  return plan;
}
