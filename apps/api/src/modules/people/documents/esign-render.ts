import type { Pdf } from '../../../core/pdf/pdf.service';
import { PDF_COLORS } from '../../../core/pdf/pdf.service';

/** Everything needed to (re-)render an offer letter / NDA deterministically. */
export type EsignDocData = {
  kind: 'OFFER' | 'NDA';
  company: string;
  companyAddress: string | null;
  title: string;
  dateLabel: string;
  employee: { name: string; designation: string | null; department: string | null; empCode: string; joiningDate: string | null; email: string };
  paragraphs: string[];
  annexure: { component: string; monthly: string; annual: string; isTotal?: boolean }[] | null;
  annexureNote: string | null;
  signatory: { name: string; title: string };
};

export type SignatureStamp = {
  signerName: string;
  signerEmail: string;
  signedAtLabel: string;
  signatureType: 'DRAWN' | 'TYPED';
  png?: Buffer | null;
  typedName?: string | null;
  typedFont?: string | null;
};

export type CertificateData = {
  envelopeId: string;
  title: string;
  originalSha256: string;
  signer: { name: string; email: string; ip: string | null; userAgent: string | null };
  events: { type: string; at: string; ip: string | null }[];
};

/** Merge-field replacement for template bodies ({{name}}, {{designation}} …). */
export function mergeFields(body: string, fields: Record<string, string | null | undefined>): string {
  return body.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k: string) => fields[k] ?? '');
}

/**
 * Render the offer letter / NDA. With `stamp`, the acceptance block carries the signature
 * image or typed name plus "Digitally signed by … on …", and a certificate page follows.
 */
export function renderEsignDocument(doc: Pdf, d: EsignDocData, stamp?: SignatureStamp, cert?: CertificateData) {
  const left = doc.page.margins.left;
  const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  doc.font('Times-Bold').fontSize(22).fillColor(PDF_COLORS.ink).text(d.company);
  if (d.companyAddress) doc.font('Helvetica').fontSize(8.5).fillColor(PDF_COLORS.muted).text(d.companyAddress);
  const y0 = doc.y + 6;
  doc.moveTo(left, y0).lineTo(left + width, y0).lineWidth(1).strokeColor(PDF_COLORS.accent).stroke();
  doc.moveDown(1.4);
  doc.font('Helvetica').fontSize(9).fillColor(PDF_COLORS.muted).text(d.dateLabel, { align: 'right' });
  doc.moveDown(0.6);
  doc.font('Times-Bold').fontSize(18).fillColor(PDF_COLORS.ink).text(d.title);
  doc.moveDown(0.5);
  doc.font('Helvetica').fontSize(10).fillColor(PDF_COLORS.ink);
  const e = d.employee;
  doc.text(`${e.name}${e.empCode ? ` · ${e.empCode}` : ''}`);
  if (e.designation || e.department) doc.fillColor(PDF_COLORS.muted).text([e.designation, e.department].filter(Boolean).join(' · '));
  doc.fillColor(PDF_COLORS.ink).moveDown(0.8);
  for (const p of d.paragraphs) {
    doc.font('Helvetica').fontSize(10.5).fillColor(PDF_COLORS.ink).text(p, { align: 'justify', lineGap: 2 });
    doc.moveDown(0.6);
  }

  if (d.kind === 'OFFER') {
    doc.moveDown(0.4);
    doc.font('Times-Bold').fontSize(13).fillColor(PDF_COLORS.ink).text('Annexure A · Compensation');
    doc.moveDown(0.3);
    if (d.annexure?.length) {
      const cols = [0.5, 0.25, 0.25];
      const row = (cells: string[], bold: boolean) => {
        const y = doc.y;
        let x = left;
        cells.forEach((c, i) => {
          doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 8.5 : 10).fillColor(bold ? PDF_COLORS.muted : PDF_COLORS.ink);
          doc.text(c, x + 3, y + 4, { width: cols[i]! * width - 6, align: i ? 'right' : 'left' });
          x += cols[i]! * width;
        });
        doc.y = y + 20;
        doc.moveTo(left, doc.y).lineTo(left + width, doc.y).lineWidth(0.5).strokeColor(PDF_COLORS.rule).stroke();
      };
      row(['COMPONENT', 'MONTHLY', 'ANNUAL'], true);
      for (const r of d.annexure) row([r.component, r.monthly, r.annual], !!r.isTotal);
      doc.moveDown(0.6);
    }
    if (d.annexureNote) doc.font('Helvetica-Oblique').fontSize(9.5).fillColor(PDF_COLORS.muted).text(d.annexureNote);
    doc.x = left;
  }

  // Signature blocks
  if (doc.y > doc.page.height - 200) doc.addPage();
  doc.moveDown(1.5);
  const by = doc.y;
  const half = width / 2 - 10;
  doc.font('Helvetica').fontSize(9).fillColor(PDF_COLORS.muted).text(`For ${d.company}`, left, by, { width: half });
  doc.font('Times-Italic').fontSize(18).fillColor(PDF_COLORS.ink).text(d.signatory.name, left, by + 18, { width: half });
  doc.moveTo(left, by + 48).lineTo(left + half, by + 48).lineWidth(0.5).strokeColor(PDF_COLORS.rule).stroke();
  doc.font('Helvetica').fontSize(9).fillColor(PDF_COLORS.ink).text(`${d.signatory.name} · ${d.signatory.title}`, left, by + 52, { width: half });

  const rx = left + width / 2 + 10;
  doc.font('Helvetica').fontSize(9).fillColor(PDF_COLORS.muted).text('Accepted by the employee', rx, by, { width: half });
  if (stamp) {
    if (stamp.signatureType === 'DRAWN' && stamp.png) {
      try {
        doc.image(stamp.png, rx, by + 12, { fit: [half, 34], valign: 'center' });
      } catch {
        doc.font('Times-Italic').fontSize(18).fillColor(PDF_COLORS.ink).text(stamp.signerName, rx, by + 18, { width: half });
      }
    } else {
      const font = stamp.typedFont && ['Times-Italic', 'Helvetica-Oblique', 'Courier-Oblique'].includes(stamp.typedFont) ? stamp.typedFont : 'Times-Italic';
      doc.font(font).fontSize(20).fillColor(PDF_COLORS.ink).text(stamp.typedName ?? stamp.signerName, rx, by + 16, { width: half });
    }
  }
  doc.moveTo(rx, by + 48).lineTo(rx + half, by + 48).lineWidth(0.5).strokeColor(PDF_COLORS.rule).stroke();
  doc.font('Helvetica').fontSize(9).fillColor(PDF_COLORS.ink).text(e.name, rx, by + 52, { width: half });
  if (stamp) {
    doc.font('Helvetica').fontSize(7.5).fillColor(PDF_COLORS.accent).text(`Digitally signed by ${stamp.signerName} on ${stamp.signedAtLabel} IST`, rx, by + 65, { width: half });
  }
  doc.x = left;

  if (cert) {
    doc.addPage();
    doc.font('Times-Bold').fontSize(20).fillColor(PDF_COLORS.ink).text('Certificate of completion');
    doc.font('Helvetica').fontSize(8).fillColor(PDF_COLORS.accent).text('LEXISORA E-SIGN · LOCAL PROVIDER', { characterSpacing: 1.2 });
    doc.moveDown(1);
    const kv = (k: string, v: string) => {
      const y = doc.y;
      doc.font('Helvetica').fontSize(9).fillColor(PDF_COLORS.muted).text(k, left, y, { width: 150 });
      doc.font('Helvetica').fontSize(9.5).fillColor(PDF_COLORS.ink).text(v, left + 150, y, { width: width - 150 });
      doc.moveDown(0.4);
    };
    kv('Envelope', cert.envelopeId);
    kv('Document', cert.title);
    kv('Original SHA-256', cert.originalSha256);
    kv('Signer', `${cert.signer.name} <${cert.signer.email}>`);
    kv('IP address', cert.signer.ip ?? '—');
    kv('Device', (cert.signer.userAgent ?? '—').slice(0, 160));
    doc.moveDown(0.8);
    doc.font('Times-Bold').fontSize(13).fillColor(PDF_COLORS.ink).text('Event timeline', left);
    doc.moveDown(0.3);
    for (const ev of cert.events) kv(ev.at, `${ev.type}${ev.ip ? ` · ${ev.ip}` : ''}`);
    doc.moveDown(0.8);
    doc.font('Helvetica').fontSize(8.5).fillColor(PDF_COLORS.muted).text(
      'The signed document hash is recorded in the tenant audit log and can be checked at /api/v1/esign/verify?sha256=<hash>. ' +
        'Signatures were captured after the signer ticked "I have read and agree to this document".',
      left,
      undefined,
      { width },
    );
  }
}
