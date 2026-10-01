import { describe, expect, it } from 'vitest';
import { BRAND_PRESETS, brandContrastWarnings, contrastRatio, normalizeLoginDomain, publishBrandingSchema, sidebarForeground, slugOfDomain } from '@lexisora/shared';
import { checkLogo, isSvg, pngHeight, presetFor, sanitizeSvg } from './branding.logic';

/** Minimal PNG header (signature + IHDR) with the given height. */
function png(height: number): Buffer {
  const b = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8);
  b.write('IHDR', 12, 'ascii');
  b.writeUInt32BE(256, 16);
  b.writeUInt32BE(height, 20);
  return b;
}

describe('Palette presets (wireframe PALS)', () => {
  it('ships the three presets', () => {
    expect(BRAND_PRESETS.map((p) => [p.name, p.primary, p.secondary])).toEqual([
      ['Lexisora · pink & blue', '#d6457a', '#2f5fb3'],
      ['Acme · red & black', '#c62828', '#1c1c1c'],
      ['Default · gold & ink', '#b68235', '#2d2b2b'],
    ]);
  });
  it('recognises a preset from its colours, else Custom', () => {
    expect(presetFor('#C62828', '#1c1c1c')).toBe('acme-red-black');
    expect(presetFor('#123456', '#1c1c1c')).toBeNull();
  });
});

describe('Contrast checks', () => {
  it('WCAG ratio', () => {
    expect(contrastRatio('#ffffff', '#000000')).toBe(21);
    expect(contrastRatio('#777777', '#777777')).toBe(1);
  });
  it('sidebar text is white on dark secondaries, ink on light ones', () => {
    expect(sidebarForeground('#1c1c1c')).toBe('#ffffff');
    expect(sidebarForeground('#f5e6c8')).toBe('#2d2b2b');
  });
  it('warns about a pale primary but not about the presets’ readable pairs', () => {
    expect(brandContrastWarnings('#c62828', '#1c1c1c')).toEqual([]);
    const pale = brandContrastWarnings('#f7d774', '#2d2b2b');
    expect(pale[0]).toMatch(/^Primary on background is \d\.\d:1; text links will use a darker shade automatically\.$/);
    expect(brandContrastWarnings('#zzzzzz', '#000000')).toEqual([]);
  });
});

describe('Login domain', () => {
  it('normalises "Acme" to acme.hrms.app', () => {
    expect(normalizeLoginDomain('Acme')).toBe('acme.hrms.app');
    expect(normalizeLoginDomain('https://Nova.hrms.app/login')).toBe('nova.hrms.app');
    expect(publishBrandingSchema.parse({ primaryHex: '#c62828', secondaryHex: '#1c1c1c', domain: 'acme' }).domain).toBe('acme.hrms.app');
    expect(publishBrandingSchema.safeParse({ primaryHex: 'red', secondaryHex: '#1c1c1c', domain: 'acme' }).success).toBe(false);
  });
  it('only *.hrms.app addresses have a workspace slug (custom domains are Enterprise)', () => {
    expect(slugOfDomain('acme.hrms.app')).toBe('acme');
    expect(slugOfDomain('hr.acme.com')).toBeNull();
    expect(slugOfDomain('a.b.hrms.app')).toBeNull();
  });
});

describe('Logo upload', () => {
  it('strips scripts, event handlers and external links from SVGs', () => {
    const dirty = '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(2)</script><a href="javascript:alert(3)"><rect onclick="x()" width="10" height="10"/></a><foreignObject><div>x</div></foreignObject><image href="https://evil.example/x.png"/></svg>';
    const clean = sanitizeSvg(dirty);
    expect(clean).not.toMatch(/script|onload|onclick|javascript:|foreignObject|evil\.example/i);
    expect(clean).toContain('<rect');
    expect(isSvg(clean)).toBe(true);
  });
  it('accepts SVG and PNG (at least 64 px tall), rejects others', () => {
    expect(pngHeight(png(128))).toBe(128);
    expect(pngHeight(Buffer.from('not a png at all, really not'))).toBeNull();
    expect(checkLogo('image/png', png(128)).ok).toBe(true);
    expect(checkLogo('image/png', png(32))).toMatchObject({ ok: false, message: 'Use a PNG at least 64 px tall (this one is 32 px)' });
    expect(checkLogo('image/svg+xml', Buffer.from('<svg><rect/></svg>')).ok).toBe(true);
    expect(checkLogo('image/svg+xml', Buffer.from('hello'))).toMatchObject({ ok: false });
    expect(checkLogo('image/jpeg', png(128))).toMatchObject({ ok: false, message: 'Use an SVG or PNG logo' });
    expect(checkLogo('image/png', Buffer.alloc(3 * 1024 * 1024))).toMatchObject({ ok: false, message: 'Keep the logo under 2 MB' });
  });
});
