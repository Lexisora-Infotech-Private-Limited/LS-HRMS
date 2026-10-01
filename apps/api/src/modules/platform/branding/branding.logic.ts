import { BRAND_PRESETS } from '@lexisora/shared';

/**
 * Branding helpers: logo validation (SVG sanitising, PNG size) and preset matching. Pure and tested.
 */

/** Remove scripts, event handlers, external/javascript links and foreign objects from an SVG. */
export function sanitizeSvg(svg: string): string {
  return svg
    .replace(/<!DOCTYPE[^>]*>/gi, '')
    .replace(/<script[\s\S]*?<\/script\s*>/gi, '')
    .replace(/<script[^>]*\/>/gi, '')
    .replace(/<foreignObject[\s\S]*?<\/foreignObject\s*>/gi, '')
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/\s(xlink:)?href\s*=\s*("\s*javascript:[^"]*"|'\s*javascript:[^']*'|javascript:[^\s>]+)/gi, '')
    .replace(/\s(xlink:)?href\s*=\s*("https?:[^"]*"|'https?:[^']*')/gi, '');
}

/** Does this look like an SVG document? */
export function isSvg(text: string): boolean {
  return /<svg[\s>]/i.test(text.slice(0, 2000));
}

/** Height of a PNG from its IHDR chunk, or null when the bytes aren't a PNG. */
export function pngHeight(buf: Uint8Array): number | null {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (buf.length < 24 || sig.some((b, i) => buf[i] !== b)) return null;
  return ((buf[20]! << 24) | (buf[21]! << 16) | (buf[22]! << 8) | buf[23]!) >>> 0;
}

export const LOGO_MAX_BYTES = 2 * 1024 * 1024;
export const LOGO_MIN_PNG_HEIGHT = 64;

export type LogoCheck = { ok: true; data: Buffer } | { ok: false; message: string };

/** Validate (and for SVG, sanitise) an uploaded logo. */
export function checkLogo(mime: string, data: Buffer): LogoCheck {
  if (data.length > LOGO_MAX_BYTES) return { ok: false, message: 'Keep the logo under 2 MB' };
  if (mime === 'image/svg+xml') {
    const text = data.toString('utf8');
    if (!isSvg(text)) return { ok: false, message: 'That file isn’t a valid SVG' };
    return { ok: true, data: Buffer.from(sanitizeSvg(text), 'utf8') };
  }
  if (mime === 'image/png') {
    const h = pngHeight(data);
    if (h === null) return { ok: false, message: 'That file isn’t a valid PNG' };
    if (h < LOGO_MIN_PNG_HEIGHT) return { ok: false, message: `Use a PNG at least ${LOGO_MIN_PNG_HEIGHT} px tall (this one is ${h} px)` };
    return { ok: true, data };
  }
  return { ok: false, message: 'Use an SVG or PNG logo' };
}

/** The preset whose colours match, if any (case-insensitive). */
export function presetFor(primary: string, secondary: string): string | null {
  const p = BRAND_PRESETS.find((x) => x.primary.toLowerCase() === primary.toLowerCase() && x.secondary.toLowerCase() === secondary.toLowerCase());
  return p?.key ?? null;
}
