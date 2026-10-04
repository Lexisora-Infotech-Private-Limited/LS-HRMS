import { deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { extractPdfText, parseBillText, simpleTextPdf, TextLayerBillOcr } from './bill-ocr';

const AMAZON = [
  'Tax Invoice',
  'Sold by: Amazon Seller Services Pvt Ltd',
  'GSTIN: 24AAICA3918J1ZE',
  'Invoice No: IN-8843',
  'Invoice Date: 27/09/2026',
  'Bill to: Lexisora Infotech Pvt Ltd, Ahmedabad',
  'Item: A4 paper (10 reams), pens, notebooks',
  'Taxable value: Rs. 7,170.00',
  'CGST @ 9%: Rs. 645.00',
  'SGST @ 9%: Rs. 645.00',
  'Grand Total: Rs. 8,460.00',
];

describe('Bill OCR (PDF text layer)', () => {
  const ocr = new TextLayerBillOcr();

  it('reads GST, total, invoice no., date and GSTIN from a text PDF (Amazon IN-8843)', async () => {
    const r = await ocr.extract({ buffer: simpleTextPdf(AMAZON, 'Amazon IN-8843'), mime: 'application/pdf' });
    expect(r.textFound).toBe(true);
    expect(r).toMatchObject({ vendorName: 'Amazon Seller Services Pvt Ltd', vendorGstin: '24AAICA3918J1ZE', invoiceNo: 'IN-8843', invoiceDate: '2026-09-27', totalPaise: 846_000, cgstPaise: 64_500, sgstPaise: 64_500, gstPaise: 129_000, confidence: 1 });
  });

  it('reads Flate-compressed content streams', () => {
    const content = 'BT /F1 11 Tf 56 780 Td (Order No: FK-22019) Tj T* (IGST @ 18%: Rs. 3,798.31) Tj T* (Total: Rs. 24,900.00) Tj ET';
    const z = deflateSync(Buffer.from(content, 'latin1'));
    const pdf = Buffer.concat([Buffer.from(`%PDF-1.4\n1 0 obj\n<< /Length ${z.length} /Filter /FlateDecode >>\nstream\n`, 'latin1'), z, Buffer.from('\nendstream\nendobj\n%%EOF\n', 'latin1')]);
    const text = extractPdfText(pdf);
    expect(text).toContain('IGST @ 18%: Rs. 3,798.31');
    expect(parseBillText(text)).toMatchObject({ invoiceNo: 'FK-22019', igstPaise: 379_831, gstPaise: 379_831, totalPaise: 2_490_000 });
  });

  it('a retail bill with no tax lines yields no GST (caller estimates 18/118 and flags it)', () => {
    const r = parseBillText(['Retail invoice', 'Seller: Dell International Services India Pvt Ltd', 'Order No: DL-5521', 'Date: 18 Sep 2026', 'Amount payable: Rs. 1,42,000.00 (inclusive of all taxes)'].join('\n'));
    expect(r.gstPaise).toBeUndefined();
    expect(r.totalPaise).toBe(14_200_000);
    expect(r.invoiceDate).toBe('2026-09-18');
    expect(r.confidence).toBeLessThan(1);
  });

  it('images and non-PDF files have no text layer', async () => {
    expect(await ocr.extract({ buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47]), mime: 'image/png' })).toEqual({ textFound: false, rawText: '', confidence: 0 });
    expect(extractPdfText(Buffer.from('not a pdf'))).toBe('');
  });
});
