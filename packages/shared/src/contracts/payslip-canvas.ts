import { z } from 'zod';
import { payslipStyleSchema, PAYSLIP_FIELDS, type PayslipDesign, type PayslipStyle } from './payslip-design';

// ── Payslip design v3: a free canvas. Every element sits at its own x / y on an A4 page (points) ──
// Text is whatever the company types. Only the earnings and deductions amounts (and any {{field}} the company
// chooses to insert) are filled in from payroll for each employee.

export const PAYSLIP_PAGE = { width: 595, height: 842 } as const;

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a colour like #b68235');
const pt = (min: number, max: number, def: number) => z.coerce.number().min(min).max(max).default(def);
const elementId = z.string().min(1).max(40);
const geometry = { x: pt(0, PAYSLIP_PAGE.width, 40), y: pt(0, PAYSLIP_PAGE.height, 40), w: pt(1, PAYSLIP_PAGE.width, 200), h: pt(1, PAYSLIP_PAGE.height, 24) };
const rowSchema = z.object({ label: z.string().max(40), value: z.string().max(160) });

const textEl = z.object({
  type: z.literal('text'),
  id: elementId,
  ...geometry,
  text: z.string().max(600).default(''),
  style: payslipStyleSchema.default({}),
  /** A label at the front of the line in its own colour (e.g. "Amount in words :"), followed by the text, so the two always sit together. */
  lead: z.object({ text: z.string().max(80).default(''), color: hexColor.default('#605d5d'), bold: z.boolean().default(false) }).nullable().default(null),
  /** Keep the text on one line, shrinking it only as much as needed to fit the box. */
  fit: z.boolean().default(false),
});
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
  /** The wording to print for this pay component instead of its payroll name ('' = keep the payroll name). */
  rename: z.string().max(60).default(''),
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
  /** Space between the text and the left / right edge of each cell. */
  cellPadding: pt(0, 30, 3),
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
  /** null = the standard heading look (small, bold, in the heading colour, UPPERCASE); otherwise the company's own font, size, colour and case. */
  headStyle: payslipStyleSchema.nullable().default(null),
  /** Pay components to print even when the employee has none of it that month (shown as 0). */
  alwaysShow: z.array(z.string().min(1).max(40)).max(20).default([]),
  /** Rows the company types itself, printed under the payroll rows. They are not added to the totals. */
  extraRows: z.array(z.object({ label: z.string().max(60).default(''), full: z.string().max(40).default(''), amount: z.string().max(80).default('') })).max(12).default([]),
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


// Pink and teal summary: header with logo and month, summary card, side-by-side earnings and deductions, net payable bar, notes and signatory.
const PINK = '#e91e8c';
const TEAL = '#12a3c6';
const NAVY = '#1f2a44';
const SLATE = '#5b6475';
const PINK_TINT = '#fdf0f6';
const BLUE_TINT = '#e5f5fa';
const HAIR = '#e5e7eb';

/**
 * Use one font family for every text, details row, table row and table heading of a design. Size, bold, italic, colour and
 * everything else stay as they are; a table whose headings were still in the standard look gets that same look in the new font.
 */
export function applyPayslipFont(design: PayslipCanvas, font: PayslipStyle['font']): PayslipCanvas {
  return {
    ...design,
    elements: design.elements.map((e) =>
      e.type === 'text' || e.type === 'details'
        ? { ...e, style: { ...e.style, font } }
        : e.type === 'table'
          ? { ...e, style: { ...e.style, font }, headStyle: { ...(e.headStyle ?? { size: Math.min(8, e.style.size), bold: true, italic: false, color: e.headColor, align: 'LEFT' as const, textCase: 'UPPER' as const }), font } }
          : e,
    ),
  };
}

const brandedPreset = (): PayslipCanvas => {
  const nav = (size: number, extra: Record<string, unknown> = {}) => ({ size, color: NAVY, ...extra });
  const slate = (size: number, extra: Record<string, unknown> = {}) => ({ size, color: SLATE, ...extra });
  const rule = (x: number, y: number, w: number, color = HAIR, thickness = 0.6) => ({ type: 'line', x, y, w, color, thickness });
  const vbar = (x: number, y: number, h: number, fill = '#e3e6ea') => ({ type: 'box', x, y, w: 1, h, fill, border: null, radius: 0, corners: 'NONE' });
  const band = (x: number, y: number, w: number, h: number, fill: string, radius = 0, corners = 'NONE') => ({ type: 'box', x, y, w, h, fill, border: null, radius, corners });
  const frame = (x: number, y: number, w: number, h: number, fill: string | null = null, border = '#e3e6ea') => ({ type: 'box', x, y, w, h, fill, border, radius: 4 });
  return applyPayslipFont(canvas(PINK, [
    // header
    { type: 'logo', x: 28, y: 42, w: 100, h: 70 },
    { type: 'text', x: 155, y: 56, w: 265, h: 22, text: '{{company.name}}', style: { size: 16, bold: true, color: PINK } },
    { type: 'text', x: 155, y: 82, w: 265, h: 30, text: '{{company.address}}', style: slate(9) },
    vbar(433, 48, 68, '#d1d5db'),
    { type: 'text', x: 452, y: 56, w: 115, h: 12, text: 'Payslip For the Month', style: slate(9) },
    { type: 'text', x: 452, y: 72, w: 120, h: 20, text: '{{pay.period}}', style: nav(15, { bold: true }) },
    rule(25, 138, 547, '#c9ced6', 0.8),
    // employee summary
    frame(25, 165, 311, 160),
    band(25, 165, 311, 33, '#eef0f4', 4, 'TOP'),
    band(25, 165, 3, 33, PINK),
    { type: 'text', x: 40, y: 174, w: 250, h: 16, text: 'EMPLOYEE SUMMARY', style: nav(12, { bold: true }) },
    {
      type: 'details',
      x: 40,
      y: 204,
      w: 285,
      h: 108,
      rows: [R('Employee Name', '{{employee.name}}'), R('Employee ID', '{{employee.code}}'), R('Pay Period', '{{pay.period}}'), R('Pay Date', '{{pay.date}}')],
      rowHeight: 27,
      labelWidth: 108,
      separator: ':',
      labelColor: SLATE,
      style: nav(10),
    },
    rule(40, 226, 272),
    rule(40, 253, 272),
    rule(40, 280, 272),
    // net pay card
    frame(351, 165, 221, 160, PINK_TINT, '#f6cfe2'),
    { type: 'text', x: 372, y: 184, w: 180, h: 18, text: 'Total Net Pay', style: nav(14, { bold: true }) },
    { type: 'text', x: 372, y: 208, w: 190, h: 32, text: '{{pay.net}}', style: { size: 24, bold: true, color: PINK } },
    rule(365, 254, 193, '#e2b6cc'),
    { type: 'details', x: 369, y: 262, w: 190, h: 54, rows: [R('Paid Days', '{{pay.paidDays}}'), R('LOP Days', '{{pay.lopDays}}')], rowHeight: 27, labelWidth: 95, separator: ':', labelColor: SLATE, style: nav(10) },
    // earnings and deductions
    frame(25, 345, 547, 207),
    band(25, 345, 285, 32, PINK_TINT),
    band(310, 345, 262, 32, BLUE_TINT),
    { type: 'table', x: 25, y: 345, w: 285, h: 172, kind: 'EARNINGS', heading: 'EARNINGS', amountHeading: 'AMOUNT (Rs.)', showTotal: false, rowHeight: 28, headerHeight: 32, cellPadding: 6, headColor: NAVY, lineColor: HAIR, lineWidth: 0.6, style: nav(10) },
    { type: 'table', x: 310, y: 345, w: 262, h: 172, kind: 'DEDUCTIONS', heading: 'DEDUCTIONS', amountHeading: 'AMOUNT (Rs.)', showTotal: false, rowHeight: 28, headerHeight: 32, cellPadding: 6, headColor: TEAL, lineColor: HAIR, lineWidth: 0.6, style: nav(10) },
    vbar(310, 345, 207),
    vbar(193, 377, 141, HAIR),
    vbar(474, 377, 141, HAIR),
    band(25, 518, 285, 34, PINK_TINT),
    { type: 'text', x: 40, y: 529, w: 140, h: 14, text: 'Gross Earnings', style: nav(11, { bold: true }) },
    { type: 'text', x: 180, y: 529, w: 120, h: 14, text: '{{pay.gross}}', style: nav(11, { bold: true, align: 'RIGHT' }) },
    band(310, 518, 262, 34, BLUE_TINT),
    { type: 'text', x: 325, y: 529, w: 130, h: 14, text: 'Total Deductions', style: nav(11, { bold: true }) },
    { type: 'text', x: 450, y: 529, w: 112, h: 14, text: '{{pay.deductions}}', style: nav(11, { bold: true, align: 'RIGHT' }) },
    // total net payable
    frame(25, 577, 547, 53, '#f7f8fa', '#d9dde3'),
    band(444, 577.5, 127.5, 52, PINK_TINT),
    { type: 'text', x: 40, y: 589, w: 250, h: 16, text: 'TOTAL NET PAYABLE', style: nav(13, { bold: true }) },
    { type: 'text', x: 40, y: 608, w: 250, h: 12, text: 'Gross Earnings - Total Deductions', style: slate(10) },
    { type: 'text', x: 452, y: 594, w: 112, h: 20, text: '{{pay.net}}', style: { size: 16, bold: true, color: PINK, align: 'RIGHT' } },
    { type: 'text', x: 25, y: 644, w: 547, h: 14, text: '{{pay.netInWords}}', lead: { text: 'Amount in Words :', color: TEAL, bold: false }, fit: true, style: nav(10, { align: 'RIGHT' }) },
    { type: 'text', x: 25, y: 664, w: 547, h: 11, text: '{{note.idle}}', style: slate(7.5) },
    { type: 'text', x: 25, y: 676, w: 547, h: 11, text: '{{note.employer}}', style: slate(7.5) },
    { type: 'text', x: 25, y: 688, w: 547, h: 11, text: '{{note.ytd}}', style: slate(7.5) },
    // notes and signatory
    rule(25, 704, 547, '#c9ced6', 0.8),
    { type: 'text', x: 28, y: 716, w: 50, h: 16, text: 'Note:', style: { size: 12, bold: true, color: PINK } },
    { type: 'text', x: 82, y: 716, w: 320, h: 12, text: '1.  This is a system-generated document and does not require a signature.', style: nav(8) },
    { type: 'text', x: 82, y: 730, w: 320, h: 12, text: '2.  For any queries, please contact HR.', style: nav(8) },
    { type: 'text', x: 82, y: 744, w: 320, h: 12, text: '3.  This is a confidential document.', style: nav(8) },
    vbar(417, 708, 56, '#f6cfe2'),
    { type: 'text', x: 425, y: 728, w: 147, h: 12, text: 'Authorised Signatory', style: nav(9, { align: 'CENTER' }) },
    { type: 'text', x: 425, y: 742, w: 147, h: 12, text: '{{company.name}}', style: nav(9, { align: 'CENTER' }) },
    // corner accents
    rule(0, 820, 493, PINK, 1.2),
    band(0, 826, 595, 16, '#f1f2f4'),
    band(494, 812, 30, 30, PINK),
    band(530, 806, 65, 36, TEAL),
  ]), 'ROBOTO');
};

export const PAYSLIP_CANVAS_PRESETS = ['CLASSIC', 'SUMMARY_CARD', 'BRANDED'] as const;
export type PayslipCanvasPreset = (typeof PAYSLIP_CANVAS_PRESETS)[number];
export const PAYSLIP_CANVAS_PRESET_LABELS: Record<PayslipCanvasPreset, string> = { CLASSIC: 'Classic', SUMMARY_CARD: 'Summary card', BRANDED: 'Branded summary' };
/** BRANDED has its own pink and teal colours; the accent only colours the other two. */
export const payslipCanvasPreset = (layout: PayslipCanvasPreset, accent = '#b68235'): PayslipCanvas => (layout === 'BRANDED' ? brandedPreset() : layout === 'SUMMARY_CARD' ? summaryPreset(accent) : classicPreset(accent));
export const DEFAULT_PAYSLIP_CANVAS: PayslipCanvas = classicPreset('#b68235');

// ── Saved payslip templates: a company keeps several named designs, picks a default, and sets one per salary structure ──
export const payslipTemplateInputSchema = z.object({ name: z.string().trim().min(2, 'Give the template a name').max(60), design: payslipCanvasSchema });
export type PayslipTemplateInput = z.infer<typeof payslipTemplateInputSchema>;
export const payslipAssignSchema = z.object({ salaryTemplateId: z.string().min(1).max(60), templateId: z.string().min(1).max(60).nullable() });
export type PayslipAssignInput = z.infer<typeof payslipAssignSchema>;
export type PayslipTemplateDto = { id: string; name: string; isDefault: boolean; design: PayslipCanvas };
export type PayslipTemplatesView = {
  templates: PayslipTemplateDto[];
  /** Active salary structures and the payslip template each one uses (null = the default template). */
  structures: { id: string; name: string; templateId: string | null }[];
  /** The pay component names salary structures use (plus the standard statutory deductions), to rename or always show. */
  components: { earnings: string[]; deductions: string[] };
  companyLogo: string | null;
  company: { name: string; address: string | null; pan: string | null };
};

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

const normLabel = (s: string) => s.trim().toLowerCase();

/** The wording printed for a pay component's row: the company's own name for it, else the payroll name. */
export function tableRowLabel(t: PayslipElementOf<'table'>, label: string): string {
  const o = t.rowOverrides.find((x) => normLabel(x.label) === normLabel(label));
  return o?.rename?.trim() ? o.rename.trim() : label;
}

/**
 * Every body row of a table as text cells: the payroll rows (renamed as the company asked), then the components it always shows
 * (as 0), then the rows it typed itself. Shared by the PDF and the editor so they always agree. `key` is the payroll name the
 * row's height / line settings follow.
 */
export function tableBodyRows(
  t: PayslipElementOf<'table'>,
  lines: { label: string; full: number | null; amount: number }[],
  fmt: (paise: number) => string,
  fill: (text: string) => string = (s) => s,
): { key: string; cells: string[] }[] {
  const earnings = t.kind === 'EARNINGS';
  const full = earnings && t.showFullMonth;
  const have = new Set(lines.map((l) => normLabel(l.label)));
  const all = [...lines, ...(t.alwaysShow ?? []).filter((l) => !have.has(normLabel(l))).map((label) => ({ label, full: earnings ? 0 : null, amount: 0 }))];
  const rows = all.map((l) => ({ key: l.label, cells: full ? [tableRowLabel(t, l.label), l.full !== null ? fmt(l.full) : '', fmt(l.amount)] : [tableRowLabel(t, l.label), fmt(l.amount)] }));
  for (const x of t.extraRows ?? []) rows.push({ key: x.label || 'Your row', cells: full ? [fill(x.label), fill(x.full), fill(x.amount)] : [fill(x.label), fill(x.amount)] });
  if (!rows.length && !earnings) rows.push({ key: 'No deductions', cells: full ? ['No deductions', '', fmt(0)] : ['No deductions', fmt(0)] });
  return rows;
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
