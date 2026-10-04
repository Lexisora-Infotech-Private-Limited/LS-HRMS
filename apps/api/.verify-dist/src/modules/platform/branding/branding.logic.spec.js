"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
const _vitest = require("vitest");
const _shared = require("@lexisora/shared");
const _brandinglogic = require("./branding.logic");
/** Minimal PNG header (signature + IHDR) with the given height. */ function png(height) {
    const b = Buffer.alloc(33);
    Buffer.from([
        0x89,
        0x50,
        0x4e,
        0x47,
        0x0d,
        0x0a,
        0x1a,
        0x0a
    ]).copy(b, 0);
    b.writeUInt32BE(13, 8);
    b.write('IHDR', 12, 'ascii');
    b.writeUInt32BE(256, 16);
    b.writeUInt32BE(height, 20);
    return b;
}
(0, _vitest.describe)('Palette presets (wireframe PALS)', ()=>{
    (0, _vitest.it)('ships the three presets', ()=>{
        (0, _vitest.expect)(_shared.BRAND_PRESETS.map((p)=>[
                p.name,
                p.primary,
                p.secondary
            ])).toEqual([
            [
                'Lexisora · pink & blue',
                '#d6457a',
                '#2f5fb3'
            ],
            [
                'Acme · red & black',
                '#c62828',
                '#1c1c1c'
            ],
            [
                'Default · gold & ink',
                '#b68235',
                '#2d2b2b'
            ]
        ]);
    });
    (0, _vitest.it)('recognises a preset from its colours, else Custom', ()=>{
        (0, _vitest.expect)((0, _brandinglogic.presetFor)('#C62828', '#1c1c1c')).toBe('acme-red-black');
        (0, _vitest.expect)((0, _brandinglogic.presetFor)('#123456', '#1c1c1c')).toBeNull();
    });
});
(0, _vitest.describe)('Contrast checks', ()=>{
    (0, _vitest.it)('WCAG ratio', ()=>{
        (0, _vitest.expect)((0, _shared.contrastRatio)('#ffffff', '#000000')).toBe(21);
        (0, _vitest.expect)((0, _shared.contrastRatio)('#777777', '#777777')).toBe(1);
    });
    (0, _vitest.it)('sidebar text is white on dark secondaries, ink on light ones', ()=>{
        (0, _vitest.expect)((0, _shared.sidebarForeground)('#1c1c1c')).toBe('#ffffff');
        (0, _vitest.expect)((0, _shared.sidebarForeground)('#f5e6c8')).toBe('#2d2b2b');
    });
    (0, _vitest.it)('warns about a pale primary but not about the presets’ readable pairs', ()=>{
        (0, _vitest.expect)((0, _shared.brandContrastWarnings)('#c62828', '#1c1c1c')).toEqual([]);
        const pale = (0, _shared.brandContrastWarnings)('#f7d774', '#2d2b2b');
        (0, _vitest.expect)(pale[0]).toMatch(/^Primary on background is \d\.\d:1; text links will use a darker shade automatically\.$/);
        (0, _vitest.expect)((0, _shared.brandContrastWarnings)('#zzzzzz', '#000000')).toEqual([]);
    });
});
(0, _vitest.describe)('Login domain', ()=>{
    (0, _vitest.it)('normalises "Acme" to acme.hrms.app', ()=>{
        (0, _vitest.expect)((0, _shared.normalizeLoginDomain)('Acme')).toBe('acme.hrms.app');
        (0, _vitest.expect)((0, _shared.normalizeLoginDomain)('https://Nova.hrms.app/login')).toBe('nova.hrms.app');
        (0, _vitest.expect)(_shared.publishBrandingSchema.parse({
            primaryHex: '#c62828',
            secondaryHex: '#1c1c1c',
            domain: 'acme'
        }).domain).toBe('acme.hrms.app');
        (0, _vitest.expect)(_shared.publishBrandingSchema.safeParse({
            primaryHex: 'red',
            secondaryHex: '#1c1c1c',
            domain: 'acme'
        }).success).toBe(false);
    });
    (0, _vitest.it)('only *.hrms.app addresses have a workspace slug (custom domains are Enterprise)', ()=>{
        (0, _vitest.expect)((0, _shared.slugOfDomain)('acme.hrms.app')).toBe('acme');
        (0, _vitest.expect)((0, _shared.slugOfDomain)('hr.acme.com')).toBeNull();
        (0, _vitest.expect)((0, _shared.slugOfDomain)('a.b.hrms.app')).toBeNull();
    });
});
(0, _vitest.describe)('Logo upload', ()=>{
    (0, _vitest.it)('strips scripts, event handlers and external links from SVGs', ()=>{
        const dirty = '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(2)</script><a href="javascript:alert(3)"><rect onclick="x()" width="10" height="10"/></a><foreignObject><div>x</div></foreignObject><image href="https://evil.example/x.png"/></svg>';
        const clean = (0, _brandinglogic.sanitizeSvg)(dirty);
        (0, _vitest.expect)(clean).not.toMatch(/script|onload|onclick|javascript:|foreignObject|evil\.example/i);
        (0, _vitest.expect)(clean).toContain('<rect');
        (0, _vitest.expect)((0, _brandinglogic.isSvg)(clean)).toBe(true);
    });
    (0, _vitest.it)('accepts SVG and PNG (at least 64 px tall), rejects others', ()=>{
        (0, _vitest.expect)((0, _brandinglogic.pngHeight)(png(128))).toBe(128);
        (0, _vitest.expect)((0, _brandinglogic.pngHeight)(Buffer.from('not a png at all, really not'))).toBeNull();
        (0, _vitest.expect)((0, _brandinglogic.checkLogo)('image/png', png(128)).ok).toBe(true);
        (0, _vitest.expect)((0, _brandinglogic.checkLogo)('image/png', png(32))).toMatchObject({
            ok: false,
            message: 'Use a PNG at least 64 px tall (this one is 32 px)'
        });
        (0, _vitest.expect)((0, _brandinglogic.checkLogo)('image/svg+xml', Buffer.from('<svg><rect/></svg>')).ok).toBe(true);
        (0, _vitest.expect)((0, _brandinglogic.checkLogo)('image/svg+xml', Buffer.from('hello'))).toMatchObject({
            ok: false
        });
        (0, _vitest.expect)((0, _brandinglogic.checkLogo)('image/jpeg', png(128))).toMatchObject({
            ok: false,
            message: 'Use an SVG or PNG logo'
        });
        (0, _vitest.expect)((0, _brandinglogic.checkLogo)('image/png', Buffer.alloc(3 * 1024 * 1024))).toMatchObject({
            ok: false,
            message: 'Keep the logo under 2 MB'
        });
    });
});

//# sourceMappingURL=branding.logic.spec.js.map