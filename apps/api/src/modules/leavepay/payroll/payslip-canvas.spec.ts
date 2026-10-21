import { describe, expect, it } from 'vitest';
import { CUSTOM_FONTS, PAYSLIP_FONTS, applyPayslipFont, PAYSLIP_CANVAS_PRESETS, bakeCompanyFields, newPayslipElement, payslipLabelsToText, planPayslipTable, payslipTextToLabels, payslipCanvasPreset, payslipCanvasSchema, type PayslipCanvas } from '@lexisora/shared';
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
    // The text check below reads plain PDF text, which embedded fonts do not store; the Roboto output has its own test.
    const design = applyPayslipFont(payslipCanvasPreset(layout), 'HELVETICA');
    expect(payslipCanvasSchema.safeParse(payslipCanvasPreset(layout)).success).toBe(true);
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

describe('editable table headings and rows', () => {
  const table = (over: Record<string, unknown>) => payslipCanvasSchema.parse({ elements: [{ ...newPayslipElement('table', 't', 50, 100), ...over }] });

  it('a design saved before these options existed still renders', async () => {
    const parsed = table({}).elements[0] as unknown as Record<string, unknown>;
    const { alwaysShow: _a, extraRows: _x, headStyle: _h, ...old } = parsed;
    const design = { ...table({}), elements: [{ ...old, rowOverrides: [{ label: 'Basic', height: 0, gapAfter: 0, line: 'DEFAULT' }] }] } as unknown as PayslipCanvas;
    const { out } = await text(design);
    expect(out).toContain('EARNINGS');
    expect(out).toContain('Basic');
  });

  it('cell padding defaults to 3 and keeps the text on the page when raised', async () => {
    expect(table({}).elements[0]).toMatchObject({ cellPadding: 3 });
    const { out } = await text(table({ cellPadding: 12 }));
    expect(out).toContain('Rs. 45,000.00');
    expect(payslipCanvasSchema.safeParse({ elements: [{ ...table({}).elements[0], cellPadding: 99 }] }).success).toBe(false);
  });

  it('older designs load with the standard look and no extra rows', () => {
    const t = payslipCanvasSchema.parse({ elements: [{ type: 'table', id: 't', rowOverrides: [{ label: 'Basic' }] }] }).elements[0]!;
    expect(t).toMatchObject({ headStyle: null, alwaysShow: [], extraRows: [], rowOverrides: [{ label: 'Basic', rename: '' }] });
  });

  it("prints the company's own wording for a pay component", async () => {
    const { out } = await text(table({ rowOverrides: [{ label: 'HRA', rename: 'House Rent Allowance (HRA)' }] }));
    expect(out).toContain('House Rent Allowance (HRA)');
    expect(out).toContain('Basic');
  });

  it('keeps a component on the page when its amount is zero', async () => {
    const { out } = await text(table({ kind: 'DEDUCTIONS', heading: 'Deductions', alwaysShow: ['Income tax (TDS)'] }));
    expect(out).toContain('Provident fund');
    expect(out).toContain('Income tax (TDS)');
    expect(out).toContain('Rs. 0.00');
  });

  it('prints rows the company typed, with fields filled in', async () => {
    const { out } = await text(table({ extraRows: [{ label: 'Reimbursement', amount: 'Rs. 500.00' }, { label: 'Paid days', amount: '{{pay.paidDays}}' }] }));
    for (const x of ['Reimbursement', 'Rs. 500.00', 'Paid days']) expect(out).toContain(x);
  });

  it('headings are UPPERCASE by default and follow the company style when one is set', async () => {
    expect((await text(table({ heading: 'Earnings' }))).out).toContain('EARNINGS');
    const custom = (await text(table({ heading: 'Earnings', headStyle: { size: 10, bold: true, color: '#12a3c6' } }))).out;
    expect(custom).toContain('Earnings');
    expect(custom).not.toContain('EARNINGS');
  });
});

describe('a label in its own colour in front of the text', () => {
  const line = (over: Record<string, unknown>) => payslipCanvasSchema.parse({ elements: [{ ...newPayslipElement('text', 'w', 50, 100), w: 500, h: 14, text: '{{pay.netInWords}}', lead: { text: 'Amount in words :', color: '#12a3c6', bold: true }, ...over }] });

  it('older text elements load without a label and without the one-line option', () => {
    expect(payslipCanvasSchema.parse({ elements: [newPayslipElement('text', 'x')] }).elements[0]).toMatchObject({ lead: null, fit: false });
  });

  it('prints the label and the text, whatever side they are aligned to', async () => {
    for (const align of ['LEFT', 'CENTER', 'RIGHT']) {
      const { out } = await text(line({ style: { align, size: 10 } }));
      expect(out).toContain('Amount in words :');
      expect(out).toContain('Eighty-nine thousand six hundred rupees only');
    }
  });

  it('a very long value is shrunk to one line, or wraps in a taller box, and is never lost', async () => {
    for (const fit of [true, false]) {
      const { out, pages } = await text(line({ w: 200, h: fit ? 14 : 40, fit, text: 'One crore twenty-three lakh forty-five thousand six hundred and seventy-eight rupees and ninety-nine paise only' }));
      expect(out).toContain('Amount in words :');
      expect(out).toContain('One crore twenty-three lakh');
      expect(pages).toBe(1);
    }
  });

  it('a line whose value is empty is left out, label and all', async () => {
    const { out } = await text(line({ text: '{{note.idle}}' }));
    expect(out).not.toContain('Amount in words :');
  });
});

describe('payslip fonts', () => {
  const BUILT_IN = ['HELVETICA', 'TIMES', 'COURIER'];
  it.each(PAYSLIP_FONTS)('%s renders, plain and bold italic', async (font) => {
    for (const style of [{}, { bold: true, italic: true }]) {
      const design = payslipCanvasSchema.parse({ elements: [{ ...newPayslipElement('text', 'a', 50, 50), w: 400, text: 'Net pay Rs. 89,600.00 · Sample Employee', style: { font, ...style } }] });
      const buf = await renderPayslip(pdf, sample, design, null);
      expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
      // a bundled family is embedded under its own name (not silently printed in Helvetica)
      if (!BUILT_IN.includes(font)) expect(buf.toString('latin1')).toMatch(new RegExp(`BaseFont /[A-Z]{6}[+]${CUSTOM_FONTS[font.toLowerCase() as keyof typeof CUSTOM_FONTS].label.split(' ')[0]}`));
    }
  });

  it('the Branded summary uses Roboto in every section, headings included', async () => {
    const design = payslipCanvasPreset('BRANDED');
    const fonts = design.elements.flatMap((e) => (e.type === 'text' || e.type === 'details' ? [e.style.font] : e.type === 'table' ? [e.style.font, e.headStyle?.font] : []));
    expect(fonts.length).toBeGreaterThan(20);
    expect(new Set(fonts)).toEqual(new Set(['ROBOTO']));
    const buf = await renderPayslip(pdf, sample, design, null);
    const raw = buf.toString('latin1');
    expect(raw).toMatch(/BaseFont \/[A-Z]{6}[+]Roboto/);
    expect(raw).not.toMatch(/BaseFont \/Helvetica/);
  });

  it('one font for the whole template keeps sizes, bold and colours', () => {
    const before = payslipCanvasPreset('CLASSIC');
    const after = applyPayslipFont(before, 'LORA');
    expect(after.elements.length).toBe(before.elements.length);
    after.elements.forEach((e, i) => {
      const b = before.elements[i]!;
      if (e.type === 'text' && b.type === 'text') expect(e.style).toEqual({ ...b.style, font: 'LORA' });
      if (e.type === 'table') expect(e.headStyle).toMatchObject({ font: 'LORA', bold: true, textCase: 'UPPER' });
      if (e.type === 'line' || e.type === 'box') expect(e).toEqual(b);
    });
  });

  it('every designer font has its file bundled on the server', async () => {
    const { existsSync } = await import('node:fs');
    const { join } = await import('node:path');
    for (const f of Object.values(CUSTOM_FONTS)) for (const w of [400, 700]) expect(existsSync(join(process.cwd(), 'assets', 'fonts', `${f.file}-${w}-normal.ttf`)), `${f.file} ${w}`).toBe(true);
  });
});
