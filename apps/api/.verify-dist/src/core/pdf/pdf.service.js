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
    get PDF_COLORS () {
        return PDF_COLORS;
    },
    get PdfService () {
        return PdfService;
    }
});
const _common = require("@nestjs/common");
const _pdfkit = /*#__PURE__*/ _interop_require_default(require("pdfkit"));
function _interop_require_default(obj) {
    return obj && obj.__esModule ? obj : {
        default: obj
    };
}
function _ts_decorate(decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") {
        r = Reflect.decorate(decorators, target, key, desc);
    } else {
        for(var i = decorators.length - 1; i >= 0; i--){
            if (d = decorators[i]) {
                r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
            }
        }
    }
    return c > 3 && r && Object.defineProperty(target, key, r), r;
}
const PDF_COLORS = {
    ink: '#201f1d',
    muted: '#605d5d',
    accent: '#b68235',
    rule: '#d7d3d3'
};
let PdfService = class PdfService {
    render(build, opts = {
        size: 'A4',
        margin: 48
    }) {
        return new Promise((resolve, reject)=>{
            const doc = new _pdfkit.default({
                bufferPages: true,
                ...opts
            });
            const chunks = [];
            doc.on('data', (c)=>chunks.push(c));
            doc.on('end', ()=>resolve(Buffer.concat(chunks)));
            doc.on('error', reject);
            try {
                build(doc);
                doc.end();
            } catch (e) {
                reject(e);
            }
        });
    }
    /** Standard letterhead: company name, kicker line, accent rule. */ header(doc, company, kicker, accent = PDF_COLORS.accent) {
        doc.font('Times-Bold').fontSize(22).fillColor(PDF_COLORS.ink).text(company);
        doc.font('Helvetica').fontSize(8).fillColor(accent).text(kicker.toUpperCase(), {
            characterSpacing: 1.2
        });
        const y = doc.y + 6;
        doc.moveTo(doc.page.margins.left, y).lineTo(doc.page.width - doc.page.margins.right, y).lineWidth(1).strokeColor(accent).stroke();
        doc.moveDown(1.2);
        doc.fillColor(PDF_COLORS.ink);
    }
    /** Simple two-column key/value table. */ keyValues(doc, rows, colWidth = 180) {
        const x = doc.page.margins.left;
        for (const [k, v] of rows){
            const y = doc.y;
            doc.font('Helvetica').fontSize(9).fillColor(PDF_COLORS.muted).text(k, x, y, {
                width: colWidth
            });
            doc.font('Helvetica').fontSize(10).fillColor(PDF_COLORS.ink).text(v, x + colWidth, y);
            doc.moveDown(0.35);
        }
    }
    /** Grid table with header row. `widths` are fractions of the content width. */ table(doc, head, rows, widths, alignRight = []) {
        const left = doc.page.margins.left;
        const full = doc.page.width - doc.page.margins.left - doc.page.margins.right;
        const w = (widths ?? head.map(()=>1 / head.length)).map((f)=>f * full);
        const line = (cells, bold)=>{
            const y = doc.y;
            let x = left;
            let h = 0;
            cells.forEach((c, i)=>{
                doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 8 : 9.5).fillColor(bold ? PDF_COLORS.muted : PDF_COLORS.ink);
                doc.text(c, x + 3, y + 4, {
                    width: w[i] - 6,
                    align: alignRight.includes(i) ? 'right' : 'left'
                });
                h = Math.max(h, doc.y - y);
                x += w[i];
            });
            doc.y = y + h + 4;
            doc.moveTo(left, doc.y).lineTo(left + full, doc.y).lineWidth(0.5).strokeColor(PDF_COLORS.rule).stroke();
        };
        line(head.map((h)=>h.toUpperCase()), true);
        rows.forEach((r)=>line(r, false));
        doc.moveDown(0.8);
        doc.x = left;
    }
};
PdfService = _ts_decorate([
    (0, _common.Injectable)()
], PdfService);

//# sourceMappingURL=pdf.service.js.map