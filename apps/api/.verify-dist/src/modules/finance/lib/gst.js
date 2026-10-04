/**
 * GST business rules (pure; unit-tested). Invoice tax math lives in @lexisora/shared so the
 * web form preview uses exactly the same numbers.
 */ "use strict";
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
    get PurchaseGstError () {
        return PurchaseGstError;
    },
    get computeInvoiceTax () {
        return _shared.finComputeInvoiceTax;
    },
    get deriveSupplyType () {
        return _shared.finDeriveSupplyType;
    },
    get estimateInputGst () {
        return _shared.finEstimateInputGst;
    },
    get gstinCheckChar () {
        return gstinCheckChar;
    },
    get isValidGstin () {
        return isValidGstin;
    },
    get payrollPostingLines () {
        return payrollPostingLines;
    },
    get resolvePurchaseGst () {
        return resolvePurchaseGst;
    },
    get splitInputGst () {
        return _shared.finSplitInputGst;
    },
    get stateFromGstin () {
        return stateFromGstin;
    },
    get utiliseItc () {
        return utiliseItc;
    }
});
const _shared = require("@lexisora/shared");
function stateFromGstin(gstin) {
    return gstin && /^\d{2}/.test(gstin) ? gstin.slice(0, 2) : null;
}
const GSTIN_RE = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const GST_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
function gstinCheckChar(first14) {
    let sum = 0;
    for(let i = 0; i < 14; i++){
        const v = GST_CHARS.indexOf(first14[i].toUpperCase());
        const p = v * (i % 2 === 0 ? 1 : 2);
        sum += Math.floor(p / 36) + p % 36;
    }
    return GST_CHARS[(36 - sum % 36) % 36];
}
function isValidGstin(gstin) {
    if (!gstin) return false;
    const g = gstin.trim().toUpperCase();
    return GSTIN_RE.test(g) && gstinCheckChar(g.slice(0, 14)) === g[14];
}
let PurchaseGstError = class PurchaseGstError extends Error {
};
function resolvePurchaseGst(i) {
    const explicit = i.inputGstPaise !== null && i.inputGstPaise !== undefined;
    const gst = explicit ? Math.round(i.inputGstPaise) : (0, _shared.finEstimateInputGst)(i.amountPaise, i.gstRateBp);
    const source = explicit ? i.source === 'OCR' ? 'OCR' : 'MANUAL' : 'ESTIMATED';
    if (gst < 0) throw new PurchaseGstError('Input GST cannot be negative');
    if (gst > Math.floor(i.amountPaise * 28 / 128) + 1) throw new PurchaseGstError('Input GST is more than the highest GST slab allows for this amount');
    const vendorState = i.vendorStateCode || stateFromGstin(i.vendorGstin);
    const supply = (0, _shared.finDeriveSupplyType)(i.tenantStateCode, vendorState);
    const split = (0, _shared.finSplitInputGst)(gst, supply);
    return {
        taxablePaise: i.amountPaise - gst,
        inputGstPaise: gst,
        ...split,
        source,
        itcEligible: i.itcEligibleDefault && !!i.vendorGstin?.trim()
    };
}
function utiliseItc(liability, credit) {
    const L = {
        ...liability
    };
    const C = {
        ...credit
    };
    const steps = [];
    const use = (from, to)=>{
        const amt = Math.min(C[from], L[to]);
        if (amt > 0) {
            C[from] -= amt;
            L[to] -= amt;
            steps.push({
                from: from.toUpperCase(),
                to: to.toUpperCase(),
                amountPaise: amt
            });
        }
    };
    use('igst', 'igst');
    use('igst', 'cgst');
    use('igst', 'sgst');
    use('cgst', 'cgst');
    use('cgst', 'igst');
    use('sgst', 'sgst');
    use('sgst', 'igst');
    return {
        payable: L,
        carryForward: C,
        steps
    };
}
function payrollPostingLines(t) {
    const gross = Math.max(0, Math.round(t.grossPaise));
    const net = Math.max(0, Math.round(t.netPaise));
    const ded = Math.max(0, Math.round(t.deductionsPaise ?? gross - net));
    const erPf = Math.max(0, Math.round(t.employerPfPaise ?? 0));
    let empPf = t.employeePfPaise ?? Math.min(erPf, ded);
    let pt = t.ptPaise ?? Math.min(ded - empPf, (t.employeeCount ?? 0) * 20000);
    empPf = Math.max(0, Math.min(empPf, ded));
    pt = Math.max(0, Math.min(pt, ded - empPf));
    const tds = t.tdsPaise ?? ded - empPf - pt;
    const other = ded - empPf - pt - tds;
    const lines = [
        {
            key: 'SALARY_EXPENSE',
            debitPaise: gross,
            creditPaise: 0,
            narration: 'Gross salaries'
        },
        {
            key: 'EMPLOYER_PF_EXPENSE',
            debitPaise: erPf,
            creditPaise: 0,
            narration: 'Employer PF contribution'
        },
        {
            key: 'SALARY_PAYABLE',
            debitPaise: 0,
            creditPaise: net,
            narration: 'Net pay'
        },
        {
            key: 'PF_PAYABLE',
            debitPaise: 0,
            creditPaise: empPf + erPf,
            narration: 'PF (employee + employer)'
        },
        {
            key: 'PT_PAYABLE',
            debitPaise: 0,
            creditPaise: pt,
            narration: 'Professional tax'
        },
        {
            key: 'TDS_PAYABLE',
            debitPaise: 0,
            creditPaise: Math.max(0, tds) + Math.max(0, other),
            narration: 'TDS on salary (192)'
        }
    ];
    // Rounding / inconsistent producer totals: keep the voucher balanced on salary payable.
    const diff = lines.reduce((s, l)=>s + l.debitPaise - l.creditPaise, 0);
    if (diff !== 0) lines[2].creditPaise += diff;
    return lines.filter((l)=>l.debitPaise > 0 || l.creditPaise > 0);
}

//# sourceMappingURL=gst.js.map