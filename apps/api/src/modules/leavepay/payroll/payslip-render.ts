import type { PayslipCanvas, PayslipDesign, PayslipDetail, PayslipTemplate } from '@lexisora/shared';
import { PDF_COLORS, type Pdf, type PdfService } from '../../../core/pdf/pdf.service';
import { periodLabel } from '../common/dates';
import { rupeesInWords } from './num-words';
import { fmtHm } from './payroll-calc';
import { renderBlocks } from './payslip-blocks';
import { renderCanvas } from './payslip-canvas';

/** "Rs. 78,420.00" — built-in PDF fonts have no ₹ glyph. */
export const pdfMoney = (paise: number) => `Rs. ${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Mix a #rrggbb colour with white (ratio 0 = the colour, 1 = white). */
export function tint(hex: string, ratio: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = (shift: number) => Math.round(((n >> shift) & 255) * (1 - ratio) + 255 * ratio);
  return `#${[16, 8, 0].map((s) => ch(s).toString(16).padStart(2, '0')).join('')}`;
}

/** Logo bytes from a data URL; null when absent or malformed. */
export function logoFromDataUrl(url: string | null | undefined): Buffer | null {
  const m = /^data:image\/(?:png|jpeg);base64,([A-Za-z0-9+/=]+)$/.exec(url ?? '');
  return m ? Buffer.from(m[1]!, 'base64') : null;
}

/** Draw the logo if pdfkit can read it; a bad image must never stop a payslip being produced. */
function drawLogo(doc: Pdf, logo: Buffer | null, x: number, y: number, fit: [number, number]): boolean {
  if (!logo) return false;
  try {
    doc.image(logo, x, y, { fit });
    return true;
  } catch {
    return false;
  }
}

/** Render a payslip PDF in the company's chosen layout. `opts` lets tests switch compression off. */
export function renderPayslip(pdf: PdfService, d: PayslipDetail, tpl: PayslipTemplate | PayslipDesign | PayslipCanvas, logo: Buffer | null, opts?: PDFKit.PDFDocumentOptions): Promise<Buffer> {
  if ('elements' in tpl) return renderCanvas(pdf, d, tpl, logo, opts); // v3: the company's free-canvas design
  if ('blocks' in tpl) return renderBlocks(pdf, d, tpl, logo, opts); // v2: the company's own block design
  return pdf.render((doc) => (tpl.layout === 'SUMMARY_CARD' ? summaryCard(doc, d, tpl, logo) : classic(pdf, doc, d, tpl, logo)), opts ? { size: 'A4', margin: 48, ...opts } : undefined);
}

function footer(doc: Pdf, tpl: PayslipTemplate) {
  const left = doc.page.margins.left;
  const width = doc.page.width - left - doc.page.margins.right;
  if (tpl.footerNote) {
    doc.font('Helvetica').fontSize(8.5).fillColor(PDF_COLORS.muted).text(tpl.footerNote, left, doc.y, { width, align: 'center' });
    doc.moveDown(0.8);
  }
  if (tpl.showSystemLine) doc.font('Helvetica').fontSize(7.5).fillColor(PDF_COLORS.muted).text('This is a computer-generated payslip and does not require a signature.', left, doc.y, { width, align: 'center' });
}

function notes(doc: Pdf, d: PayslipDetail, tpl: PayslipTemplate) {
  const left = doc.page.margins.left;
  const width = doc.page.width - left - doc.page.margins.right;
  const note = (t: string) => doc.font('Helvetica').fontSize(8.5).fillColor(PDF_COLORS.muted).text(t, left, doc.y, { width });
  if (tpl.fields.idleNote && d.idleMinutes > 0) note(`Deducted idle time this month: ${fmtHm(d.idleMinutes)} (monthly allowance applied before any deduction).`);
  if (tpl.fields.employerContributions && d.employer.length) note(`Employer contributions (not part of net pay): ${d.employer.map((e) => `${e.label} ${pdfMoney(e.amountPaise)}`).join(' · ')}`);
  if (tpl.fields.yearToDate) note(`Year to date: gross ${pdfMoney(d.ytd.grossPaise)} · TDS ${pdfMoney(d.ytd.tdsPaise)} · PF ${pdfMoney(d.ytd.pfPaise)}${d.taxRegime ? ` · ${d.taxRegime === 'NEW' ? 'New' : 'Old'} tax regime` : ''}`);
}

// ── Classic: the original layout (letterhead, key/value blocks, two tables) with the company's switches applied ──
function classic(pdf: PdfService, doc: Pdf, d: PayslipDetail, tpl: PayslipTemplate, logo: Buffer | null) {
  const left = doc.page.margins.left;
  if (drawLogo(doc, logo, left, doc.y, [130, 42])) doc.y += 50;
  pdf.header(doc, d.company.name, `${tpl.title} · ${periodLabel(d.period, true)}`, tpl.accentColor);
  if (tpl.showAddress && d.company.address) doc.font('Helvetica').fontSize(8.5).fillColor(PDF_COLORS.muted).text(d.company.address).moveDown(0.8);
  doc.fillColor(PDF_COLORS.ink);
  const half = (doc.page.width - left - doc.page.margins.right) / 2;
  const top = doc.y;
  const kv = (rows: [string, string][], x: number) => {
    let y = top;
    for (const [k, v] of rows) {
      doc.font('Helvetica').fontSize(8.5).fillColor(PDF_COLORS.muted).text(k, x, y, { width: 95 });
      doc.font('Helvetica').fontSize(9.5).fillColor(PDF_COLORS.ink).text(v, x + 95, y, { width: half - 105 });
      y += 15;
    }
    return y;
  };
  const f = tpl.fields;
  const people: [string, string][] = [['Employee', d.employee.name], ['Employee ID', d.employee.code]];
  if (f.designation) people.push(['Designation', d.employee.designation ?? '—']);
  if (f.department) people.push(['Department', d.employee.department ?? '—']);
  if (f.joiningDate) people.push(['Date of joining', d.employee.joiningDate ?? '—']);
  if (f.pan) people.push(['PAN', d.employee.panMasked ?? '—']);
  if (f.uan) people.push(['UAN', d.employee.uan ?? '—']);
  const pay: [string, string][] = [['Pay period', periodLabel(d.period, true)], ['Pay date', d.payDate ?? '—']];
  if (f.attendance) pay.push(['Working days', String(d.workingDays)], ['Paid days', String(d.paidDays)], ['LOP days', String(d.lopDays)], ['Leave', d.leave]);
  if (f.bankAccount) pay.push(['Bank account', d.employee.bankMasked ? `${d.employee.bankMasked}${d.employee.ifsc ? ` · ${d.employee.ifsc}` : ''}` : '—']);
  const y1 = kv(people, left);
  const y2 = kv(pay, left + half);
  doc.y = Math.max(y1, y2) + 12;
  doc.x = left;
  const full = f.fullMonthColumn;
  pdf.table(
    doc,
    full ? [tpl.labels.earnings, 'Full month', 'Earned'] : [tpl.labels.earnings, 'Earned'],
    [
      ...d.earnings.map((e) => (full ? [e.label, e.fullPaise !== null ? pdfMoney(e.fullPaise) : '', pdfMoney(e.amountPaise)] : [e.label, pdfMoney(e.amountPaise)])),
      full ? ['Total earnings', '', pdfMoney(d.totalEarningsPaise)] : ['Total earnings', pdfMoney(d.totalEarningsPaise)],
    ],
    full ? [0.5, 0.25, 0.25] : [0.75, 0.25],
    full ? [1, 2] : [1],
  );
  pdf.table(doc, [tpl.labels.deductions, 'Amount'], [...(d.deductions.length ? d.deductions.map((e) => [e.label, pdfMoney(e.amountPaise)]) : [['No deductions', pdfMoney(0)]]), ['Total deductions', pdfMoney(d.totalDeductionsPaise)]], [0.75, 0.25], [1]);
  doc.font('Times-Bold').fontSize(16).fillColor(PDF_COLORS.ink).text(`${tpl.labels.netPay}  ${pdfMoney(d.netPaise)}`, left);
  if (f.netInWords) doc.font('Helvetica').fontSize(9).fillColor(PDF_COLORS.muted).text(d.netInWords);
  doc.moveDown(0.8);
  notes(doc, d, tpl);
  doc.moveDown(2);
  footer(doc, tpl);
}

// ── Summary card: logo + company header, employee summary beside a net-pay card, side-by-side earnings / deductions ──
function summaryCard(doc: Pdf, d: PayslipDetail, tpl: PayslipTemplate, logo: Buffer | null) {
  const L = doc.page.margins.left;
  const W = doc.page.width - L - doc.page.margins.right;
  const accent = tpl.accentColor;
  const soft = tint(accent, 0.9);
  const { ink, muted, rule } = PDF_COLORS;
  const f = tpl.fields;
  let y = doc.page.margins.top;

  // Header: logo + company on the left, title and month on the right.
  let tx = L;
  if (drawLogo(doc, logo, L, y, [72, 52])) tx = L + 84;
  const textW = W - (tx - L) - 150;
  doc.font('Helvetica-Bold').fontSize(15).fillColor(ink).text(d.company.name, tx, y + 2, { width: textW });
  if (tpl.showAddress && d.company.address) doc.font('Helvetica').fontSize(8.5).fillColor(muted).text(d.company.address, tx, doc.y + 2, { width: textW });
  const headBottom = Math.max(doc.y, y + 54);
  doc.font('Helvetica').fontSize(8).fillColor(muted).text(`${tpl.title} for the month`, L, y + 4, { width: W, align: 'right' });
  doc.font('Helvetica-Bold').fontSize(12).fillColor(ink).text(periodLabel(d.period, true), L, y + 16, { width: W, align: 'right' });
  y = headBottom + 8;
  doc.moveTo(L, y).lineTo(L + W, y).lineWidth(0.8).strokeColor(rule).stroke();
  y += 16;

  // Employee summary (left) and net-pay card (right).
  const colW = W - 220;
  doc.font('Helvetica-Bold').fontSize(7.5).fillColor(muted).text('EMPLOYEE SUMMARY', L, y, { characterSpacing: 0.8 });
  const rows: [string, string][] = [['Employee Name', d.employee.name], ['Employee ID', d.employee.code]];
  if (f.designation) rows.push(['Designation', d.employee.designation ?? '—']);
  if (f.department) rows.push(['Department', d.employee.department ?? '—']);
  if (f.joiningDate) rows.push(['Date of Joining', d.employee.joiningDate ?? '—']);
  rows.push(['Pay Period', periodLabel(d.period, true)], ['Pay Date', d.payDate ?? '—']);
  if (f.pan) rows.push(['PAN', d.employee.panMasked ?? '—']);
  if (f.uan) rows.push(['UAN', d.employee.uan ?? '—']);
  if (f.bankAccount) rows.push(['Bank Account', d.employee.bankMasked ? `${d.employee.bankMasked}${d.employee.ifsc ? ` · ${d.employee.ifsc}` : ''}` : '—']);
  let ky = y + 16;
  for (const [k, v] of rows) {
    doc.font('Helvetica').fontSize(8.5).fillColor(muted).text(k, L, ky, { width: 92 });
    doc.font('Helvetica').fontSize(9.5).fillColor(ink).text(`:  ${v}`, L + 94, ky, { width: colW - 94 });
    ky += 16;
  }
  const cx = L + W - 205;
  const cw = 205;
  const stats: [string, string][] = f.attendance ? [['Paid Days', String(d.paidDays)], ['LOP Days', String(d.lopDays)]] : [];
  const ch = 70 + (stats.length ? 14 + stats.length * 17 : 0);
  doc.roundedRect(cx, y, cw, 62, 6).fill(soft);
  doc.rect(cx, y + 12, 2.5, 38).fill(accent);
  doc.font('Helvetica-Bold').fontSize(18).fillColor(ink).text(pdfMoney(d.netPaise), cx + 14, y + 13, { width: cw - 20 });
  const netCaption = tpl.labels.netPay.split(' ').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  doc.font('Helvetica').fontSize(8.5).fillColor(accent).text(`Total ${netCaption}`, cx + 14, y + 38, { width: cw - 20 });
  doc.roundedRect(cx, y, cw, ch, 6).lineWidth(0.8).strokeColor(rule).stroke();
  let sy = y + 76;
  if (stats.length) {
    doc.dash(1, { space: 2 }).moveTo(cx + 10, y + 70).lineTo(cx + cw - 10, y + 70).lineWidth(0.6).strokeColor(rule).stroke().undash();
    for (const [k, v] of stats) {
      doc.font('Helvetica').fontSize(8.5).fillColor(muted).text(k, cx + 14, sy, { width: 90 });
      doc.font('Helvetica').fontSize(9.5).fillColor(ink).text(`:  ${v}`, cx + 104, sy, { width: cw - 114 });
      sy += 17;
    }
  }
  y = Math.max(ky, y + ch) + 20;

  // Earnings | Deductions box.
  const n = Math.max(d.earnings.length, d.deductions.length, 1);
  const rowH = 17;
  const headH = 26;
  const footH = 26;
  const boxH = headH + n * rowH + 10 + footH;
  if (y + boxH + 120 > doc.page.height - doc.page.margins.bottom) {
    doc.addPage();
    y = doc.page.margins.top;
  }
  const half = W / 2;
  doc.roundedRect(L, y, W, boxH, 6).lineWidth(0.8).strokeColor(rule).stroke();
  const col = (x: number, title: string, items: { label: string; amountPaise: number }[]) => {
    doc.font('Helvetica-Bold').fontSize(8).fillColor(ink).text(title.toUpperCase(), x + 12, y + 9, { width: half - 90 });
    doc.font('Helvetica-Bold').fontSize(8).fillColor(ink).text('AMOUNT', x, y + 9, { width: half - 12, align: 'right' });
    let ry = y + headH + 4;
    for (const it of items) {
      doc.font('Helvetica').fontSize(8.5).fillColor(ink).text(it.label, x + 12, ry, { width: half - 100 });
      doc.font('Helvetica-Bold').fontSize(8.5).fillColor(ink).text(pdfMoney(it.amountPaise), x, ry, { width: half - 12, align: 'right' });
      ry += rowH;
    }
  };
  col(L, tpl.labels.earnings, d.earnings);
  col(L + half, tpl.labels.deductions, d.deductions);
  doc.dash(1, { space: 2 }).moveTo(L + 10, y + headH).lineTo(L + W - 10, y + headH).lineWidth(0.6).strokeColor(rule).stroke().undash();
  doc.roundedRect(L + 0.5, y + boxH - footH, W - 1, footH - 0.5, 5).fill('#f6f5f4');
  const fy = y + boxH - footH + 9;
  doc.font('Helvetica-Bold').fontSize(8.5).fillColor(ink).text('Gross Earnings', L + 12, fy, { width: half - 100 });
  doc.font('Helvetica-Bold').fontSize(8.5).fillColor(ink).text(pdfMoney(d.totalEarningsPaise), L, fy, { width: half - 12, align: 'right' });
  doc.font('Helvetica-Bold').fontSize(8.5).fillColor(ink).text('Total Deductions', L + half + 12, fy, { width: half - 100 });
  doc.font('Helvetica-Bold').fontSize(8.5).fillColor(ink).text(pdfMoney(d.totalDeductionsPaise), L + half, fy, { width: half - 12, align: 'right' });
  y += boxH + 16;

  // Net payable bar.
  doc.roundedRect(L, y, W, 38, 6).lineWidth(0.8).strokeColor(rule).stroke();
  doc.roundedRect(L + W - 140, y + 0.5, 139.5, 37, 5).fill(soft);
  doc.font('Helvetica-Bold').fontSize(9).fillColor(ink).text('TOTAL NET PAYABLE', L + 12, y + 8, { width: W - 170 });
  doc.font('Helvetica').fontSize(7.5).fillColor(muted).text('Gross Earnings - Total Deductions', L + 12, y + 22, { width: W - 170 });
  doc.font('Helvetica-Bold').fontSize(11).fillColor(ink).text(pdfMoney(d.netPaise), L + W - 140, y + 13, { width: 128, align: 'right' });
  y += 38 + 10;
  if (f.netInWords) doc.font('Helvetica').fontSize(8.5).fillColor(ink).text(`Amount In Words : ${d.netInWords}`, L, y, { width: W, align: 'right' });
  doc.y = y + (f.netInWords ? 22 : 4);
  doc.x = L;
  notes(doc, d, tpl);
  doc.moveDown(1.2);
  doc.moveTo(L, doc.y).lineTo(L + W, doc.y).lineWidth(0.8).strokeColor(rule).stroke();
  doc.moveDown(0.8);
  footer(doc, tpl);
}

/** A believable sample payslip for the design preview (company details are the real ones). */
export function samplePayslip(company: PayslipDetail['company'], period: string): PayslipDetail {
  const earnings = [
    { label: 'Basic', fullPaise: 4_500_000, amountPaise: 4_500_000 },
    { label: 'HRA', fullPaise: 2_250_000, amountPaise: 2_250_000 },
    { label: 'Special allowance', fullPaise: 2_250_000, amountPaise: 2_250_000 },
    { label: 'Conveyance', fullPaise: 160_000, amountPaise: 160_000 },
  ];
  const deductions = [
    { label: 'Provident fund', amountPaise: 180_000 },
    { label: 'Professional tax', amountPaise: 20_000 },
  ];
  const totalEarningsPaise = earnings.reduce((s, e) => s + e.amountPaise, 0);
  const totalDeductionsPaise = deductions.reduce((s, e) => s + e.amountPaise, 0);
  const netPaise = totalEarningsPaise - totalDeductionsPaise;
  return {
    id: 'sample',
    period,
    month: periodLabel(period),
    runType: 'REGULAR',
    workingDays: 22,
    paidDays: 22,
    idleDeductionPaise: 0,
    netPaise,
    grossPaise: totalEarningsPaise,
    status: 'PUBLISHED',
    employee: { name: 'Sample Employee', code: 'EMP-0001', designation: 'Software Engineer', department: 'Engineering', joiningDate: '2024-04-01', panMasked: 'AB••••34F', uan: '100123456789', bankMasked: 'XXXX XXXX 4321', ifsc: 'HDFC0001234' },
    company,
    payDate: `${period}-28`,
    taxRegime: 'NEW',
    lopDays: 0,
    leave: '0',
    idleMinutes: 0,
    earnings,
    deductions,
    employer: [{ label: 'PF (employer)', amountPaise: 180_000 }],
    totalEarningsPaise,
    totalDeductionsPaise,
    netInWords: rupeesInWords(netPaise),
    ytd: { grossPaise: totalEarningsPaise * 6, tdsPaise: 0, pfPaise: 180_000 * 6 },
  } as PayslipDetail;
}
