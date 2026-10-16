import { describe, expect, it } from 'vitest';
import { DEFAULT_PAYSLIP_TEMPLATE, payslipTemplateSchema, type PayslipTemplate } from '@lexisora/shared';
import { PdfService } from '../../../core/pdf/pdf.service';
import { logoFromDataUrl, renderPayslip, samplePayslip, tint } from './payslip-render';

const pdf = new PdfService();
const company = { name: 'Acme Pvt Ltd', address: '5 Test Street, Pondicherry', pan: 'AAAAA0000A' };
const sample = samplePayslip(company, '2026-09');
// 1x1 transparent PNG
const PNG_1X1 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

const tpl = (over: Record<string, unknown> = {}): PayslipTemplate => payslipTemplateSchema.parse(over);

/** All text drawn on the page: pdfkit writes it as <hex> strings; compression is off in tests. */
async function text(t: PayslipTemplate, logo: Buffer | null = null, d = sample) {
  const buf = await renderPayslip(pdf, d, t, logo, { compress: false });
  expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
  const raw = buf.toString('latin1');
  let out = '';
  for (const m of raw.matchAll(/<([0-9a-fA-F]{2,})>/g)) out += Buffer.from(m[1]!, 'hex').toString('latin1');
  return out;
}

describe('payslip design', () => {
  it('the default is today\'s payslip: Classic, no logo, every field and the system line', async () => {
    expect(DEFAULT_PAYSLIP_TEMPLATE).toMatchObject({ layout: 'CLASSIC', logoMode: 'NONE', title: 'Payslip', showAddress: true, showSystemLine: true, footerNote: '' });
    const t = await text(DEFAULT_PAYSLIP_TEMPLATE);
    for (const s of ['Acme Pvt Ltd', 'Sample Employee', 'Designation', 'PAN', 'UAN', 'Bank account', 'FULL MONTH', 'EARNED', 'Provident fund', 'Net pay', 'Year to date', 'Employer contributions', 'computer-generated']) expect(t).toContain(s);
  });

  it('Classic honours the switches, labels, title and footer note', async () => {
    const t = await text(tpl({ title: 'Salary slip', labels: { earnings: 'Pay components', deductions: 'Recoveries', netPay: 'Take-home' }, footerNote: 'Questions? Mail hr@acme.test', showSystemLine: false, showAddress: false, fields: { pan: false, uan: false, bankAccount: false, fullMonthColumn: false, yearToDate: false, employerContributions: false, netInWords: false } }));
    expect(t).toContain('SALARY SLIP'); // the title line prints in capitals
    for (const s of ['PAY COMPONENTS', 'RECOVERIES', 'Take-home', 'Questions? Mail hr@acme.test']) expect(t).toContain(s);
    for (const s of ['PAN', 'UAN', 'Bank account', 'FULL MONTH', 'Year to date', 'Employer contributions', 'computer-generated', 'Pondicherry']) expect(t).not.toContain(s);
    expect(t).toContain('Designation'); // still on
  });

  it('Summary card draws the company header, employee summary, net-pay card, both columns and the net payable bar', async () => {
    const t = await text(tpl({ layout: 'SUMMARY_CARD' }));
    for (const s of ['Acme Pvt Ltd', 'Pondicherry', 'Payslip for the month', 'September 2026', 'EMPLOYEE SUMMARY', 'Employee Name', 'Sample Employee', 'Total Net Pay', 'Paid Days', 'LOP Days', 'EARNINGS', 'DEDUCTIONS', 'Gross Earnings', 'Total Deductions', 'TOTAL NET PAYABLE', 'Amount In Words', 'Provident fund', 'computer-generated']) expect(t).toContain(s);
    expect(t).toContain('Rs. 89,600.00'); // 45,000 + 22,500 + 22,500 + 1,600 = 91,600 gross − 2,000 deductions
  });

  it('Summary card honours the switches and custom labels', async () => {
    const t = await text(tpl({ layout: 'SUMMARY_CARD', title: 'Salary slip', labels: { earnings: 'Pay', deductions: 'Cuts', netPay: 'Take-home' }, showSystemLine: false, fields: { attendance: false, pan: false, uan: false, bankAccount: false, netInWords: false, designation: false } }));
    for (const s of ['Salary slip for the month', 'Take-home', 'PAY', 'CUTS']) expect(t).toContain(s);
    for (const s of ['Paid Days', 'LOP Days', 'PAN', 'UAN', 'Bank Account', 'Amount In Words', 'Designation', 'computer-generated']) expect(t).not.toContain(s);
  });

  it('both layouts render with a logo, and a broken logo never stops the payslip', async () => {
    const logo = logoFromDataUrl(PNG_1X1);
    expect(logo).not.toBeNull();
    for (const layout of ['CLASSIC', 'SUMMARY_CARD'] as const) {
      expect(await text(tpl({ layout }), logo)).toContain('Sample Employee');
      expect(await text(tpl({ layout }), Buffer.from('this is not an image'))).toContain('Sample Employee');
    }
  });

  it('handles many lines and long names without throwing (second page)', async () => {
    const big = { ...sample, earnings: Array.from({ length: 30 }, (_, i) => ({ label: `Allowance number ${i + 1}`, fullPaise: 100_000, amountPaise: 100_000 })), deductions: Array.from({ length: 12 }, (_, i) => ({ label: `Deduction ${i + 1}`, amountPaise: 10_000 })) };
    for (const layout of ['CLASSIC', 'SUMMARY_CARD'] as const) expect(await text(tpl({ layout }), null, big)).toContain('Allowance number 30');
  });
});

describe('payslip template schema and helpers', () => {
  it('validates colour, logo type and CUSTOM-without-logo', () => {
    expect(payslipTemplateSchema.safeParse({ accentColor: 'blue' }).success).toBe(false);
    expect(payslipTemplateSchema.safeParse({ logoMode: 'CUSTOM' }).success).toBe(false);
    expect(payslipTemplateSchema.safeParse({ logoMode: 'CUSTOM', customLogo: 'data:image/svg+xml;base64,AAAA' }).success).toBe(false);
    expect(payslipTemplateSchema.safeParse({ logoMode: 'CUSTOM', customLogo: PNG_1X1 }).success).toBe(true);
    expect(payslipTemplateSchema.safeParse({ layout: 'NOPE' }).success).toBe(false);
    expect(payslipTemplateSchema.safeParse({ footerNote: 'x'.repeat(241) }).success).toBe(false);
    expect(payslipTemplateSchema.safeParse({ title: 'x' }).success).toBe(false);
  });

  it('tint mixes a colour with white; logo parser rejects anything but PNG/JPEG data URLs', () => {
    expect(tint('#000000', 0.9)).toBe('#e6e6e6');
    expect(tint('#ff0000', 1)).toBe('#ffffff');
    expect(tint('#b68235', 0)).toBe('#b68235');
    expect(logoFromDataUrl('data:image/svg+xml;base64,AAAA')).toBeNull();
    expect(logoFromDataUrl(null)).toBeNull();
    expect(logoFromDataUrl(PNG_1X1)!.length).toBeGreaterThan(20);
  });
});
