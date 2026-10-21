import { PAYSLIP_PAGE, applyTextCase, planPayslipTable, tableBodyRows, type PayslipCanvas, type PayslipDetail, type PayslipElementOf, type PayslipElementType } from '@lexisora/shared';
import { PDF_COLORS, type Pdf, type PdfService } from '../../../core/pdf/pdf.service';
import { fieldValues, fillFields, fontFor } from './payslip-blocks';

/** "Rs. 78,420.00" — built-in PDF fonts have no ₹ glyph. */
const money = (paise: number) => `Rs. ${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

type Ctx = { doc: Pdf; d: PayslipDetail; v: Record<string, string>; logo: Buffer | null };
type El<T extends PayslipElementType> = PayslipElementOf<T>;
type Style = El<'text'>['style'];

const style = (doc: Pdf, s: Style, bold = s.bold) => doc.font(fontFor(s, bold)).fontSize(s.size).fillColor(s.color);
const align = (s: Style) => s.align.toLowerCase() as 'left' | 'center' | 'right';

/**
 * Render a payslip from a free-canvas design: every element is drawn at its own x / y on one A4 page, in list order
 * (later elements sit on top). Text is exactly what the company typed; only {{fields}} and the earnings / deductions
 * amounts are filled in from payroll.
 */
export function renderCanvas(pdf: PdfService, d: PayslipDetail, design: PayslipCanvas, logo: Buffer | null, opts?: PDFKit.PDFDocumentOptions): Promise<Buffer> {
  return pdf.render(
    (doc) => {
      const c: Ctx = { doc, d, v: fieldValues(d), logo };
      for (const e of design.elements) {
        switch (e.type) {
          case 'text': text(c, e); break;
          case 'logo': drawLogo(c, e); break;
          case 'line': line(c, e); break;
          case 'box': box(c, e); break;
          case 'details': details(c, e); break;
          case 'table': table(c, e); break;
        }
      }
    },
    { size: [PAYSLIP_PAGE.width, PAYSLIP_PAGE.height], margin: 0, ...opts },
  );
}

function text(c: Ctx, e: El<'text'>) {
  const t = applyTextCase(fillFields(e.text, c.v).trim(), e.style.textCase);
  if (!t) return; // a line made only of empty fields (e.g. no idle deduction this month) is left out
  const lead = e.lead?.text.trim() ? applyTextCase(fillFields(e.lead.text, c.v).trim(), e.style.textCase) : '';
  if (!lead && !e.fit) {
    style(c.doc, e.style).text(t, e.x, e.y, { width: e.w, height: Math.max(e.h, e.style.size * 1.3), align: align(e.style), ellipsis: true });
    return;
  }
  leadLine(c, e, lead, t);
}

/**
 * A line made of a label in its own colour followed by the text. It is measured first, so it is placed as one block whatever the
 * length of the text (left, centred or right as chosen), and with "keep on one line" it shrinks just enough to fit the box.
 */
function leadLine(c: Ctx, e: El<'text'>, lead: string, body: string) {
  const { doc } = c;
  const leadBold = e.lead?.bold ?? e.style.bold;
  const widths = (size: number) => {
    doc.font(fontFor(e.style, leadBold)).fontSize(size);
    const l = lead ? doc.widthOfString(`${lead} `) : 0;
    doc.font(fontFor(e.style)).fontSize(size);
    return { l, b: doc.widthOfString(body) };
  };
  let size = e.style.size;
  let w = widths(size);
  if (e.fit) {
    while (w.l + w.b > e.w && size > 6) {
      size = Math.max(6, size - 0.25);
      w = widths(size);
    }
  }
  const draw = (t: string, color: string, bold: boolean, x: number, y: number, o: PDFKit.Mixins.TextOptions) => doc.font(fontFor(e.style, bold)).fontSize(size).fillColor(color).text(t, x, y, o);
  const y = e.y + (e.style.size - size) / 2;
  if (w.l + w.b <= e.w) {
    const total = w.l + w.b;
    const x = e.style.align === 'RIGHT' ? e.x + e.w - total : e.style.align === 'CENTER' ? e.x + (e.w - total) / 2 : e.x;
    if (lead) draw(`${lead} `, e.lead!.color, leadBold, x, y, { lineBreak: false });
    draw(body, e.style.color, e.style.bold, x + w.l, y, { lineBreak: false });
    return;
  }
  // Too long for one line even so (or "keep on one line" is off): the label and text flow and wrap together inside the box.
  const o = { width: e.w, height: Math.max(e.h, size * 1.3), align: align(e.style), ellipsis: true };
  if (lead) draw(`${lead} `, e.lead!.color, leadBold, e.x, y, { ...o, continued: true });
  draw(body, e.style.color, e.style.bold, e.x, y, lead ? { ...o, continued: false } : o);
}

function drawLogo(c: Ctx, e: El<'logo'>) {
  if (!c.logo) return;
  try {
    c.doc.image(c.logo, e.x, e.y, { fit: [e.w, e.h] });
  } catch {
    /* a bad image must never stop a payslip being produced */
  }
}

function line(c: Ctx, e: El<'line'>) {
  const { doc } = c;
  if (e.dashed) doc.dash(3, { space: 3 });
  doc.moveTo(e.x, e.y).lineTo(e.x + e.w, e.y + e.h).lineWidth(e.thickness).strokeColor(e.color).stroke();
  if (e.dashed) doc.undash();
}

function box(c: Ctx, e: El<'box'>) {
  const { doc } = c;
  const r = e.corners === 'NONE' ? 0 : Math.min(e.radius, e.w / 2, e.h / 2);
  const rt = e.corners === 'ALL' || e.corners === 'TOP' ? r : 0;
  const rb = e.corners === 'ALL' || e.corners === 'BOTTOM' ? r : 0;
  const path = () => {
    if (rt === rb) return rt > 0 ? doc.roundedRect(e.x, e.y, e.w, e.h, rt) : doc.rect(e.x, e.y, e.w, e.h);
    // different top and bottom radii: draw the outline by hand (a bezier per rounded corner)
    const { x, y, w, h } = e;
    const k = 0.5522847498;
    return doc
      .moveTo(x + rt, y)
      .lineTo(x + w - rt, y)
      .bezierCurveTo(x + w - rt + k * rt, y, x + w, y + rt - k * rt, x + w, y + rt)
      .lineTo(x + w, y + h - rb)
      .bezierCurveTo(x + w, y + h - rb + k * rb, x + w - rb + k * rb, y + h, x + w - rb, y + h)
      .lineTo(x + rb, y + h)
      .bezierCurveTo(x + rb - k * rb, y + h, x, y + h - rb + k * rb, x, y + h - rb)
      .lineTo(x, y + rt)
      .bezierCurveTo(x, y + rt - k * rt, x + rt - k * rt, y, x + rt, y)
      .closePath();
  };
  if (e.fill) path().fill(e.fill);
  if (e.border) path().lineWidth(e.borderWidth).strokeColor(e.border).stroke();
}

function details(c: Ctx, e: El<'details'>) {
  const { doc } = c;
  const sepW = e.separator ? 8 : 0;
  const valueX = e.x + e.labelWidth + sepW;
  const valueW = Math.max(30, e.w - e.labelWidth - sepW);
  e.rows.forEach((r, i) => {
    const y = e.y + i * e.rowHeight;
    const raw = applyTextCase(fillFields(r.value, c.v).trim(), e.style.textCase);
    doc.font(fontFor({ ...e.style, bold: false }, false)).fontSize(e.style.size * 0.9).fillColor(e.labelColor).text(r.label, e.x, y, { width: e.labelWidth - 4, height: e.rowHeight, ellipsis: true });
    if (e.separator) doc.font(fontFor({ ...e.style, bold: false }, false)).fontSize(e.style.size).fillColor(e.labelColor).text(e.separator, valueX - sepW, y, { width: sepW, lineBreak: false });
    style(doc, e.style).text(raw || '—', valueX, y, { width: valueW, height: e.rowHeight, ellipsis: true });
  });
}

type Line = { label: string; full: number | null; amount: number };

function table(c: Ctx, e: El<'table'>) {
  const { doc, d } = c;
  const earnings = e.kind === 'EARNINGS';
  const full = earnings && e.showFullMonth;
  const lines: Line[] = earnings ? d.earnings.map((x) => ({ label: x.label, full: x.fullPaise, amount: x.amountPaise })) : d.deductions.map((x) => ({ label: x.label, full: null, amount: x.amountPaise }));
  const total = earnings ? d.totalEarningsPaise : d.totalDeductionsPaise;
  const widths = (full ? [0.5, 0.25, 0.25] : [0.7, 0.3]).map((f) => f * e.w);
  const rightCols = full ? [1, 2] : [1];
  const body = tableBodyRows(e, lines, money, (t) => fillFields(t, c.v));
  const plan = planPayslipTable(e, body.map((b) => b.key));
  const head = full ? [e.heading, e.fullMonthHeading, e.amountHeading] : [e.heading, e.amountHeading];
  const totalCells = full ? [e.totalLabel, '', money(total)] : [e.totalLabel, money(total)];

  let y = e.y;
  plan.forEach((p, i) => {
    y += p.gapBefore;
    const cells = p.kind === 'head' ? head : p.kind === 'total' ? totalCells : body[i - 1]!.cells;
    if (p.kind === 'total' && e.totalFill) doc.rect(e.x, y, e.w, p.height).fill(e.totalFill);
    let x = e.x;
    const hs = e.headStyle;
    const pad = e.cellPadding ?? 3;
    const ty = y + Math.max(2, (p.height - (p.kind === 'head' ? (hs ? hs.size : Math.min(8, e.style.size)) : e.style.size)) / 2 - 1);
    cells.forEach((t, j) => {
      if (p.kind === 'head') (hs ? doc.font(fontFor(hs, hs.bold)).fontSize(hs.size).fillColor(hs.color) : doc.font('Helvetica-Bold').fontSize(Math.min(8, e.style.size)).fillColor(e.headColor));
      else style(doc, e.style, p.kind === 'total' ? true : e.style.bold);
      doc.text(p.kind === 'head' ? (hs ? applyTextCase(t, hs.textCase) : t.toUpperCase()) : j === 0 ? applyTextCase(t, e.style.textCase) : t, x + pad, ty, { width: Math.max(1, widths[j]! - 2 * pad), height: p.height, align: rightCols.includes(j) ? 'right' : 'left', ellipsis: true, lineBreak: false });
      x += widths[j]!;
    });
    y += p.height;
    if (p.line) {
      if (e.lineDashed) doc.dash(2, { space: 2 });
      doc.moveTo(e.x, y).lineTo(e.x + e.w, y).lineWidth(e.lineWidth).strokeColor(e.lineColor).stroke();
      if (e.lineDashed) doc.undash();
    }
    y += p.gapAfter;
  });
}
