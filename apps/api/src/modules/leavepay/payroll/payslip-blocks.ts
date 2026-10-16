import type { PayslipBlock, PayslipDesign, PayslipDetail, PayslipStyle } from '@lexisora/shared';
import { PDF_COLORS, type Pdf, type PdfService } from '../../../core/pdf/pdf.service';
import { periodLabel } from '../common/dates';
import { fmtHm } from './payroll-calc';

/** "Rs. 78,420.00" — built-in PDF fonts have no ₹ glyph. */
const money = (paise: number) => `Rs. ${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const FONTS = {
  HELVETICA: ['Helvetica', 'Helvetica-Bold', 'Helvetica-Oblique', 'Helvetica-BoldOblique'],
  TIMES: ['Times-Roman', 'Times-Bold', 'Times-Italic', 'Times-BoldItalic'],
  COURIER: ['Courier', 'Courier-Bold', 'Courier-Oblique', 'Courier-BoldOblique'],
} as const;

/** The PDF font for a style (bold / italic can be overridden, e.g. table headings are always bold). */
export function fontFor(s: Pick<PayslipStyle, 'font' | 'bold' | 'italic'>, bold = s.bold, italic = s.italic): string {
  return FONTS[s.font][(bold ? 1 : 0) + (italic ? 2 : 0)]!;
}

/** Tint a #rrggbb colour with white (0 = the colour, 1 = white). */
function tint(hex: string, ratio: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = (shift: number) => Math.round(((n >> shift) & 255) * (1 - ratio) + 255 * ratio);
  return `#${[16, 8, 0].map((s) => ch(s).toString(16).padStart(2, '0')).join('')}`;
}

/** Everything a design can insert as {{field}}, for one employee's payslip. */
export function fieldValues(d: PayslipDetail): Record<string, string> {
  const regime = d.taxRegime === 'NEW' ? 'New' : d.taxRegime === 'OLD' ? 'Old' : '';
  return {
    'company.name': d.company.name,
    'company.address': d.company.address ?? '',
    'company.pan': d.company.pan ?? '',
    'employee.name': d.employee.name,
    'employee.code': d.employee.code,
    'employee.designation': d.employee.designation ?? '',
    'employee.department': d.employee.department ?? '',
    'employee.joiningDate': d.employee.joiningDate ?? '',
    'employee.pan': d.employee.panMasked ?? '',
    'employee.uan': d.employee.uan ?? '',
    'employee.bank': d.employee.bankMasked ? `${d.employee.bankMasked}${d.employee.ifsc ? ` · ${d.employee.ifsc}` : ''}` : '',
    'pay.period': periodLabel(d.period, true),
    'pay.date': d.payDate ?? '',
    'pay.workingDays': String(d.workingDays),
    'pay.paidDays': String(d.paidDays),
    'pay.lopDays': String(d.lopDays),
    'pay.leave': d.leave ?? '',
    'pay.taxRegime': regime,
    'pay.gross': money(d.totalEarningsPaise),
    'pay.deductions': money(d.totalDeductionsPaise),
    'pay.net': money(d.netPaise),
    'pay.netInWords': d.netInWords,
    'note.employer': d.employer.length ? `Employer contributions (not part of net pay): ${d.employer.map((e) => `${e.label} ${money(e.amountPaise)}`).join(' · ')}` : '',
    'note.ytd': `Year to date: gross ${money(d.ytd.grossPaise)} · TDS ${money(d.ytd.tdsPaise)} · PF ${money(d.ytd.pfPaise)}${regime ? ` · ${regime} tax regime` : ''}`,
    'note.idle': d.idleMinutes > 0 ? `Deducted idle time this month: ${fmtHm(d.idleMinutes)} (monthly allowance applied before any deduction).` : '',
  };
}

/** Replace {{field}} with the employee's value; an unknown field becomes blank. */
export function fillFields(text: string, values: Record<string, string>): string {
  return text.replace(/\{\{\s*([A-Za-z0-9_.]+)\s*\}\}/g, (_, k: string) => values[k] ?? '');
}

function drawLogo(doc: Pdf, logo: Buffer | null, x: number, y: number, fit: [number, number]): boolean {
  if (!logo) return false;
  try {
    doc.image(logo, x, y, { fit });
    return true;
  } catch {
    return false; // a bad image must never stop a payslip being produced
  }
}

type Ctx = { pdf: PdfService; doc: Pdf; d: PayslipDetail; v: Record<string, string>; accent: string; logo: Buffer | null; L: number; W: number };
const style = (c: Ctx, s: PayslipStyle, bold = s.bold) => c.doc.font(fontFor(s, bold)).fontSize(s.size).fillColor(s.color);
const align = (s: PayslipStyle) => s.align.toLowerCase() as 'left' | 'center' | 'right';
const fill = (c: Ctx, t: string) => fillFields(t, c.v);
const bottom = (c: Ctx) => c.doc.page.height - c.doc.page.margins.bottom;
const ensure = (c: Ctx, h: number) => {
  if (c.doc.y + h > bottom(c)) {
    c.doc.addPage();
    c.doc.y = c.doc.page.margins.top;
  }
};

/** Render a payslip from a block design, one block after another down the page. */
export function renderBlocks(pdf: PdfService, d: PayslipDetail, design: PayslipDesign, logo: Buffer | null, opts?: PDFKit.PDFDocumentOptions): Promise<Buffer> {
  return pdf.render(
    (doc) => {
      const L = doc.page.margins.left;
      const c: Ctx = { pdf, doc, d, v: fieldValues(d), accent: design.accentColor, logo, L, W: doc.page.width - L - doc.page.margins.right };
      for (const b of design.blocks) draw(c, b);
    },
    opts ? { size: 'A4', margin: 48, ...opts } : undefined,
  );
}

function draw(c: Ctx, b: PayslipBlock) {
  switch (b.type) {
    case 'text': return text(c, b);
    case 'header': return b.variant === 'SPLIT' ? headerSplit(c, b) : headerLetterhead(c, b);
    case 'details': return details(c, b);
    case 'earnings': return table(c, b.heading, b.totalLabel, b.showFullMonth, c.d.earnings.map((e) => ({ label: e.label, full: e.fullPaise, amount: e.amountPaise })), c.d.totalEarningsPaise, b.style);
    case 'deductions': return table(c, b.heading, b.totalLabel, false, c.d.deductions.map((e) => ({ label: e.label, full: null, amount: e.amountPaise })), c.d.totalDeductionsPaise, b.style, 'No deductions');
    case 'split': return split(c, b);
    case 'net': return b.variant === 'BAR' ? netBar(c, b) : netLine(c, b);
    case 'divider': return divider(c, b);
    case 'spacer': c.doc.y += b.height; return;
  }
}

type B<T extends PayslipBlock['type']> = Extract<PayslipBlock, { type: T }>;

function text(c: Ctx, b: B<'text'>) {
  const t = fill(c, b.text).trim();
  if (!t) return; // a line made only of empty fields (e.g. no idle deduction this month) is left out
  c.doc.y += b.before;
  style(c, b.style).text(t, c.L, c.doc.y, { width: c.W, align: align(b.style) });
  c.doc.y += b.after;
  c.doc.x = c.L;
}

function headerLetterhead(c: Ctx, b: B<'header'>) {
  const { doc, L, W } = c;
  if (b.showLogo && drawLogo(doc, c.logo, L, doc.y, [130, 42])) doc.y += 50;
  style(c, b.nameStyle).text(c.d.company.name, L, doc.y, { width: W, align: align(b.nameStyle) });
  const kicker = fill(c, b.title).trim();
  if (kicker) doc.font('Helvetica').fontSize(8).fillColor(c.accent).text(kicker.toUpperCase(), L, doc.y, { characterSpacing: 1.2, width: W, align: align(b.nameStyle) });
  const y = doc.y + 6;
  doc.moveTo(L, y).lineTo(L + W, y).lineWidth(1).strokeColor(c.accent).stroke();
  doc.y = y + 12;
  if (b.showAddress && c.d.company.address) {
    doc.font('Helvetica').fontSize(8.5).fillColor(PDF_COLORS.muted).text(c.d.company.address, L, doc.y, { width: W, align: align(b.nameStyle) });
    doc.y += 10;
  }
  doc.fillColor(PDF_COLORS.ink);
  doc.x = L;
}

function headerSplit(c: Ctx, b: B<'header'>) {
  const { doc, L, W } = c;
  const y = doc.y;
  let tx = L;
  if (b.showLogo && drawLogo(doc, c.logo, L, y, [72, 52])) tx = L + 84;
  const textW = W - (tx - L) - 150;
  style(c, b.nameStyle).text(c.d.company.name, tx, y + 2, { width: textW });
  if (b.showAddress && c.d.company.address) doc.font('Helvetica').fontSize(8.5).fillColor(PDF_COLORS.muted).text(c.d.company.address, tx, doc.y + 2, { width: textW });
  const headBottom = Math.max(doc.y, y + 54);
  const title = fill(c, b.title).trim();
  const sub = fill(c, b.subtitle).trim();
  if (title) doc.font('Helvetica').fontSize(8).fillColor(PDF_COLORS.muted).text(title, L, y + 4, { width: W, align: 'right' });
  if (sub) doc.font('Helvetica-Bold').fontSize(12).fillColor(PDF_COLORS.ink).text(sub, L, y + 16, { width: W, align: 'right' });
  const ry = headBottom + 8;
  doc.moveTo(L, ry).lineTo(L + W, ry).lineWidth(0.8).strokeColor(PDF_COLORS.rule).stroke();
  doc.y = ry + 16;
  doc.x = L;
}

function details(c: Ctx, b: B<'details'>) {
  const { doc, L, W } = c;
  ensure(c, 60);
  const blockTop = doc.y;
  const heading = fill(c, b.heading).trim();
  if (heading) doc.font('Helvetica-Bold').fontSize(7.5).fillColor(PDF_COLORS.muted).text(heading.toUpperCase(), L, blockTop, { characterSpacing: 0.8 });
  const top = heading ? blockTop + 16 : blockTop;
  const hasCard = !!b.card;
  const twoCols = !hasCard && b.rowsRight.length > 0;
  const colW = hasCard ? W - 220 : twoCols ? W / 2 : W;
  const kv = (rows: { label: string; value: string }[], x: number, w: number) => {
    let y = top;
    for (const r of rows) {
      const raw = fill(c, r.value).trim();
      const value = `${b.separator ? `${b.separator}  ` : ''}${raw || '—'}`;
      doc.font(fontFor({ ...b.style, bold: false }, false)).fontSize(b.style.size * 0.9).fillColor(b.labelColor).text(r.label, x, y, { width: b.labelWidth });
      style(c, b.style).text(value, x + b.labelWidth + (b.separator ? 2 : 0), y, { width: Math.max(40, w - b.labelWidth - 10), align: 'left' });
      const h = doc.heightOfString(value, { width: Math.max(40, w - b.labelWidth - 10) });
      y += Math.max(Math.max(15, b.style.size * 1.6), h + 4);
    }
    return y;
  };
  const y1 = kv(b.rows, L, colW);
  const y2 = twoCols ? kv(b.rowsRight, L + W / 2, W / 2) : top;
  let bottomY = Math.max(y1, y2);
  if (b.card) bottomY = Math.max(bottomY, card(c, b.card, blockTop));
  doc.y = bottomY + 12;
  doc.x = L;
}

/** The framed net-pay card beside the summary. Returns the y where it ends. */
function card(c: Ctx, card: NonNullable<B<'details'>['card']>, y: number): number {
  const { doc, L, W, accent } = c;
  const cx = L + W - 205;
  const cw = 205;
  const rows = card.rows;
  const ch = 70 + (rows.length ? 14 + rows.length * 17 : 0);
  doc.roundedRect(cx, y, cw, 62, 6).fill(tint(accent, 0.9));
  doc.rect(cx, y + 12, 2.5, 38).fill(accent);
  doc.font('Helvetica-Bold').fontSize(18).fillColor(PDF_COLORS.ink).text(fill(c, card.amount), cx + 14, y + 13, { width: cw - 20 });
  doc.font('Helvetica').fontSize(8.5).fillColor(accent).text(card.title, cx + 14, y + 38, { width: cw - 20 });
  doc.roundedRect(cx, y, cw, ch, 6).lineWidth(0.8).strokeColor(PDF_COLORS.rule).stroke();
  if (rows.length) {
    doc.dash(1, { space: 2 }).moveTo(cx + 10, y + 70).lineTo(cx + cw - 10, y + 70).lineWidth(0.6).strokeColor(PDF_COLORS.rule).stroke().undash();
    let sy = y + 76;
    for (const r of rows) {
      doc.font('Helvetica').fontSize(8.5).fillColor(PDF_COLORS.muted).text(r.label, cx + 14, sy, { width: 90 });
      doc.font('Helvetica').fontSize(9.5).fillColor(PDF_COLORS.ink).text(`:  ${fill(c, r.value) || '—'}`, cx + 104, sy, { width: cw - 114 });
      sy += 17;
    }
  }
  return y + ch;
}

type Line = { label: string; full: number | null; amount: number };

function table(c: Ctx, heading: string, totalLabel: string, showFull: boolean, lines: Line[], total: number, st: PayslipStyle, emptyLabel?: string) {
  const { doc, L, W } = c;
  const widths = showFull ? [0.5, 0.25, 0.25] : [0.75, 0.25];
  const w = widths.map((f) => f * W);
  const head = showFull ? [heading, 'Full month', 'Earned'] : [heading, 'Amount'];
  const rightCols = showFull ? [1, 2] : [1];
  const rows = lines.length ? lines : emptyLabel ? [{ label: emptyLabel, full: null, amount: 0 }] : [];
  const cells = (r: Line) => (showFull ? [r.label, r.full !== null ? money(r.full) : '', money(r.amount)] : [r.label, money(r.amount)]);
  const row = (cs: string[], kind: 'head' | 'row' | 'total') => {
    ensure(c, 22);
    const y = doc.y;
    let x = L;
    let h = 0;
    cs.forEach((t, i) => {
      if (kind === 'head') doc.font('Helvetica-Bold').fontSize(8).fillColor(PDF_COLORS.muted);
      else style(c, st, kind === 'total' ? true : st.bold);
      doc.text(kind === 'head' ? t.toUpperCase() : t, x + 3, y + 4, { width: w[i]! - 6, align: rightCols.includes(i) ? 'right' : 'left' });
      h = Math.max(h, doc.y - y);
      x += w[i]!;
    });
    doc.y = y + h + 4;
    doc.moveTo(L, doc.y).lineTo(L + W, doc.y).lineWidth(0.5).strokeColor(PDF_COLORS.rule).stroke();
  };
  row(head, 'head');
  rows.forEach((r) => row(cells(r), 'row'));
  row(showFull ? [totalLabel, '', money(total)] : [totalLabel, money(total)], 'total');
  doc.y += 10;
  doc.x = L;
}

function split(c: Ctx, b: B<'split'>) {
  const { doc, L, W, d } = c;
  const n = Math.max(d.earnings.length, d.deductions.length, 1);
  const rowH = Math.max(17, b.style.size * 2);
  const headH = 26;
  const footH = 26;
  const boxH = headH + n * rowH + 10 + footH;
  ensure(c, boxH + 20);
  const y = doc.y;
  const half = W / 2;
  doc.roundedRect(L, y, W, boxH, 6).lineWidth(0.8).strokeColor(PDF_COLORS.rule).stroke();
  const col = (x: number, title: string, items: { label: string; amountPaise: number }[]) => {
    doc.font('Helvetica-Bold').fontSize(8).fillColor(PDF_COLORS.ink).text(title.toUpperCase(), x + 12, y + 9, { width: half - 90 });
    doc.font('Helvetica-Bold').fontSize(8).fillColor(PDF_COLORS.ink).text('AMOUNT', x, y + 9, { width: half - 12, align: 'right' });
    let ry = y + headH + 4;
    for (const it of items) {
      style(c, b.style, false).text(it.label, x + 12, ry, { width: half - 100 });
      style(c, b.style, true).text(money(it.amountPaise), x, ry, { width: half - 12, align: 'right' });
      ry += rowH;
    }
  };
  col(L, b.earningsHeading, d.earnings.map((e) => ({ label: e.label, amountPaise: e.amountPaise })));
  col(L + half, b.deductionsHeading, d.deductions);
  doc.dash(1, { space: 2 }).moveTo(L + 10, y + headH).lineTo(L + W - 10, y + headH).lineWidth(0.6).strokeColor(PDF_COLORS.rule).stroke().undash();
  doc.roundedRect(L + 0.5, y + boxH - footH, W - 1, footH - 0.5, 5).fill('#f6f5f4');
  const fy = y + boxH - footH + 9;
  doc.font('Helvetica-Bold').fontSize(8.5).fillColor(PDF_COLORS.ink).text(b.earningsTotalLabel, L + 12, fy, { width: half - 100 });
  doc.font('Helvetica-Bold').fontSize(8.5).fillColor(PDF_COLORS.ink).text(money(d.totalEarningsPaise), L, fy, { width: half - 12, align: 'right' });
  doc.font('Helvetica-Bold').fontSize(8.5).fillColor(PDF_COLORS.ink).text(b.deductionsTotalLabel, L + half + 12, fy, { width: half - 100 });
  doc.font('Helvetica-Bold').fontSize(8.5).fillColor(PDF_COLORS.ink).text(money(d.totalDeductionsPaise), L + half, fy, { width: half - 12, align: 'right' });
  doc.y = y + boxH + 16;
  doc.x = L;
}

function netLine(c: Ctx, b: B<'net'>) {
  const { doc, L, d } = c;
  ensure(c, 40);
  doc.font('Times-Bold').fontSize(16).fillColor(PDF_COLORS.ink).text(`${b.label}  ${money(d.netPaise)}`, L, doc.y);
  if (b.showWords) doc.font('Helvetica').fontSize(9).fillColor(PDF_COLORS.muted).text(d.netInWords, L, doc.y);
  doc.y += 12;
  doc.x = L;
}

function netBar(c: Ctx, b: B<'net'>) {
  const { doc, L, W, d } = c;
  ensure(c, 70);
  const y = doc.y;
  doc.roundedRect(L, y, W, 38, 6).lineWidth(0.8).strokeColor(PDF_COLORS.rule).stroke();
  doc.roundedRect(L + W - 140, y + 0.5, 139.5, 37, 5).fill(tint(c.accent, 0.9));
  doc.font('Helvetica-Bold').fontSize(9).fillColor(PDF_COLORS.ink).text(b.label.toUpperCase(), L + 12, y + 8, { width: W - 170 });
  doc.font('Helvetica').fontSize(7.5).fillColor(PDF_COLORS.muted).text(b.subLabel, L + 12, y + 22, { width: W - 170 });
  doc.font('Helvetica-Bold').fontSize(11).fillColor(PDF_COLORS.ink).text(money(d.netPaise), L + W - 140, y + 13, { width: 128, align: 'right' });
  let ny = y + 48;
  if (b.showWords) {
    doc.font('Helvetica').fontSize(8.5).fillColor(PDF_COLORS.ink).text(`Amount In Words : ${d.netInWords}`, L, ny, { width: W, align: 'right' });
    ny += 22;
  }
  doc.y = ny;
  doc.x = L;
}

function divider(c: Ctx, b: B<'divider'>) {
  const { doc, L, W } = c;
  doc.y += b.before;
  ensure(c, 6);
  const y = doc.y;
  if (b.dashed) doc.dash(3, { space: 3 });
  doc.moveTo(L, y).lineTo(L + W, y).lineWidth(b.thickness).strokeColor(b.color).stroke();
  if (b.dashed) doc.undash();
  doc.y = y + b.after;
  doc.x = L;
}
