"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: Object.getOwnPropertyDescriptor(all, name).get
    });
}
_export(exports, {
    get LOGO_MAX_BYTES () {
        return LOGO_MAX_BYTES;
    },
    get LOGO_MIN_PNG_HEIGHT () {
        return LOGO_MIN_PNG_HEIGHT;
    },
    get checkLogo () {
        return checkLogo;
    },
    get isSvg () {
        return isSvg;
    },
    get pngHeight () {
        return pngHeight;
    },
    get presetFor () {
        return presetFor;
    },
    get sanitizeSvg () {
        return sanitizeSvg;
    }
});
const _shared = require("@lexisora/shared");
function sanitizeSvg(svg) {
    return svg.replace(/<!DOCTYPE[^>]*>/gi, '').replace(/<script[\s\S]*?<\/script\s*>/gi, '').replace(/<script[^>]*\/>/gi, '').replace(/<foreignObject[\s\S]*?<\/foreignObject\s*>/gi, '').replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '').replace(/\s(xlink:)?href\s*=\s*("\s*javascript:[^"]*"|'\s*javascript:[^']*'|javascript:[^\s>]+)/gi, '').replace(/\s(xlink:)?href\s*=\s*("https?:[^"]*"|'https?:[^']*')/gi, '');
}
function isSvg(text) {
    return /<svg[\s>]/i.test(text.slice(0, 2000));
}
function pngHeight(buf) {
    const sig = [
        0x89,
        0x50,
        0x4e,
        0x47,
        0x0d,
        0x0a,
        0x1a,
        0x0a
    ];
    if (buf.length < 24 || sig.some((b, i)=>buf[i] !== b)) return null;
    return (buf[20] << 24 | buf[21] << 16 | buf[22] << 8 | buf[23]) >>> 0;
}
const LOGO_MAX_BYTES = 2 * 1024 * 1024;
const LOGO_MIN_PNG_HEIGHT = 64;
function checkLogo(mime, data) {
    if (data.length > LOGO_MAX_BYTES) return {
        ok: false,
        message: 'Keep the logo under 2 MB'
    };
    if (mime === 'image/svg+xml') {
        const text = data.toString('utf8');
        if (!isSvg(text)) return {
            ok: false,
            message: 'That file isn’t a valid SVG'
        };
        return {
            ok: true,
            data: Buffer.from(sanitizeSvg(text), 'utf8')
        };
    }
    if (mime === 'image/png') {
        const h = pngHeight(data);
        if (h === null) return {
            ok: false,
            message: 'That file isn’t a valid PNG'
        };
        if (h < LOGO_MIN_PNG_HEIGHT) return {
            ok: false,
            message: `Use a PNG at least ${LOGO_MIN_PNG_HEIGHT} px tall (this one is ${h} px)`
        };
        return {
            ok: true,
            data
        };
    }
    return {
        ok: false,
        message: 'Use an SVG or PNG logo'
    };
}
function presetFor(primary, secondary) {
    const p = _shared.BRAND_PRESETS.find((x)=>x.primary.toLowerCase() === primary.toLowerCase() && x.secondary.toLowerCase() === secondary.toLowerCase());
    return p?.key ?? null;
}

//# sourceMappingURL=branding.logic.js.map