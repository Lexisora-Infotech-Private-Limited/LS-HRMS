import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { CUSTOM_FONTS, type CustomFontKey } from '@lexisora/shared';

/** Where the bundled font files live (`apps/api/assets/fonts`), whether running from source, from `dist` or in the image. */
const DIR = [join(process.cwd(), 'assets', 'fonts'), join(__dirname, '..', '..', '..', 'assets', 'fonts'), join(__dirname, '..', '..', '..', '..', 'assets', 'fonts')].find((d) => existsSync(d));

type Variants = { names: [string, string, string, string]; files: [string, string, string, string] };
const registry = new Map<string, Variants>();

/** regular, bold, italic, bold italic: a style a family does not have uses the nearest one it does. */
function load() {
  if (!DIR) return;
  const file = (prefix: string, weight: 400 | 700, style: 'normal' | 'italic') => {
    const p = join(DIR, `${prefix}-${weight}-${style}.ttf`);
    return existsSync(p) ? p : null;
  };
  for (const [key, f] of Object.entries(CUSTOM_FONTS)) {
    const regular = file(f.file, 400, 'normal');
    if (!regular) continue;
    const bold = file(f.file, 700, 'normal') ?? regular;
    const italic = file(f.file, 400, 'italic') ?? regular;
    const boldItalic = file(f.file, 700, 'italic') ?? bold;
    registry.set(key, { names: [`LX-${key}`, `LX-${key}-Bold`, `LX-${key}-Italic`, `LX-${key}-BoldItalic`], files: [regular, bold, italic, boldItalic] });
  }
}
load();

/** Make every bundled family available to a PDF document (a font is only embedded when it is actually used). */
export function registerPdfFonts(doc: PDFKit.PDFDocument) {
  for (const v of registry.values()) v.names.forEach((n, i) => doc.registerFont(n, v.files[i]!));
}

/** The registered PDF font name for a design font key such as MONTSERRAT (null when the family is not bundled). */
export function customFontName(key: string, bold: boolean, italic: boolean): string | null {
  return registry.get(key.toLowerCase() as CustomFontKey)?.names[(bold ? 1 : 0) + (italic ? 2 : 0)] ?? null;
}
