import { z } from 'zod';
import { CUSTOM_FONTS } from '../fonts';
import { TEXT_CASES } from './text-case';
import { payslipTemplateSchema, DEFAULT_PAYSLIP_TEMPLATE, PAYSLIP_LAYOUTS, type PayslipTemplate } from './leavepay';

// ── Payslip design v2: a payslip is a list of blocks the company can add, reorder, restyle and align ──
// Anything that varies per person is a {{field}} filled in for each employee; everything else is text typed into the design.

/** The three built-in PDF fonts, then the bundled families (see fonts.ts). */
export const PAYSLIP_FONTS = ['HELVETICA', 'TIMES', 'COURIER', 'MONTSERRAT', 'POPPINS', 'INTER', 'OPENSANS', 'ROBOTO', 'LATO', 'NUNITO', 'RALEWAY', 'PLAYFAIR', 'MERRIWEATHER', 'LORA', 'OSWALD', 'DANCING'] as const;
export const PAYSLIP_FONT_LABELS: Record<(typeof PAYSLIP_FONTS)[number], string> = {
  HELVETICA: 'Helvetica (clean)',
  TIMES: 'Times (serif)',
  COURIER: 'Courier (typewriter)',
  MONTSERRAT: 'Montserrat (modern)',
  POPPINS: 'Poppins (rounded modern)',
  INTER: 'Inter (crisp)',
  OPENSANS: 'Open Sans (friendly)',
  ROBOTO: 'Roboto (neutral)',
  LATO: 'Lato (warm)',
  NUNITO: 'Nunito (soft rounded)',
  RALEWAY: 'Raleway (light, elegant)',
  PLAYFAIR: 'Playfair Display (elegant serif)',
  MERRIWEATHER: 'Merriweather (readable serif)',
  LORA: 'Lora (book serif)',
  OSWALD: 'Oswald (condensed)',
  DANCING: 'Dancing Script (handwriting)',
};
/** The CSS font stack the editor previews each payslip font with. */
export const PAYSLIP_FONT_CSS: Record<(typeof PAYSLIP_FONTS)[number], string> = {
  HELVETICA: 'Helvetica, Arial, sans-serif',
  TIMES: "'Times New Roman', Times, serif",
  COURIER: "'Courier New', Courier, monospace",
  MONTSERRAT: CUSTOM_FONTS.montserrat.css,
  POPPINS: CUSTOM_FONTS.poppins.css,
  INTER: CUSTOM_FONTS.inter.css,
  OPENSANS: CUSTOM_FONTS.opensans.css,
  ROBOTO: CUSTOM_FONTS.roboto.css,
  LATO: CUSTOM_FONTS.lato.css,
  NUNITO: CUSTOM_FONTS.nunito.css,
  RALEWAY: CUSTOM_FONTS.raleway.css,
  PLAYFAIR: CUSTOM_FONTS.playfair.css,
  MERRIWEATHER: CUSTOM_FONTS.merriweather.css,
  LORA: CUSTOM_FONTS.lora.css,
  OSWALD: CUSTOM_FONTS.oswald.css,
  DANCING: CUSTOM_FONTS.dancing.css,
};
export const PAYSLIP_ALIGNS = ['LEFT', 'CENTER', 'RIGHT'] as const;

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a colour like #b68235');

export const payslipStyleSchema = z.object({
  font: z.enum(PAYSLIP_FONTS).default('HELVETICA'),
  size: z.coerce.number().min(6, 'Font size is at least 6').max(28, 'Font size is at most 28').default(9.5),
  bold: z.boolean().default(false),
  italic: z.boolean().default(false),
  color: hexColor.default('#201f1d'),
  align: z.enum(PAYSLIP_ALIGNS).default('LEFT'),
  textCase: z.enum(TEXT_CASES).default('NONE'),
});
export type PayslipStyle = z.infer<typeof payslipStyleSchema>;

/** The per-employee fields a design can insert as {{key}}. */
export const PAYSLIP_FIELDS: { key: string; label: string; group: string }[] = [
  { group: 'Company', key: 'company.name', label: 'Company name' },
  { group: 'Company', key: 'company.address', label: 'Company address' },
  { group: 'Company', key: 'company.pan', label: 'Company PAN' },
  { group: 'Employee', key: 'employee.name', label: 'Employee name' },
  { group: 'Employee', key: 'employee.code', label: 'Employee ID' },
  { group: 'Employee', key: 'employee.designation', label: 'Designation' },
  { group: 'Employee', key: 'employee.department', label: 'Department' },
  { group: 'Employee', key: 'employee.joiningDate', label: 'Date of joining' },
  { group: 'Employee', key: 'employee.pan', label: 'PAN (masked)' },
  { group: 'Employee', key: 'employee.uan', label: 'UAN' },
  { group: 'Employee', key: 'employee.bank', label: 'Bank account (masked) and IFSC' },
  { group: 'Pay period', key: 'pay.period', label: 'Pay period (e.g. September 2026)' },
  { group: 'Pay period', key: 'pay.date', label: 'Pay date' },
  { group: 'Pay period', key: 'pay.workingDays', label: 'Working days' },
  { group: 'Pay period', key: 'pay.paidDays', label: 'Paid days' },
  { group: 'Pay period', key: 'pay.lopDays', label: 'LOP days' },
  { group: 'Pay period', key: 'pay.leave', label: 'Leave' },
  { group: 'Pay period', key: 'pay.taxRegime', label: 'Tax regime' },
  { group: 'Amounts', key: 'pay.gross', label: 'Total earnings' },
  { group: 'Amounts', key: 'pay.deductions', label: 'Total deductions' },
  { group: 'Amounts', key: 'pay.net', label: 'Net pay' },
  { group: 'Amounts', key: 'pay.netInWords', label: 'Net pay in words' },
  { group: 'Notes', key: 'note.employer', label: 'Employer contributions sentence' },
  { group: 'Notes', key: 'note.ytd', label: 'Year-to-date sentence' },
  { group: 'Notes', key: 'note.idle', label: 'Idle-time deduction sentence' },
];

const blockId = z.string().min(1).max(40);
const spacing = (def: number) => z.coerce.number().min(0).max(80).default(def);
const rowSchema = z.object({ label: z.string().max(40), value: z.string().max(160) });
const bodyStyle = (size: number) => payslipStyleSchema.default({ size });

const textBlock = z.object({ type: z.literal('text'), id: blockId, text: z.string().max(600).default(''), style: bodyStyle(9.5), before: spacing(0), after: spacing(4) });
const headerBlock = z.object({
  type: z.literal('header'),
  id: blockId,
  /** LETTERHEAD: big company name, small caps line, accent rule. SPLIT: logo and company left, title and month right. */
  variant: z.enum(['LETTERHEAD', 'SPLIT']).default('LETTERHEAD'),
  title: z.string().max(80).default('Payslip · {{pay.period}}'),
  subtitle: z.string().max(80).default(''),
  showLogo: z.boolean().default(true),
  showAddress: z.boolean().default(true),
  nameStyle: payslipStyleSchema.default({ font: 'TIMES', size: 22, bold: true }),
});
const detailsBlock = z.object({
  type: z.literal('details'),
  id: blockId,
  /** An optional small caption above the rows, e.g. "Employee summary". */
  heading: z.string().max(40).default(''),
  rows: z.array(rowSchema).max(24).default([]),
  /** A second column of rows (ignored when the net-pay card is shown). */
  rowsRight: z.array(rowSchema).max(24).default([]),
  separator: z.string().max(2).default(''),
  labelWidth: z.coerce.number().min(50).max(180).default(95),
  labelColor: hexColor.default('#605d5d'),
  style: bodyStyle(9.5),
  card: z
    .object({ title: z.string().max(30).default('Total Net Pay'), amount: z.string().max(40).default('{{pay.net}}'), rows: z.array(rowSchema).max(6).default([]) })
    .nullable()
    .default(null),
});
const earningsBlock = z.object({ type: z.literal('earnings'), id: blockId, heading: z.string().max(40).default('Earnings'), totalLabel: z.string().max(40).default('Total earnings'), showFullMonth: z.boolean().default(true), style: bodyStyle(9.5) });
const deductionsBlock = z.object({ type: z.literal('deductions'), id: blockId, heading: z.string().max(40).default('Deductions'), totalLabel: z.string().max(40).default('Total deductions'), style: bodyStyle(9.5) });
const splitBlock = z.object({
  type: z.literal('split'),
  id: blockId,
  earningsHeading: z.string().max(40).default('Earnings'),
  deductionsHeading: z.string().max(40).default('Deductions'),
  earningsTotalLabel: z.string().max(40).default('Gross Earnings'),
  deductionsTotalLabel: z.string().max(40).default('Total Deductions'),
  style: bodyStyle(8.5),
});
const netBlock = z.object({
  type: z.literal('net'),
  id: blockId,
  /** LINE: large "Net pay  Rs. …" line. BAR: a framed "Total net payable" bar. */
  variant: z.enum(['LINE', 'BAR']).default('LINE'),
  label: z.string().max(40).default('Net pay'),
  subLabel: z.string().max(60).default('Gross Earnings - Total Deductions'),
  showWords: z.boolean().default(true),
});
const dividerBlock = z.object({ type: z.literal('divider'), id: blockId, color: hexColor.default('#d7d3d3'), thickness: z.coerce.number().min(0.25).max(4).default(0.8), dashed: z.boolean().default(false), before: spacing(2), after: spacing(8) });
const spacerBlock = z.object({ type: z.literal('spacer'), id: blockId, height: z.coerce.number().min(2).max(120).default(16) });

export const payslipBlockSchema = z.discriminatedUnion('type', [textBlock, headerBlock, detailsBlock, earningsBlock, deductionsBlock, splitBlock, netBlock, dividerBlock, spacerBlock]);
export type PayslipBlock = z.infer<typeof payslipBlockSchema>;
export type PayslipBlockType = PayslipBlock['type'];
export type PayslipRowT = z.infer<typeof rowSchema>;

export const PAYSLIP_BLOCK_LABELS: Record<PayslipBlockType, string> = {
  header: 'Header (logo, company, title)',
  details: 'Details (rows of label and value)',
  earnings: 'Earnings table',
  deductions: 'Deductions table',
  split: 'Earnings and deductions side by side',
  net: 'Net pay',
  text: 'Text',
  divider: 'Divider line',
  spacer: 'Blank space',
};

export const payslipDesignSchema = z
  .object({
    version: z.literal(2).default(2),
    accentColor: hexColor.default('#b68235'),
    logoMode: z.enum(['NONE', 'COMPANY', 'CUSTOM']).default('NONE'),
    customLogo: z
      .string()
      .max(340_000, 'The logo is too large (250 KB at most)')
      .regex(/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/, 'Upload a PNG or JPEG image')
      .nullable()
      .default(null),
    blocks: z.array(payslipBlockSchema).min(1, 'Add at least one block').max(40, 'At most 40 blocks'),
  })
  .refine((v) => v.logoMode !== 'CUSTOM' || !!v.customLogo, { message: 'Upload a logo, or choose another logo option', path: ['customLogo'] })
  .refine((v) => new Set(v.blocks.map((b) => b.id)).size === v.blocks.length, { message: 'Each block needs its own id' });
export type PayslipDesign = z.infer<typeof payslipDesignSchema>;

/** A new, empty block of a type (defaults filled in). */
export function newPayslipBlock(type: PayslipBlockType, id: string): PayslipBlock {
  const extra: Record<string, unknown> =
    type === 'details'
      ? { rows: [{ label: 'Employee', value: '{{employee.name}}' }, { label: 'Employee ID', value: '{{employee.code}}' }] }
      : type === 'text'
        ? { text: 'Your text here' }
        : {};
  return payslipBlockSchema.parse({ type, id, ...extra });
}

const cap = (s: string) => s.split(' ').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

/** Turn a v1 settings-style template into the equivalent block design. */
export function upgradePayslipTemplate(t: PayslipTemplate): PayslipDesign {
  const f = t.fields;
  const summary = t.layout === 'SUMMARY_CARD';
  let n = 0;
  const id = () => `b${++n}`;
  const R = (label: string, value: string) => ({ label, value });
  const muted = { size: 8.5, color: '#605d5d' };
  const blocks: unknown[] = [];

  blocks.push({
    type: 'header',
    id: id(),
    variant: summary ? 'SPLIT' : 'LETTERHEAD',
    title: summary ? `${t.title} for the month` : `${t.title} · {{pay.period}}`,
    subtitle: summary ? '{{pay.period}}' : '',
    showLogo: true,
    showAddress: t.showAddress,
    nameStyle: summary ? { font: 'HELVETICA', size: 15, bold: true } : { font: 'TIMES', size: 22, bold: true },
  });

  const person = [R(summary ? 'Employee Name' : 'Employee', '{{employee.name}}'), R(summary ? 'Employee ID' : 'Employee ID', '{{employee.code}}')];
  if (f.designation) person.push(R('Designation', '{{employee.designation}}'));
  if (f.department) person.push(R('Department', '{{employee.department}}'));
  if (f.joiningDate) person.push(R(summary ? 'Date of Joining' : 'Date of joining', '{{employee.joiningDate}}'));
  if (summary) person.push(R('Pay Period', '{{pay.period}}'), R('Pay Date', '{{pay.date}}'));
  if (f.pan) person.push(R('PAN', '{{employee.pan}}'));
  if (f.uan) person.push(R('UAN', '{{employee.uan}}'));
  if (summary) {
    if (f.bankAccount) person.push(R('Bank Account', '{{employee.bank}}'));
    blocks.push({
      type: 'details',
      id: id(),
      heading: 'Employee summary',
      rows: person,
      separator: ':',
      labelWidth: 92,
      card: { title: `Total ${cap(t.labels.netPay)}`, amount: '{{pay.net}}', rows: f.attendance ? [R('Paid Days', '{{pay.paidDays}}'), R('LOP Days', '{{pay.lopDays}}')] : [] },
    });
  } else {
    const pay = [R('Pay period', '{{pay.period}}'), R('Pay date', '{{pay.date}}')];
    if (f.attendance) pay.push(R('Working days', '{{pay.workingDays}}'), R('Paid days', '{{pay.paidDays}}'), R('LOP days', '{{pay.lopDays}}'), R('Leave', '{{pay.leave}}'));
    if (f.bankAccount) pay.push(R('Bank account', '{{employee.bank}}'));
    blocks.push({ type: 'details', id: id(), rows: person, rowsRight: pay });
  }

  if (summary) {
    blocks.push({ type: 'split', id: id(), earningsHeading: t.labels.earnings, deductionsHeading: t.labels.deductions });
    blocks.push({ type: 'net', id: id(), variant: 'BAR', label: 'Total net payable', showWords: f.netInWords });
  } else {
    blocks.push({ type: 'earnings', id: id(), heading: t.labels.earnings, showFullMonth: f.fullMonthColumn });
    blocks.push({ type: 'deductions', id: id(), heading: t.labels.deductions });
    blocks.push({ type: 'net', id: id(), variant: 'LINE', label: t.labels.netPay, showWords: f.netInWords });
  }

  if (f.idleNote) blocks.push({ type: 'text', id: id(), text: '{{note.idle}}', style: muted, after: 0 });
  if (f.employerContributions) blocks.push({ type: 'text', id: id(), text: '{{note.employer}}', style: muted, after: 0 });
  if (f.yearToDate) blocks.push({ type: 'text', id: id(), text: '{{note.ytd}}', style: muted, after: 0 });
  if (summary) blocks.push({ type: 'divider', id: id(), before: 10 });
  else blocks.push({ type: 'spacer', id: id(), height: 24 });
  if (t.footerNote) blocks.push({ type: 'text', id: id(), text: t.footerNote, style: { ...muted, align: 'CENTER' }, after: 6 });
  if (t.showSystemLine) blocks.push({ type: 'text', id: id(), text: 'This is a computer-generated payslip and does not require a signature.', style: { size: 7.5, color: '#605d5d', align: 'CENTER' } });

  return payslipDesignSchema.parse({ version: 2, accentColor: t.accentColor, logoMode: t.logoMode, customLogo: t.customLogo, blocks });
}

/** The two starting templates offered in the editor. */
export const PAYSLIP_PRESET_LABELS: Record<(typeof PAYSLIP_LAYOUTS)[number], string> = { CLASSIC: 'Classic', SUMMARY_CARD: 'Summary card' };
export const payslipPreset = (layout: (typeof PAYSLIP_LAYOUTS)[number]): PayslipDesign => upgradePayslipTemplate(payslipTemplateSchema.parse({ layout }));
export const DEFAULT_PAYSLIP_DESIGN: PayslipDesign = upgradePayslipTemplate(DEFAULT_PAYSLIP_TEMPLATE);
