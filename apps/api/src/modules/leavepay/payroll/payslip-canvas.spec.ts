import { describe, expect, it } from 'vitest';
import { PAYSLIP_CANVAS_PRESETS, bakeCompanyFields, newPayslipElement, payslipLabelsToText, planPayslipTable, payslipTextToLabels, payslipCanvasPreset, payslipCanvasSchema, type PayslipCanvas } from '@lexisora/shared';
import { PdfService } from '../../../core/pdf/pdf.service';
import { renderPayslip, samplePayslip } from './payslip-render';

const pdf = new PdfService();
const sample = samplePayslip({ name: 'Acme Pvt Ltd', address: '5 Test Street, Pondicherry', pan: 'AAAAA0000A' }, '2026-09');

/** All text drawn on the page: pdfkit writes it as <hex> strings; compression is off in tests. */
async function text(design: PayslipCanvas) {
  const buf = await renderPayslip(pdf, sample, design, null, { compress: false });
  expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
  const raw = buf.toString('latin1');
  let out = '';
  for (const m of raw.matchAll(/<([0-9a-fA-F]{2,})>/g)) out += Buffer.from(m[1]!, 'hex').toString('latin1');
  return { out, pages: (raw.match(/\/Type \/Page\b/g) ?? []).length };
}

describe('payslip canvas design', () => {
  it.each(PAYSLIP_CANVAS_PRESETS)('the %s template is valid and renders the payroll amounts on one page', async (layout) => {
    const design = payslipCanvasPreset(layout);
    expect(payslipCanvasSchema.safeParse(design).success).toBe(true);
    const { out, pages } = await text(design);
    for (const s of ['Acme Pvt Ltd', 'Sample Employee', 'Provident fund', 'Basic', '89,600.00']) expect(out).toContain(s);
    expect(pages).toBe(1);
  });

  it('text is exactly what was typed; fields are filled only where inserted', async () => {
    const design = payslipCanvasSchema.parse({ elements: [{ ...newPayslipElement('text', 'a', 50, 50), text: 'Typed by hand — {{employee.name}}', w: 400 }, { ...newPayslipElement('text', 'b', 50, 100), text: '{{note.idle}}' }] });
    const { out } = await text(design);
    expect(out).toContain('Typed by hand');
    expect(out).toContain('Sample Employee');
  });

  it('a table keeps its place and takes its rows from payroll; the typed headings are used', async () => {
    const design = payslipCanvasSchema.parse({ elements: [{ ...newPayslipElement('table', 't', 100, 300), kind: 'DEDUCTIONS', heading: 'Recoveries', totalLabel: 'Sum of recoveries' }] });
    const { out } = await text(design);
    for (const s of ['RECOVERIES', 'Provident fund', 'Professional tax', 'Sum of recoveries']) expect(out).toContain(s);
    expect(out).not.toContain('Basic');
  });

  it('rejects elements placed off the page', () => {
    expect(payslipCanvasSchema.safeParse({ elements: [{ ...newPayslipElement('text', 'a'), x: 9999 }] }).success).toBe(false);
  });

  it('company details become plain typed text; employee values are shown as [Readable label] and stored as fields', () => {
    const baked = bakeCompanyFields(payslipCanvasPreset('CLASSIC'), { name: 'Acme Pvt Ltd', address: '5 Test Street', pan: 'AAAAA0000A' });
    const texts = baked.elements.flatMap((e) => (e.type === 'text' ? [e.text] : []));
    expect(texts).toContain('Acme Pvt Ltd');
    expect(texts).toContain('5 Test Street');
    expect(JSON.stringify(baked)).not.toContain('company.');
    expect(JSON.stringify(baked)).toContain('{{employee.name}}'); // still filled in from payroll
    const shown = payslipTextToLabels('Net pay  {{pay.net}} for {{employee.name}}');
    expect(shown).toBe('Net pay  [Net pay] for [Employee name]');
    expect(payslipLabelsToText(shown)).toBe('Net pay  {{pay.net}} for {{employee.name}}');
    expect(payslipLabelsToText('[not a field] stays')).toBe('[not a field] stays');
  });

  it('a box can round only its top corners and still render', async () => {
    const design = payslipCanvasSchema.parse({ elements: [{ ...newPayslipElement('box', 'b', 100, 100), w: 200, h: 60, fill: '#d9f0e3', border: null, radius: 8, corners: 'TOP' }] });
    expect(design.elements[0]).toMatchObject({ corners: 'TOP' });
    const { out, pages } = await text(design);
    expect(pages).toBe(1);
    expect(payslipCanvasSchema.parse({ elements: [newPayslipElement('box', 'c')] }).elements[0]).toMatchObject({ corners: 'ALL' }); // older designs keep all four
  });

  it('a table plans each row on its own: height, line and space follow the component name', () => {
    const t = payslipCanvasSchema.parse({
      elements: [{ ...newPayslipElement('table', 't'), rowHeight: 20, rules: true, headerGap: 4, totalGap: 6, rowOverrides: [{ label: 'basic', height: 30, gapAfter: 8, line: 'HIDE' }, { label: 'HRA', line: 'SHOW' }] }],
    }).elements[0]!;
    if (t.type !== 'table') throw new Error('table expected');
    const plan = planPayslipTable(t, ['Basic', 'HRA', 'Conveyance']);
    expect(plan.map((r) => [r.kind, r.height, r.line, r.gapBefore, r.gapAfter])).toEqual([
      ['head', 20, true, 0, 4],
      ['row', 30, false, 0, 8], // Basic: taller, no line, space after (matched ignoring case)
      ['row', 20, true, 0, 0],
      ['row', 20, true, 0, 0],
      ['total', 20, true, 6, 0],
    ]);
    const noLines = planPayslipTable({ ...t, rules: false, headerLine: true, totalLine: null }, ['Basic']);
    expect(noLines.map((r) => r.line)).toEqual([true, false, false]); // heading line forced on, the rest follow "no lines"
  });

  it('a table with row overrides and dashed lines still renders on one page, and older tables keep working', async () => {
    const design = payslipCanvasSchema.parse({ elements: [{ ...newPayslipElement('table', 't', 50, 100), rowOverrides: [{ label: 'Basic', gapAfter: 10 }], lineDashed: true, lineColor: '#ff0000' }, { ...newPayslipElement('table', 'u', 50, 400), kind: 'DEDUCTIONS' }] });
    const { out, pages } = await text(design);
    expect(pages).toBe(1);
    expect(out).toContain('Basic');
    expect(out).toContain('Provident fund');
  });

  it('text case applies to typed text, employee values, details values and table row names, not to the amounts', async () => {
    const design = payslipCanvasSchema.parse({
      elements: [
        { ...newPayslipElement('text', 'a', 50, 50), text: 'Salary slip for {{employee.name}}', w: 400, style: { textCase: 'UPPER' } },
        { ...newPayslipElement('details', 'd', 50, 100), rows: [{ label: 'Role', value: '{{employee.designation}}' }], style: { textCase: 'LOWER' } },
        { ...newPayslipElement('table', 't', 50, 200), style: { textCase: 'UPPER' } },
      ],
    });
    const { out } = await text(design);
    expect(out).toContain('SALARY SLIP FOR SAMPLE EMPLOYEE');
    expect(out).toContain('software engineer');
    expect(out).toContain('BASIC');
    expect(out).toContain('Rs. 45,000.00'); // amounts stay as they are
    expect(payslipCanvasSchema.parse({ elements: [newPayslipElement('text', 'x')] }).elements[0]).toMatchObject({ style: { textCase: 'NONE' } });
  });
});
