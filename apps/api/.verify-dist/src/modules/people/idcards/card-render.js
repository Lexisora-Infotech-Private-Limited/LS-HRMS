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
    get PT_PER_MM () {
        return PT_PER_MM;
    },
    get PX_PER_MM_300DPI () {
        return PX_PER_MM_300DPI;
    },
    get classicPortrait () {
        return classicPortrait;
    },
    get elementText () {
        return elementText;
    },
    get estimateTextWidthMm () {
        return estimateTextWidthMm;
    },
    get fitFontSize () {
        return fitFontSize;
    },
    get landscapeMinimal () {
        return landscapeMinimal;
    },
    get qrDataUrl () {
        return qrDataUrl;
    },
    get renderCardSvg () {
        return renderCardSvg;
    },
    get svgToPng () {
        return svgToPng;
    },
    get toDataUrl () {
        return toDataUrl;
    }
});
const _sharp = /*#__PURE__*/ _interop_require_default(require("sharp"));
const _qrcode = /*#__PURE__*/ _interop_require_default(require("qrcode"));
function _interop_require_default(obj) {
    return obj && obj.__esModule ? obj : {
        default: obj
    };
}
const PX_PER_MM_300DPI = 300 / 25.4;
const PT_PER_MM = 72 / 25.4;
const esc = (s)=>s.replace(/[&<>"']/g, (c)=>({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&apos;'
        })[c]);
const FAMILY = {
    serif: "Georgia, 'Times New Roman', serif",
    sans: "'Segoe UI', Arial, Helvetica, sans-serif"
};
function estimateTextWidthMm(text, sizePt) {
    return text.length * sizePt * 0.52 * (25.4 / 72);
}
function fitFontSize(text, sizePt, widthMm) {
    const w = estimateTextWidthMm(text, sizePt);
    if (w <= widthMm || !text) return sizePt;
    return Math.max(5, Math.floor(sizePt * widthMm / w * 10) / 10);
}
function elementText(el, data) {
    if (el.type === 'STATIC') return el.text ?? '';
    if (el.type === 'SIGNATURE') return el.text || 'Authorised signatory';
    if (el.binding) {
        const v = data[el.binding];
        return v ? `${el.text ?? ''}${v}` : '';
    }
    return el.text ?? '';
}
function renderCardSvg(side, data, images, pxPerMm = PX_PER_MM_300DPI) {
    const W = Math.round(side.widthMm * pxPerMm);
    const H = Math.round(side.heightMm * pxPerMm);
    const m = (v)=>(v * pxPerMm).toFixed(2);
    const parts = [
        `<rect x="0" y="0" width="${W}" height="${H}" fill="#ffffff"/>`
    ];
    if (images.bg) parts.push(`<image href="${images.bg}" x="0" y="0" width="${W}" height="${H}" preserveAspectRatio="xMidYMid slice"/>`);
    const els = [
        ...side.elements
    ].sort((a, b)=>(a.z ?? 0) - (b.z ?? 0));
    for (const el of els){
        const x = el.xMm;
        const y = el.yMm;
        const w = el.wMm;
        const h = el.hMm;
        switch(el.type){
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
            case 'SIGNATURE':
                {
                    const font = {
                        size: 10,
                        weight: 'normal',
                        color: '#201f1d',
                        align: 'center',
                        family: 'sans',
                        ...el.font ?? {}
                    };
                    const raw = el.type === 'LOGO' ? data['tenant.name'] ?? '' : elementText(el, data);
                    if (el.type === 'SIGNATURE') {
                        parts.push(`<line x1="${m(x)}" y1="${m(y)}" x2="${m(x + w)}" y2="${m(y)}" stroke="#d7d3d3" stroke-width="2"/>`);
                    }
                    if (!raw) break;
                    const lines = raw.split('\n');
                    const sizePt = lines.length === 1 ? fitFontSize(raw, font.size, w) : Math.min(...lines.map((l)=>fitFontSize(l, font.size, w)));
                    const sizeMm = sizePt * (25.4 / 72);
                    const anchor = font.align === 'left' ? 'start' : font.align === 'right' ? 'end' : 'middle';
                    const tx = font.align === 'left' ? x : font.align === 'right' ? x + w : x + w / 2;
                    const lineH = sizeMm * 1.25;
                    const top = el.type === 'SIGNATURE' ? y + 1 : y + h / 2 - lineH * (lines.length - 1) / 2;
                    lines.forEach((ln, i)=>{
                        const ty = top + i * lineH;
                        parts.push(`<text x="${m(tx)}" y="${m(ty)}" font-family="${font.family === 'serif' ? FAMILY.serif : FAMILY.sans}" font-size="${m(sizeMm)}" font-weight="${font.weight}" fill="${font.color}" text-anchor="${anchor}" dominant-baseline="${el.type === 'SIGNATURE' ? 'hanging' : 'middle'}">${esc(ln)}</text>`);
                    });
                    break;
                }
        }
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${parts.join('')}</svg>`;
}
async function svgToPng(svg) {
    return (0, _sharp.default)(Buffer.from(svg), {
        density: 72
    }).png().toBuffer();
}
async function qrDataUrl(text) {
    return _qrcode.default.toDataURL(text, {
        margin: 0,
        width: 360,
        errorCorrectionLevel: 'M',
        color: {
            dark: '#201f1dff',
            light: '#ffffffff'
        }
    });
}
async function toDataUrl(buf, maxPx = 700) {
    try {
        const out = await (0, _sharp.default)(buf).rotate().resize(maxPx, maxPx, {
            fit: 'inside',
            withoutEnlargement: true
        }).png().toBuffer();
        return `data:image/png;base64,${out.toString('base64')}`;
    } catch  {
        return null;
    }
}
const t = (id, binding, x, y, w, h, size, extra = {}, font = {})=>({
        id,
        type: 'TEXT',
        binding,
        xMm: x,
        yMm: y,
        wMm: w,
        hMm: h,
        z: 1,
        font: {
            size,
            weight: 'normal',
            color: '#201f1d',
            align: 'center',
            family: 'sans',
            ...font
        },
        ...extra
    });
function classicPortrait() {
    return {
        front: [
            t('company', 'tenant.name', 2, 2.5, 49.98, 7, 13, {
                label: 'Company name'
            }, {
                family: 'serif'
            }),
            {
                id: 'rule',
                type: 'SHAPE',
                label: 'Accent rule',
                xMm: 0,
                yMm: 10.6,
                wMm: 53.98,
                hMm: 0.6,
                fill: '#b68235',
                z: 0
            },
            {
                id: 'photo',
                type: 'PHOTO',
                label: 'Photo',
                binding: 'employee.photo',
                xMm: 16,
                yMm: 16.5,
                wMm: 22,
                hMm: 25.6,
                z: 1
            },
            t('name', 'employee.full_name', 2, 44.5, 49.98, 8, 22, {
                label: 'Full name'
            }, {
                family: 'serif'
            }),
            t('designation', 'employee.designation', 2, 52, 49.98, 5, 9, {
                label: 'Designation'
            }, {
                color: '#605d5d'
            }),
            t('code', 'employee.code_blood', 2, 58.5, 49.98, 5, 9, {
                label: 'Employee ID · Blood group'
            }),
            {
                id: 'bar',
                type: 'SHAPE',
                label: 'Footer bar',
                xMm: 0,
                yMm: 83.3,
                wMm: 53.98,
                hMm: 2.3,
                fill: '#e3c79a',
                z: 0
            }
        ],
        back: [
            {
                id: 'qr',
                type: 'QR',
                label: 'QR code',
                binding: 'qr.verify_url',
                xMm: 16.5,
                yMm: 6,
                wMm: 21,
                hMm: 21,
                z: 1
            },
            t('found', null, 3, 31, 47.98, 4, 7.5, {
                type: 'STATIC',
                text: 'If found, please return to',
                label: 'Return note'
            }),
            t('return', 'settings.return_address', 3, 37, 47.98, 8, 7.5, {
                label: 'Return address'
            }),
            t('emergency', 'settings.emergency_line', 3, 47, 47.98, 4, 7.5, {
                text: 'Emergency: ',
                label: 'Emergency contact'
            }),
            t('sign', null, 5, 76, 43.98, 5, 7.5, {
                type: 'SIGNATURE',
                text: 'Authorised signatory',
                label: 'Signature'
            })
        ]
    };
}
function landscapeMinimal() {
    return {
        front: [
            t('company', 'tenant.name', 4, 3, 77.6, 6, 11, {
                label: 'Company name'
            }, {
                family: 'serif',
                align: 'left'
            }),
            {
                id: 'rule',
                type: 'SHAPE',
                label: 'Accent rule',
                xMm: 4,
                yMm: 10,
                wMm: 77.6,
                hMm: 0.4,
                fill: '#b68235',
                z: 0
            },
            {
                id: 'photo',
                type: 'PHOTO',
                label: 'Photo',
                binding: 'employee.photo',
                xMm: 4,
                yMm: 14,
                wMm: 24,
                hMm: 28,
                z: 1
            },
            t('name', 'employee.full_name', 32, 16, 50, 8, 16, {
                label: 'Full name'
            }, {
                family: 'serif',
                align: 'left'
            }),
            t('designation', 'employee.designation', 32, 25, 50, 5, 9, {
                label: 'Designation'
            }, {
                align: 'left',
                color: '#605d5d'
            }),
            t('department', 'employee.department', 32, 30.5, 50, 5, 8, {
                label: 'Department'
            }, {
                align: 'left',
                color: '#605d5d'
            }),
            t('code', 'employee.code_blood', 32, 37, 50, 5, 9, {
                label: 'Employee ID · Blood group'
            }, {
                align: 'left'
            })
        ],
        back: [
            {
                id: 'qr',
                type: 'QR',
                label: 'QR code',
                binding: 'qr.verify_url',
                xMm: 4,
                yMm: 12,
                wMm: 26,
                hMm: 26,
                z: 1
            },
            t('found', null, 34, 12, 48, 4, 7.5, {
                type: 'STATIC',
                text: 'If found, please return to',
                label: 'Return note'
            }, {
                align: 'left'
            }),
            t('return', 'settings.return_address', 34, 17, 48, 8, 7.5, {
                label: 'Return address'
            }, {
                align: 'left'
            }),
            t('emergency', 'settings.emergency_line', 34, 27, 48, 4, 7.5, {
                text: 'Emergency: ',
                label: 'Emergency contact'
            }, {
                align: 'left'
            }),
            t('sign', null, 34, 42, 44, 5, 7, {
                type: 'SIGNATURE',
                text: 'Authorised signatory',
                label: 'Signature'
            }, {
                align: 'left'
            })
        ]
    };
}

//# sourceMappingURL=card-render.js.map