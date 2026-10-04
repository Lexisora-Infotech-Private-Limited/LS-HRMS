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
    get FILE_SRC () {
        return FILE_SRC;
    },
    get excerptOf () {
        return excerptOf;
    },
    get htmlToText () {
        return htmlToText;
    },
    get imageFileIds () {
        return imageFileIds;
    },
    get sanitizeHtml () {
        return sanitizeHtml;
    }
});
/**
 * Server-side rich-text sanitizer for the feed composer and notice bodies.
 * Allowlist: p, br, strong, em, h2, ul, ol, li, a[href], img[src|alt|width|height].
 * b/i/div/h1/h3 are normalised; everything else (scripts, styles, event handlers,
 * javascript: URLs, external images) is removed.
 */ const ALLOWED = new Set([
    'p',
    'br',
    'strong',
    'em',
    'h2',
    'ul',
    'ol',
    'li',
    'a',
    'img'
]);
const RENAME = {
    b: 'strong',
    i: 'em',
    div: 'p',
    h1: 'h2',
    h3: 'h2',
    h4: 'h2'
};
const VOID = new Set([
    'br',
    'img'
]);
const DROP_WITH_CONTENT = /<(script|style|iframe|object|embed|noscript|template|svg|math)\b[\s\S]*?<\/\1\s*>/gi;
const FILE_SRC = /^\/api\/v1\/files\/([A-Za-z0-9_-]+)(\/public)?$/;
function escText(s) {
    return s.replace(/&(?!#?[a-zA-Z0-9]+;)/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function escAttr(s) {
    return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function attrs(raw) {
    const out = {};
    const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*(?:=\s*("([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
    let m;
    while(m = re.exec(raw))out[m[1].toLowerCase()] = (m[3] ?? m[4] ?? m[5] ?? '').trim();
    return out;
}
function decodeEntities(s) {
    return s.replace(/&#x([0-9a-f]+);?/gi, (_, h)=>String.fromCharCode(parseInt(h, 16))).replace(/&#(\d+);?/g, (_, d)=>String.fromCharCode(+d)).replace(/&colon;/gi, ':');
}
function sanitizeHtml(input) {
    const src = (input ?? '').replace(/<!--[\s\S]*?-->/g, '').replace(DROP_WITH_CONTENT, '');
    const out = [];
    const stack = [];
    const tagRe = /<\s*(\/?)\s*([a-zA-Z][a-zA-Z0-9]*)([^>]*)>/g;
    let last = 0;
    let m;
    while(m = tagRe.exec(src)){
        out.push(escText(src.slice(last, m.index).replace(/</g, '')));
        last = tagRe.lastIndex;
        const closing = m[1] === '/';
        let tag = m[2].toLowerCase();
        tag = RENAME[tag] ?? tag;
        if (!ALLOWED.has(tag)) continue;
        if (closing) {
            const idx = stack.lastIndexOf(tag);
            if (idx === -1) continue;
            while(stack.length > idx)out.push(`</${stack.pop()}>`);
            continue;
        }
        const a = attrs(m[3] ?? '');
        if (tag === 'a') {
            const href = decodeEntities(a.href ?? '').replace(/[\u0000-\u001f\s]+/g, '');
            if (!/^(https?:|mailto:)/i.test(href)) {
                stack.push('a');
                out.push('<a>');
                continue;
            }
            stack.push('a');
            out.push(`<a href="${escAttr(href)}" rel="noopener nofollow" target="_blank">`);
            continue;
        }
        if (tag === 'img') {
            const s = (a.src ?? '').replace(/\?.*$/, '');
            if (!FILE_SRC.test(s)) continue;
            const w = /^\d{1,4}$/.test(a.width ?? '') ? ` width="${a.width}"` : '';
            const h = /^\d{1,4}$/.test(a.height ?? '') ? ` height="${a.height}"` : '';
            out.push(`<img src="${escAttr(s)}" alt="${escAttr((a.alt ?? '').slice(0, 200))}"${w}${h}>`);
            continue;
        }
        if (VOID.has(tag)) {
            out.push(`<${tag}>`);
            continue;
        }
        stack.push(tag);
        out.push(`<${tag}>`);
    }
    out.push(escText(src.slice(last).replace(/</g, '')));
    while(stack.length)out.push(`</${stack.pop()}>`);
    return out.join('').replace(/<p>\s*<\/p>/g, '').trim();
}
function htmlToText(html) {
    return decodeEntities((html ?? '').replace(/<(br|\/p|\/li|\/h2)\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')).replace(/\s+/g, ' ').trim();
}
function excerptOf(html, max = 300) {
    const t = htmlToText(html);
    return t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`;
}
function imageFileIds(html) {
    return [
        ...(html ?? '').matchAll(/\/api\/v1\/files\/([A-Za-z0-9_-]+)/g)
    ].map((m)=>m[1]);
}

//# sourceMappingURL=html.js.map