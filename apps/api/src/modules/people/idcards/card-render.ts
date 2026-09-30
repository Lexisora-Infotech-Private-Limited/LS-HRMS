import sharp from 'sharp';
import QRCode from 'qrcode';
import type { IdCardElement } from '@lexisora/shared';

/**
 * Card rendering shared by ID cards and visiting cards: template elements (mm) → SVG →
 * PNG (sharp, 300 DPI) → PDF pages (pdfkit embeds the PNG). One renderer keeps the
 * designer preview, PNG downloads and print PDFs consistent.
 */

export const PX_PER_MM_300DPI = 300 / 25.4;
export const PT_PER_MM = 72 / 25.4;

export type CardImages = { photo?: string | null; qr?: string | null; logo?: string | null; bg?: string | null };

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!);

const FAMILY = { serif: "Georgia, 'Times New Roman', serif", sans: "'Segoe UI', Arial, Helvetica, sans-serif" };

/** Rough text width in mm for auto-shrinking long names (avg glyph ≈ 0.52 em). */
export function estimateTextWidthMm(text: string, sizePt: number): number {
  return text.length * sizePt * 0.52 * (25.4 / 72);
}

export function fitFontSize(text: string, sizePt: number, widthMm: number): number {
  const w = estimateTextWidthMm(text, sizePt);
  if (w <= widthMm || !text) return sizePt;
  return Math.max(5, Math.floor((sizePt * widthMm) / w * 10) / 10);
}

/** Resolve an element's display text: `text` acts as a label prefix for bound fields. */
export function elementText(el: IdCardElement, data: Record<string, string | null | undefined>): string {
  if (el.type === 'STATIC') return el.text ?? '';
  if (el.type === 'SIGNATURE') return el.text || 'Authorised signatory';
  if (el.binding) {
    const v = data[el.binding];
    return v ? `${el.text ?? ''}${v}` : '';
  }
  return el.text ?? '';
}

export function renderCardSvg(
  side: { widthMm: number; heightMm: number; elements: IdCardElement[] },
  data: Record<string, string | null | undefined>,
  images: CardImages,
  pxPerMm = PX_PER_MM_300DPI,
): string {
  const W = Math.round(side.widthMm * pxPerMm);
  const H = Math.round(side.heightMm * pxPerMm);
  const m = (v: number) => (v * pxPerMm).toFixed(2);
  const parts: string[] = [`<rect x="0" y="0" width="${W}" height="${H}" fill="#ffffff"/>`];
  if (images.bg) parts.push(`<image href="${images.bg}" x="0" y="0" width="${W}" height="${H}" preserveAspectRatio="xMidYMid slice"/>`);
  const els = [...side.elements].sort((a, b) => (a.z ?? 0) - (b.z ?? 0));
  for (const el of els) {
    const x = el.xMm;
    const y = el.yMm;
    const w = el.wMm;
    const h = el.hMm;
    switch (el.type) {
      case 'SHAPE':
        parts.push(`<rect x="${m(x)}" y="${m(y)}" width="${m(w)}" height="${m(h)}" fill="${el.fill ?? '#b68235'}"/>`);
        break;
      case 'PHOTO':
        if (images.photo) {
          parts.push(`<image href="${images.photo}" x="${m(x)}" y="${m(y)}" width="${m(w)}" height="${m(h)}" preserveAspectRatio="xMidYMid slice"/>`);
        } else {
          parts.push(`<rect x="${m(x)}" y="${m(y)}" width="${m(w)}" height="${m(h)}" fill="none" stroke="#9a9696" stroke-dasharray="6 5" stroke-width="2"/>`);
          parts.push(`<text x="${m(x + w / 2)}" y="${m(y + h / 2)}" font-family="${FAMILY.sans}" font-size="${m(2.6)}" fill="#9a9696" text-anchor="middle" dominant-baseline="middle">Photo</text>`);
        }
        break;
      case 'QR':
        if (images.qr) parts.push(`<image href="${images.qr}" x="${m(x)}" y="${m(y)}" width="${m(w)}" height="${m(h)}"/>`);
        else parts.push(`<rect x="${m(x)}" y="${m(y)}" width="${m(w)}" height="${m(h)}" fill="none" stroke="#9a9696" stroke-dasharray="6 5" stroke-width="2"/>`);
        break;
      case 'LOGO':
        if (images.logo) {
          parts.push(`<image href="${images.logo}" x="${m(x)}" y="${m(y)}" width="${m(w)}" height="${m(h)}" preserveAspectRatio="xMidYMid meet"/>`);
          break;
        }
      // falls through: no logo uploaded → tenant name as text
      // eslint-disable-next-line no-fallthrough
      case 'TEXT':
      case 'STATIC':
      case 'SIGNATURE': {
        const font = { size: 10, weight: 'normal', color: '#201f1d', align: 'center', family: 'sans', ...(el.font ?? {}) } as Required<NonNullable<IdCardElement['font']>>;
        const raw = el.type === 'LOGO' ? (data['tenant.name'] ?? '') : elementText(el, data);
        if (el.type === 'SIGNATURE') {
          parts.push(`<line x1="${m(x)}" y1="${m(y)}" x2="${m(x + w)}" y2="${m(y)}" stroke="#d7d3d3" stroke-width="2"/>`);
        }
        if (!raw) break;
        const lines = raw.split('\n');
        const sizePt = lines.length === 1 ? fitFontSize(raw, font.size, w) : Math.min(...lines.map((l) => fitFontSize(l, font.size, w)));
        const sizeMm = sizePt * (25.4 / 72);
        const anchor = font.align === 'left' ? 'start' : font.align === 'right' ? 'end' : 'middle';
        const tx = font.align === 'left' ? x : font.align === 'right' ? x + w : x + w / 2;
        const lineH = sizeMm * 1.25;
        const top = el.type === 'SIGNATURE' ? y + 1 : y + h / 2 - (lineH * (lines.length - 1)) / 2;
        lines.forEach((ln, i) => {
          const ty = top + i * lineH;
          parts.push(
            `<text x="${m(tx)}" y="${m(ty)}" font-family="${font.family === 'serif' ? FAMILY.serif : FAMILY.sans}" font-size="${m(sizeMm)}" font-weight="${font.weight}" fill="${font.color}" text-anchor="${anchor}" dominant-baseline="${el.type === 'SIGNATURE' ? 'hanging' : 'middle'}">${esc(ln)}</text>`,
          );
        });
        break;
      }
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${parts.join('')}</svg>`;
}

export async function svgToPng(svg: string): Promise<Buffer> {
  return sharp(Buffer.from(svg), { density: 72 }).png().toBuffer();
}

export async function qrDataUrl(text: string): Promise<string> {
  return QRCode.toDataURL(text, { margin: 0, width: 360, errorCorrectionLevel: 'M', color: { dark: '#201f1dff', light: '#ffffffff' } });
}

/** Image bytes → data URL (resized so SVGs stay small). */
export async function toDataUrl(buf: Buffer, maxPx = 700): Promise<string | null> {
  try {
    const out = await sharp(buf).rotate().resize(maxPx, maxPx, { fit: 'inside', withoutEnlargement: true }).png().toBuffer();
    return `data:image/png;base64,${out.toString('base64')}`;
  } catch {
    return null;
  }
}

// ── Seeded ID card templates ──────────────────────────────────────────────

type El = IdCardElement;
const t = (id: string, binding: El['binding'], x: number, y: number, w: number, h: number, size: number, extra: Partial<El> = {}, font: Partial<NonNullable<El['font']>> = {}): El => ({
  id,
  type: 'TEXT',
  binding,
  xMm: x,
  yMm: y,
  wMm: w,
  hMm: h,
  z: 1,
  font: { size, weight: 'normal', color: '#201f1d', align: 'center', family: 'sans', ...font },
  ...extra,
});

export function classicPortrait(): { front: El[]; back: El[] } {
  return {
    front: [
      t('company', 'tenant.name', 2, 2.5, 49.98, 7, 13, { label: 'Company name' }, { family: 'serif' }),
      { id: 'rule', type: 'SHAPE', label: 'Accent rule', xMm: 0, yMm: 10.6, wMm: 53.98, hMm: 0.6, fill: '#b68235', z: 0 },
      { id: 'photo', type: 'PHOTO', label: 'Photo', binding: 'employee.photo', xMm: 16, yMm: 16.5, wMm: 22, hMm: 25.6, z: 1 },
      t('name', 'employee.full_name', 2, 44.5, 49.98, 8, 22, { label: 'Full name' }, { family: 'serif' }),
      t('designation', 'employee.designation', 2, 52, 49.98, 5, 9, { label: 'Designation' }, { color: '#605d5d' }),
      t('code', 'employee.code_blood', 2, 58.5, 49.98, 5, 9, { label: 'Employee ID · Blood group' }),
      { id: 'bar', type: 'SHAPE', label: 'Footer bar', xMm: 0, yMm: 83.3, wMm: 53.98, hMm: 2.3, fill: '#e3c79a', z: 0 },
    ],
    back: [
      { id: 'qr', type: 'QR', label: 'QR code', binding: 'qr.verify_url', xMm: 16.5, yMm: 6, wMm: 21, hMm: 21, z: 1 },
      t('found', null, 3, 31, 47.98, 4, 7.5, { type: 'STATIC', text: 'If found, please return to', label: 'Return note' }),
      t('return', 'settings.return_address', 3, 37, 47.98, 8, 7.5, { label: 'Return address' }),
      t('emergency', 'settings.emergency_line', 3, 47, 47.98, 4, 7.5, { text: 'Emergency: ', label: 'Emergency contact' }),
      t('sign', null, 5, 76, 43.98, 5, 7.5, { type: 'SIGNATURE', text: 'Authorised signatory', label: 'Signature' }),
    ],
  };
}

export function landscapeMinimal(): { front: El[]; back: El[] } {
  return {
    front: [
      t('company', 'tenant.name', 4, 3, 77.6, 6, 11, { label: 'Company name' }, { family: 'serif', align: 'left' }),
      { id: 'rule', type: 'SHAPE', label: 'Accent rule', xMm: 4, yMm: 10, wMm: 77.6, hMm: 0.4, fill: '#b68235', z: 0 },
      { id: 'photo', type: 'PHOTO', label: 'Photo', binding: 'employee.photo', xMm: 4, yMm: 14, wMm: 24, hMm: 28, z: 1 },
      t('name', 'employee.full_name', 32, 16, 50, 8, 16, { label: 'Full name' }, { family: 'serif', align: 'left' }),
      t('designation', 'employee.designation', 32, 25, 50, 5, 9, { label: 'Designation' }, { align: 'left', color: '#605d5d' }),
      t('department', 'employee.department', 32, 30.5, 50, 5, 8, { label: 'Department' }, { align: 'left', color: '#605d5d' }),
      t('code', 'employee.code_blood', 32, 37, 50, 5, 9, { label: 'Employee ID · Blood group' }, { align: 'left' }),
    ],
    back: [
      { id: 'qr', type: 'QR', label: 'QR code', binding: 'qr.verify_url', xMm: 4, yMm: 12, wMm: 26, hMm: 26, z: 1 },
      t('found', null, 34, 12, 48, 4, 7.5, { type: 'STATIC', text: 'If found, please return to', label: 'Return note' }, { align: 'left' }),
      t('return', 'settings.return_address', 34, 17, 48, 8, 7.5, { label: 'Return address' }, { align: 'left' }),
      t('emergency', 'settings.emergency_line', 34, 27, 48, 4, 7.5, { text: 'Emergency: ', label: 'Emergency contact' }, { align: 'left' }),
      t('sign', null, 34, 42, 44, 5, 7, { type: 'SIGNATURE', text: 'Authorised signatory', label: 'Signature' }, { align: 'left' }),
    ],
  };
}
