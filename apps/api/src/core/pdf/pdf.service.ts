import { Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';

export type Pdf = PDFKit.PDFDocument;

export const PDF_COLORS = { ink: '#201f1d', muted: '#605d5d', accent: '#b68235', rule: '#d7d3d3' };

/**
 * Builds PDFs (payslips, GST invoices, certificates, offer letters, ID cards, visiting cards).
 * Uses Times (headings) / Helvetica (body) — the closest built-ins to Cormorant/Lora.
 */
@Injectable()
export class PdfService {
  render(build: (doc: Pdf) => void, opts: PDFKit.PDFDocumentOptions = { size: 'A4', margin: 48 }): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ bufferPages: true, ...opts });
      const chunks: Buffer[] = [];
      doc.on('data', (c: Buffer) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
      try {
        build(doc);
        doc.end();
      } catch (e) {
        reject(e);
      }
    });
  }

  /** Standard letterhead: company name, kicker line, accent rule. */
  header(doc: Pdf, company: string, kicker: string, accent = PDF_COLORS.accent) {
    doc.font('Times-Bold').fontSize(22).fillColor(PDF_COLORS.ink).text(company);
    doc.font('Helvetica').fontSize(8).fillColor(accent).text(kicker.toUpperCase(), { characterSpacing: 1.2 });
    const y = doc.y + 6;
    doc.moveTo(doc.page.margins.left, y).lineTo(doc.page.width - doc.page.margins.right, y).lineWidth(1).strokeColor(accent).stroke();
    doc.moveDown(1.2);
    doc.fillColor(PDF_COLORS.ink);
  }

  /** Simple two-column key/value table. */
  keyValues(doc: Pdf, rows: [string, string][], colWidth = 180) {
    const x = doc.page.margins.left;
    for (const [k, v] of rows) {
      const y = doc.y;
      doc.font('Helvetica').fontSize(9).fillColor(PDF_COLORS.muted).text(k, x, y, { width: colWidth });
      doc.font('Helvetica').fontSize(10).fillColor(PDF_COLORS.ink).text(v, x + colWidth, y);
      doc.moveDown(0.35);
    }
  }

  /** Grid table with header row. `widths` are fractions of the content width. */
  table(doc: Pdf, head: string[], rows: string[][], widths?: number[], alignRight: number[] = []) {
    const left = doc.page.margins.left;
    const full = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const w = (widths ?? head.map(() => 1 / head.length)).map((f) => f * full);
    const line = (cells: string[], bold: boolean) => {
      const y = doc.y;
      let x = left;
      let h = 0;
      cells.forEach((c, i) => {
        doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 8 : 9.5).fillColor(bold ? PDF_COLORS.muted : PDF_COLORS.ink);
        doc.text(c, x + 3, y + 4, { width: w[i]! - 6, align: alignRight.includes(i) ? 'right' : 'left' });
        h = Math.max(h, doc.y - y);
        x += w[i]!;
      });
      doc.y = y + h + 4;
      doc.moveTo(left, doc.y).lineTo(left + full, doc.y).lineWidth(0.5).strokeColor(PDF_COLORS.rule).stroke();
    };
    line(head.map((h) => h.toUpperCase()), true);
    rows.forEach((r) => line(r, false));
    doc.moveDown(0.8);
    doc.x = left;
  }
}
