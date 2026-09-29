/**
 * Bill OCR adapter. The local adapter reads the PDF text layer (Flate/uncompressed content
 * streams, literal and hex strings) with Node built-ins and runs a rule-based parser.
 * Scanned images have no text layer → nothing is extracted and the caller estimates the
 * input GST (amount × 18/118) and flags it "estimated". A real OCR engine (Tesseract,
 * a cloud OCR API) can implement the same interface later.
 */
import { inflateSync } from 'node:zlib';

export type BillOcrResult = {
  textFound: boolean;
  rawText: string;
  vendorName?: string;
  vendorGstin?: string;
  invoiceNo?: string;
  invoiceDate?: string; // YYYY-MM-DD
  totalPaise?: number;
  gstPaise?: number;
  cgstPaise?: number;
  sgstPaise?: number;
  igstPaise?: number;
  /** fields found / fields expected (0..1). */
  confidence: number;
};

export interface BillOcrAdapter {
  extract(file: { buffer: Buffer; mime: string }): Promise<BillOcrResult>;
}

// ── PDF text layer ──────────────────────────────────────────────────────────

function decodeLiteral(s: string): string {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (c !== '\\') {
      out += c;
      continue;
    }
    const n = s[++i];
    if (n === undefined) break;
    if (n === 'n') out += '\n';
    else if (n === 'r') out += '\r';
    else if (n === 't') out += '\t';
    else if (n === 'b' || n === 'f') out += '';
    else if (/[0-7]/.test(n)) {
      let oct = n;
      while (oct.length < 3 && /[0-7]/.test(s[i + 1] ?? '')) oct += s[++i];
      out += String.fromCharCode(parseInt(oct, 8));
    } else if (n === '\r' || n === '\n') {
      /* line continuation */
    } else out += n;
  }
  return out;
}

function decodeHex(h: string): string {
  const clean = h.replace(/[^0-9a-fA-F]/g, '');
  let out = '';
  for (let i = 0; i + 1 < clean.length; i += 2) {
    const code = parseInt(clean.slice(i, i + 2), 16);
    out += code >= 32 || code === 10 ? String.fromCharCode(code) : '';
  }
  return out;
}

/** Text shown by Tj/TJ/'/" operators in one content stream, one line per BT…ET / Td move. */
function textFromContent(content: string): string {
  const out: string[] = [];
  let line = '';
  const re = /\((?:\\.|[^\\)])*\)|<[0-9a-fA-F\s]*>|\[|\]|T[dD*]|'|"|ET|Tm|T[jJ]/g;
  let inArray = false;
  let pending = '';
  let m: RegExpExecArray | null;
  while ((m = re.exec(content))) {
    const tok = m[0];
    if (tok.startsWith('(')) pending += decodeLiteral(tok.slice(1, -1));
    else if (tok.startsWith('<')) pending += decodeHex(tok.slice(1, -1));
    else if (tok === '[') inArray = true;
    else if (tok === ']') inArray = false;
    else if (tok === 'Tj' || tok === 'TJ') {
      line += pending;
      pending = '';
    } else if (tok === "'" || tok === '"') {
      if (line) out.push(line);
      line = pending;
      pending = '';
    } else if (!inArray && (tok === 'Td' || tok === 'TD' || tok === 'T*' || tok === 'ET' || tok === 'Tm')) {
      if (line.trim()) out.push(line);
      line = '';
    }
  }
  if (line.trim()) out.push(line);
  return out.join('\n');
}

/** Extract the text layer of a PDF (best effort; returns '' for scanned/encrypted files). */
export function extractPdfText(buf: Buffer): string {
  const bin = buf.toString('latin1');
  if (!bin.startsWith('%PDF')) return '';
  const parts: string[] = [];
  const re = /<<([\s\S]*?)>>\s*stream\r?\n/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(bin))) {
    const dict = m[1] ?? '';
    const start = m.index + m[0].length;
    const end = bin.indexOf('endstream', start);
    if (end < 0) break;
    if (/\/(Subtype\s*\/Image|Type\s*\/XObject|FontFile|Length1)/.test(dict)) continue;
    let data = buf.subarray(start, end);
    try {
      if (/\/FlateDecode/.test(dict)) data = inflateSync(data);
      else if (/\/Filter/.test(dict)) continue; // other filters (DCT, LZW…) are not text
    } catch {
      continue;
    }
    const txt = textFromContent(data.toString('latin1'));
    if (txt.trim()) parts.push(txt);
    re.lastIndex = end;
  }
  return parts.join('\n');
}

// ── Rule-based parser ───────────────────────────────────────────────────────

const AMOUNT = '(?:₹|Rs\\.?|INR)?\\s*([0-9][0-9,]*(?:\\.[0-9]{1,2})?)';
const toPaise = (s: string | undefined) => (s ? Math.round(Number(s.replace(/,/g, '')) * 100) : undefined);
const MONTHS: Record<string, string> = { jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12' };

function lastAmount(text: string, label: RegExp): number | undefined {
  const re = new RegExp(`${label.source}[^0-9\\n₹]{0,40}${AMOUNT}`, 'gi');
  let found: number | undefined;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) found = toPaise(m[1]);
  return found;
}

export function parseBillText(text: string): Omit<BillOcrResult, 'textFound' | 'rawText'> {
  const t = text.replace(/ /g, ' ');
  const gstin = /\b(\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z])\b/.exec(t)?.[1];
  const invoiceNo = /(?:Invoice|Bill|Order)\s*(?:No\.?|Number|#)\s*[:\-]?\s*([A-Z0-9][A-Z0-9\-\/]{2,})/i.exec(t)?.[1];
  let invoiceDate: string | undefined;
  const d1 = /(?:Date|Dated)\s*[:\-]?\s*(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})/i.exec(t);
  const d2 = /(?:Date|Dated)\s*[:\-]?\s*(\d{1,2})[\s\-]([A-Za-z]{3})[A-Za-z]*[\s\-,]+(\d{4})/i.exec(t);
  if (d1) invoiceDate = `${d1[3]}-${d1[2]!.padStart(2, '0')}-${d1[1]!.padStart(2, '0')}`;
  else if (d2 && MONTHS[d2[2]!.toLowerCase()]) invoiceDate = `${d2[3]}-${MONTHS[d2[2]!.toLowerCase()]}-${d2[1]!.padStart(2, '0')}`;
  const totalPaise = lastAmount(t, /(?:Grand\s+Total|Total\s+Amount|Invoice\s+Value|Amount\s+Payable|Total)/);
  const cgstPaise = lastAmount(t, /CGST(?:\s*@?\s*\d+(?:\.\d+)?\s*%)?/);
  const sgstPaise = lastAmount(t, /(?:SGST|UTGST)(?:\s*@?\s*\d+(?:\.\d+)?\s*%)?/);
  const igstPaise = lastAmount(t, /IGST(?:\s*@?\s*\d+(?:\.\d+)?\s*%)?/);
  let gstPaise: number | undefined;
  if (cgstPaise || sgstPaise || igstPaise) gstPaise = (cgstPaise ?? 0) + (sgstPaise ?? 0) + (igstPaise ?? 0);
  else gstPaise = lastAmount(t, /(?:Total\s+GST|GST\s+Amount|Total\s+Tax|Tax\s+Amount|GST(?!IN))(?:\s*@?\s*\d+(?:\.\d+)?\s*%)?/);
  const vendorName = /^(?:Sold\s+by|Seller|From|Vendor)\s*[:\-]\s*(.+)$/im.exec(t)?.[1]?.trim() ?? t.split('\n').map((s) => s.trim()).find((s) => /[A-Za-z]{3,}/.test(s) && !/invoice|bill|tax/i.test(s));
  const expected = [gstin, invoiceNo, invoiceDate, totalPaise, gstPaise];
  const confidence = Math.round((expected.filter((x) => x !== undefined).length / expected.length) * 100) / 100;
  return { vendorName, vendorGstin: gstin, invoiceNo, invoiceDate, totalPaise, gstPaise, cgstPaise, sgstPaise, igstPaise, confidence };
}

/** Default adapter: PDF text layer + parser (images → no text). */
export class TextLayerBillOcr implements BillOcrAdapter {
  async extract(file: { buffer: Buffer; mime: string }): Promise<BillOcrResult> {
    const rawText = file.mime === 'application/pdf' ? extractPdfText(file.buffer) : '';
    if (!rawText.trim()) return { textFound: false, rawText: '', confidence: 0 };
    return { textFound: true, rawText: rawText.slice(0, 20_000), ...parseBillText(rawText) };
  }
}

// ── Minimal text PDF writer (seed bills, sample filing documents, tests) ────────

function esc(s: string) {
  return s.replace(/[\\()]/g, (c) => `\\${c}`).replace(/[^\x20-\x7e]/g, '?');
}

/** One-page A4 PDF with Helvetica text lines (uncompressed, valid xref). */
export function simpleTextPdf(lines: string[], title = 'Document'): Buffer {
  const content = ['BT', '/F1 11 Tf', '14 TL', '56 780 Td', ...lines.flatMap((l, i) => (i === 0 ? [`/F1 15 Tf (${esc(l)}) Tj`, '/F1 11 Tf T* T*'] : [`(${esc(l)}) Tj T*`])), 'ET'].join('\n');
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    `<< /Title (${esc(title)}) /Producer (Lexisora HRMS) >>`,
  ];
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(Buffer.byteLength(out, 'latin1'));
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R /Info 6 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}
