import { describe, expect, it } from 'vitest';
import { DEFAULT_PAYSLIP_DESIGN, newPayslipBlock, payslipDesignSchema, payslipPreset, payslipTemplateSchema, upgradePayslipTemplate, type PayslipBlock, type PayslipDesign } from '@lexisora/shared';
import { PdfService } from '../../../core/pdf/pdf.service';
import { fieldValues, fillFields, fontFor, renderBlocks } from './payslip-blocks';
import { renderPayslip, samplePayslip } from './payslip-render';

const pdf = new PdfService();
const company = { name: 'Acme Pvt Ltd', address: '5 Test Street, Pondicherry', pan: 'AAAAA0000A' };
const sample = samplePayslip(company, '2026-09');
const PNG_1X1 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

const design = (blocks: unknown[], over: Record<string, unknown> = {}): PayslipDesign => payslipDesignSchema.parse({ blocks, ...over });
let n = 0;
const id = () => `t${++n}`;

async function render(d: PayslipDesign, detail = sample, logo: Buffer | null = null) {
  const buf = await renderBlocks(pdf, detail, d, logo, { compress: false });
  expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
  const raw = buf.toString('latin1');
  let text = '';
  for (const m of raw.matchAll(/<([0-9a-fA-F]{2,})>/g)) text += Buffer.from(m[1]!, 'hex').toString('latin1');
  return { raw, text };
}

describe('fields', () => {
  it('fills {{fields}} from the employee, and an unknown field is blank', () => {
    const v = fieldValues(sample);
    expect(fillFields('Hi {{employee.name}} ({{ employee.code }}) {{nope.field}}!', v)).toBe('Hi Sample Employee (EMP-0001) !');
    expect(v['pay.net']).toBe('Rs. 89,600.00');
    expect(v['pay.period']).toBe('September 2026');
    expect(v['employee.bank']).toBe('XXXX XXXX 4321 · HDFC0001234');
    expect(v['note.idle']).toBe(''); // no idle deduction in the sample
    expect(v['note.employer']).toContain('PF (employer) Rs. 1,800.00');
  });

  it('the idle note appears only when there is idle time', () => {
    expect(fieldValues({ ...sample, idleMinutes: 90 })['note.idle']).toContain('1h 30m');
  });
});

describe('block rendering', () => {
  it('a custom text block shows the typed text with the employee\'s own values', async () => {
    const { text } = await render(design([{ type: 'text', id: id(), text: 'Dear {{employee.name}}, your net pay is {{pay.net}}.' }]));
    expect(text).toContain('Dear Sample Employee, your net pay is Rs. 89,600.00.');
  });

  it('font family, bold and italic choose the PDF font', async () => {
    const mk = (font: string, bold: boolean, italic: boolean) => design([{ type: 'text', id: id(), text: 'X', style: { font, bold, italic, size: 12 } }]);
    expect((await render(mk('COURIER', true, false))).raw).toContain('/BaseFont /Courier-Bold');
    expect((await render(mk('TIMES', false, true))).raw).toContain('/BaseFont /Times-Italic');
    expect((await render(mk('HELVETICA', true, true))).raw).toContain('/BaseFont /Helvetica-BoldOblique');
    expect(fontFor({ font: 'TIMES', bold: true, italic: false })).toBe('Times-Bold');
  });

  it('size and alignment are applied (the text block moves right when aligned right)', async () => {
    const x = async (alignment: string) => {
      const { raw } = await render(design([{ type: 'text', id: id(), text: 'Aligned', style: { align: alignment, size: 12 } }]));
      const m = /1 0 0 1 ([\d.]+) ([\d.]+) Tm/.exec(raw);
      return Number(m![1]);
    };
    const [l, c, r] = [await x('LEFT'), await x('CENTER'), await x('RIGHT')];
    expect(c).toBeGreaterThan(l);
    expect(r).toBeGreaterThan(c);
  });

  it('a line made only of empty fields is left out', async () => {
    const withIdle = await render(design([{ type: 'text', id: id(), text: '{{note.idle}}' }]), { ...sample, idleMinutes: 90 });
    expect(withIdle.text).toContain('Deducted idle time');
    const none = await render(design([{ type: 'text', id: id(), text: '{{note.idle}}' }, { type: 'text', id: id(), text: 'kept' }]));
    expect(none.text).not.toContain('Deducted idle time');
    expect(none.text).toContain('kept');
  });

  it('details: added rows appear with their fields; an empty value shows a dash; two columns and separator work', async () => {
    const d = design([
      {
        type: 'details',
        id: id(),
        separator: ':',
        rows: [{ label: 'Cost centre', value: 'CC-{{employee.code}}' }, { label: 'Manager', value: '{{employee.nothing}}' }],
        rowsRight: [{ label: 'Shift', value: 'General' }],
      },
    ]);
    const { text } = await render(d);
    expect(text).toContain('Cost centre');
    expect(text).toContain('CC-EMP-0001');
    expect(text).toContain('Manager');
    expect(text).toContain(''); // empty value → an em dash (WinAnsi 0x97)
    expect(text).toContain('General');
  });

  it('earnings, deductions, net pay and the side-by-side block print the employee\'s own lines', async () => {
    const { text } = await render(design([{ type: 'earnings', id: id(), heading: 'Pay components' }, { type: 'deductions', id: id(), heading: 'Recoveries' }, { type: 'split', id: id() }, { type: 'net', id: id(), variant: 'LINE', label: 'Take-home' }, { type: 'net', id: id(), variant: 'BAR', label: 'Total net payable' }]));
    for (const s of ['PAY COMPONENTS', 'RECOVERIES', 'Basic', 'Rs. 45,000.00', 'Provident fund', 'Gross Earnings', 'Total Deductions', 'Take-home  Rs. 89,600.00', 'TOTAL NET PAYABLE', 'Amount In Words']) expect(text).toContain(s);
  });

  it('with no deductions the table says so; the "Full month" column can be hidden', async () => {
    const none = { ...sample, deductions: [], totalDeductionsPaise: 0 };
    expect((await render(design([{ type: 'deductions', id: id() }]), none)).text).toContain('No deductions');
    const noFull = (await render(design([{ type: 'earnings', id: id(), showFullMonth: false }]))).text;
    expect(noFull).not.toContain('FULL MONTH');
    expect((await render(design([{ type: 'earnings', id: id() }]))).text).toContain('FULL MONTH');
  });

  it('dividers and spacers render, and a broken logo never stops the payslip', async () => {
    const d = design([{ type: 'header', id: id() }, { type: 'divider', id: id(), dashed: true }, { type: 'spacer', id: id(), height: 30 }, { type: 'text', id: id(), text: 'after' }], { logoMode: 'CUSTOM', customLogo: PNG_1X1 });
    expect((await render(d, sample, Buffer.from('not an image'))).text).toContain('after');
    expect((await render(d, sample, Buffer.from(PNG_1X1.split(',')[1]!, 'base64'))).text).toContain('Acme Pvt Ltd');
  });

  it('a long payslip flows onto a second page instead of overflowing', async () => {
    const big = { ...sample, earnings: Array.from({ length: 45 }, (_, i) => ({ label: `Allowance number ${i + 1}`, fullPaise: 100_000, amountPaise: 100_000 })) };
    const { raw, text } = await render(design([{ type: 'header', id: id() }, { type: 'earnings', id: id() }, { type: 'net', id: id() }]), big);
    expect(text).toContain('Allowance number 45');
    expect(raw).toMatch(/\/Type \/Pages[\s\S]{0,80}\/Count [2-9]/);
  });
});

describe('starting templates and upgrading the older template', () => {
  const expected = ['Acme Pvt Ltd', 'Sample Employee', 'EMP-0001', 'Software Engineer', 'Engineering', '2024-04-01', '100123456789', 'Provident fund', 'Professional tax', 'Rs. 45,000.00', 'Rs. 91,600.00', 'Rs. 89,600.00', 'Eighty-nine thousand six hundred rupees only', 'Employer contributions', 'Year to date', 'computer-generated'];

  it.each(['CLASSIC', 'SUMMARY_CARD'] as const)('%s as blocks prints everything the older layout printed', async (layout) => {
    const legacy = await renderPayslip(pdf, sample, payslipTemplateSchema.parse({ layout }), null, { compress: false });
    const decode = (b: Buffer) => [...b.toString('latin1').matchAll(/<([0-9a-fA-F]{2,})>/g)].map((m) => Buffer.from(m[1]!, 'hex').toString('latin1')).join('');
    const old = decode(legacy);
    const blocks = (await render(payslipPreset(layout))).text;
    for (const s of expected) {
      expect(old).toContain(s);
      expect(blocks).toContain(s);
    }
    // the same distinct words appear in both (order and layout aside)
    const clean = (t: string) => (t.includes('signature.') ? t.slice(0, t.lastIndexOf('signature.') + 10) : t); // drop the PDF trailer bytes after the last line
    const words = (t: string) => new Set(clean(t).toLowerCase().match(/[a-z0-9][a-z0-9.,-]*/g));
    const missing = [...words(old)].filter((w) => !words(blocks).has(w) && w.length > 2);
    expect(missing).toEqual([]);
  });

  it('the default design is the Classic starting template', () => {
    expect(DEFAULT_PAYSLIP_DESIGN).toEqual(payslipPreset('CLASSIC'));
  });

  it('upgrading honours the older switches, labels, title and footer note', async () => {
    const up = upgradePayslipTemplate(payslipTemplateSchema.parse({ title: 'Salary slip', labels: { earnings: 'Pay', deductions: 'Cuts', netPay: 'Take-home' }, footerNote: 'Mail hr@acme.test', showSystemLine: false, fields: { pan: false, uan: false, bankAccount: false, fullMonthColumn: false, yearToDate: false } }));
    const { text } = await render(up);
    for (const s of ['SALARY SLIP', 'PAY', 'CUTS', 'Take-home', 'Mail hr@acme.test']) expect(text).toContain(s);
    for (const s of ['PAN', 'UAN', 'Bank account', 'FULL MONTH', 'Year to date', 'computer-generated']) expect(text).not.toContain(s);
  });
});

describe('design schema', () => {
  const b = (over: Record<string, unknown>) => ({ type: 'text', id: 'a', ...over });

  it('accepts a valid design and fills defaults', () => {
    const d = payslipDesignSchema.parse({ blocks: [b({ text: 'hi' })] });
    expect(d).toMatchObject({ version: 2, accentColor: '#b68235', logoMode: 'NONE' });
    expect((d.blocks[0] as Extract<PayslipBlock, { type: 'text' }>).style).toMatchObject({ font: 'HELVETICA', size: 9.5, align: 'LEFT' });
  });

  it('rejects bad sizes, fonts, colours, duplicate ids, empty and oversized designs, unknown block types', () => {
    const ok = (blocks: unknown[], over = {}) => payslipDesignSchema.safeParse({ blocks, ...over }).success;
    expect(ok([b({ style: { size: 3 } })])).toBe(false);
    expect(ok([b({ style: { size: 40 } })])).toBe(false);
    expect(ok([b({ style: { font: 'COMIC' } })])).toBe(false);
    expect(ok([b({ style: { color: 'red' } })])).toBe(false);
    expect(ok([b({}), b({})])).toBe(false);
    expect(ok([])).toBe(false);
    expect(ok(Array.from({ length: 41 }, (_, i) => b({ id: `x${i}` })))).toBe(false);
    expect(ok([{ type: 'script', id: 'z' }])).toBe(false);
    expect(ok([b({})], { accentColor: 'blue' })).toBe(false);
    expect(ok([b({})], { logoMode: 'CUSTOM' })).toBe(false);
    expect(ok([b({})], { logoMode: 'CUSTOM', customLogo: PNG_1X1 })).toBe(true);
  });

  it('every block type can be created with defaults', () => {
    for (const t of ['text', 'header', 'details', 'earnings', 'deductions', 'split', 'net', 'divider', 'spacer'] as const) expect(newPayslipBlock(t, 'x').type).toBe(t);
  });
});
