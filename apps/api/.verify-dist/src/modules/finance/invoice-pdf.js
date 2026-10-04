"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "renderInvoicePdf", {
    enumerable: true,
    get: function() {
        return renderInvoicePdf;
    }
});
const _shared = require("@lexisora/shared");
const _qrcode = /*#__PURE__*/ _interop_require_default(require("qrcode"));
const _pdfservice = require("../../core/pdf/pdf.service");
const _money = require("./lib/money");
function _interop_require_default(obj) {
    return obj && obj.__esModule ? obj : {
        default: obj
    };
}
const fmtDate = (d)=>d ? new Date(`${(0, _money.dateKeyOf)(d)}T00:00:00Z`).toLocaleDateString('en-GB', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        timeZone: 'UTC'
    }) : '—';
const pdfText = (s)=>s.replace(/₹\s?/g, 'Rs. ').replace(/[–—]/g, '-').replace(/[^\x20-\x7e\n]/g, '');
async function renderInvoicePdf(pdf, d) {
    const upi = `upi://pay?pa=${encodeURIComponent(d.bank.upiId)}&pn=${encodeURIComponent(d.seller.legalName)}&am=${(d.totalPaise / 100).toFixed(2)}&cu=INR&tn=${encodeURIComponent(d.number ?? 'Invoice')}`;
    const qr = await _qrcode.default.toBuffer(upi, {
        type: 'png',
        margin: 1,
        width: 180
    });
    return pdf.render((doc)=>{
        const left = doc.page.margins.left;
        const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
        pdf.header(doc, pdfText(d.seller.legalName), d.kind ?? 'Tax invoice');
        const topY = doc.y;
        doc.font('Helvetica').fontSize(9).fillColor(_pdfservice.PDF_COLORS.muted);
        doc.text(pdfText(d.seller.address), left, topY, {
            width: width * 0.55
        });
        doc.text(`GSTIN: ${d.seller.gstin ?? '—'}   PAN: ${d.seller.pan ?? '—'}`, {
            width: width * 0.55
        });
        doc.text(`State: ${(0, _shared.finPlaceOfSupply)(d.seller.stateCode)}`, {
            width: width * 0.55
        });
        if (d.seller.phone || d.seller.email) doc.text([
            d.seller.phone,
            d.seller.email
        ].filter(Boolean).join(' · '), {
            width: width * 0.55
        });
        const sellerBottom = doc.y;
        const rx = left + width * 0.6;
        doc.fillColor(_pdfservice.PDF_COLORS.ink).font('Helvetica-Bold').fontSize(11).text(d.number ?? 'DRAFT', rx, topY, {
            width: width * 0.4,
            align: 'right'
        });
        doc.font('Helvetica').fontSize(9).fillColor(_pdfservice.PDF_COLORS.muted);
        const meta = [
            [
                d.kind === 'CREDIT NOTE' ? 'Credit note date' : 'Invoice date',
                fmtDate(d.invoiceDate)
            ],
            ...d.kind === 'CREDIT NOTE' ? [
                [
                    'Against invoice',
                    d.reference ?? '—'
                ]
            ] : [
                [
                    'Due date',
                    fmtDate(d.dueDate)
                ]
            ],
            [
                'Billing period',
                (0, _shared.finMonthLabel)(d.period)
            ],
            [
                'Place of supply',
                (0, _shared.finPlaceOfSupply)(d.placeOfSupplyState)
            ],
            [
                'Reverse charge',
                'No'
            ]
        ];
        for (const [k, v] of meta)doc.text(`${k}: ${v}`, rx, doc.y, {
            width: width * 0.4,
            align: 'right'
        });
        doc.y = Math.max(sellerBottom, doc.y) + 14;
        // Buyer block
        doc.x = left;
        doc.font('Helvetica').fontSize(8).fillColor(_pdfservice.PDF_COLORS.accent).text('BILL TO', left, doc.y, {
            characterSpacing: 1.2
        });
        doc.font('Helvetica-Bold').fontSize(11).fillColor(_pdfservice.PDF_COLORS.ink).text(pdfText(d.buyer.name));
        doc.font('Helvetica').fontSize(9).fillColor(_pdfservice.PDF_COLORS.muted);
        if (d.buyer.address) doc.text(pdfText(d.buyer.address), {
            width: width * 0.6
        });
        doc.text(`GSTIN: ${d.buyer.gstin ?? 'Unregistered'}   State: ${(0, _shared.finPlaceOfSupply)(d.buyer.stateCode)}`);
        doc.moveDown(1);
        const intra = d.supplyType === 'INTRA';
        const half = `${d.gstRateBp / 200}%`;
        const full = `${d.gstRateBp / 100}%`;
        const head = intra ? [
            'SAC',
            'Description',
            'Hours',
            'Rate',
            'Taxable',
            `CGST ${half}`,
            `SGST ${half}`,
            'Total'
        ] : [
            'SAC',
            'Description',
            'Hours',
            'Rate',
            'Taxable',
            `IGST ${full}`,
            'Total'
        ];
        const rows = d.lines.map((l)=>intra ? [
                l.sac,
                pdfText(l.description),
                (0, _shared.finHoursLabel)(l.minutes),
                (0, _money.pdfINR)(l.ratePaise, false),
                (0, _money.pdfINR)(l.taxablePaise),
                (0, _money.pdfINR)(l.cgstPaise),
                (0, _money.pdfINR)(l.sgstPaise),
                (0, _money.pdfINR)(l.lineTotalPaise)
            ] : [
                l.sac,
                pdfText(l.description),
                (0, _shared.finHoursLabel)(l.minutes),
                (0, _money.pdfINR)(l.ratePaise, false),
                (0, _money.pdfINR)(l.taxablePaise),
                (0, _money.pdfINR)(l.igstPaise),
                (0, _money.pdfINR)(l.lineTotalPaise)
            ]);
        pdf.table(doc, head, rows, intra ? [
            0.08,
            0.3,
            0.07,
            0.09,
            0.12,
            0.11,
            0.11,
            0.12
        ] : [
            0.08,
            0.36,
            0.08,
            0.1,
            0.14,
            0.12,
            0.12
        ], intra ? [
            2,
            3,
            4,
            5,
            6,
            7
        ] : [
            2,
            3,
            4,
            5,
            6
        ]);
        // Totals
        const tx = left + width * 0.55;
        const tw = width * 0.45;
        const totals = [
            [
                'Taxable value',
                (0, _money.pdfINR)(d.subtotalPaise)
            ],
            ...intra ? [
                [
                    `CGST @ ${half}`,
                    (0, _money.pdfINR)(d.cgstPaise)
                ],
                [
                    `SGST @ ${half}`,
                    (0, _money.pdfINR)(d.sgstPaise)
                ]
            ] : [
                [
                    `IGST @ ${full}`,
                    (0, _money.pdfINR)(d.igstPaise)
                ]
            ],
            [
                'Round off',
                (0, _money.pdfINR)(d.roundOffPaise)
            ]
        ];
        for (const [k, v] of totals){
            const y = doc.y;
            doc.font('Helvetica').fontSize(9.5).fillColor(_pdfservice.PDF_COLORS.muted).text(k, tx, y, {
                width: tw * 0.55
            });
            doc.fillColor(_pdfservice.PDF_COLORS.ink).text(v, tx + tw * 0.55, y, {
                width: tw * 0.45,
                align: 'right'
            });
            doc.moveDown(0.3);
        }
        const y = doc.y + 2;
        doc.moveTo(tx, y).lineTo(tx + tw, y).lineWidth(1).strokeColor(_pdfservice.PDF_COLORS.accent).stroke();
        doc.y = y + 5;
        const ty = doc.y;
        doc.font('Helvetica-Bold').fontSize(11).fillColor(_pdfservice.PDF_COLORS.ink).text(d.kind === 'CREDIT NOTE' ? 'Credit total' : 'Total', tx, ty, {
            width: tw * 0.55
        });
        doc.text((0, _money.pdfINR)(d.totalPaise), tx + tw * 0.55, ty, {
            width: tw * 0.45,
            align: 'right'
        });
        doc.moveDown(0.8);
        doc.x = left;
        doc.font('Helvetica-Oblique').fontSize(9.5).fillColor(_pdfservice.PDF_COLORS.ink).text(`Amount in words: ${(0, _money.amountInWords)(d.totalPaise)}`, left, doc.y, {
            width
        });
        doc.font('Helvetica').fontSize(8.5).fillColor(_pdfservice.PDF_COLORS.muted).text(`Tax: ${(0, _shared.finGstLabel)(d.supplyType, d.gstRateBp)} · SAC 998314 (IT design & development services)`, {
            width
        });
        if (d.notes) doc.moveDown(0.4).text(pdfText(`Notes: ${d.notes}`), {
            width
        });
        doc.moveDown(1.2);
        // Bank details + QR
        const by = doc.y;
        doc.font('Helvetica').fontSize(8).fillColor(_pdfservice.PDF_COLORS.accent).text('BANK DETAILS', left, by, {
            characterSpacing: 1.2
        });
        doc.font('Helvetica').fontSize(9).fillColor(_pdfservice.PDF_COLORS.ink);
        for (const line of [
            `${d.bank.bankName} · ${d.bank.branch}`,
            `A/c name: ${d.bank.accountName}`,
            `A/c no.: ${d.bank.accountNo}   IFSC: ${d.bank.ifsc}`,
            `UPI: ${d.bank.upiId}`
        ])doc.text(pdfText(line));
        doc.image(qr, left + width - 96, by, {
            width: 90
        });
        doc.font('Helvetica').fontSize(7).fillColor(_pdfservice.PDF_COLORS.muted).text('Scan to pay (UPI)', left + width - 96, by + 92, {
            width: 90,
            align: 'center'
        });
        doc.y = Math.max(doc.y, by + 110);
        doc.x = left;
        doc.font('Helvetica').fontSize(9).fillColor(_pdfservice.PDF_COLORS.ink).text(`For ${pdfText(d.seller.legalName)}`, left, doc.y + 10, {
            width,
            align: 'right'
        });
        doc.moveDown(2.2);
        doc.text(pdfText(d.signatory), {
            width,
            align: 'right'
        });
        doc.font('Helvetica').fontSize(7.5).fillColor(_pdfservice.PDF_COLORS.muted).text('Authorised signatory · This is a computer-generated invoice.', {
            width,
            align: 'right'
        });
        if (d.status === 'DRAFT') {
            doc.save().rotate(-30, {
                origin: [
                    doc.page.width / 2,
                    doc.page.height / 2
                ]
            }).font('Helvetica-Bold').fontSize(90).fillColor('#b68235').opacity(0.08).text('DRAFT', 80, doc.page.height / 2 - 60).restore();
        }
    });
}

//# sourceMappingURL=invoice-pdf.js.map