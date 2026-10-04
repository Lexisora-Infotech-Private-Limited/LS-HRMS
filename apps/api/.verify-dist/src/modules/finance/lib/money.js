/**
 * Pure helpers for finance: dates (IST business days), financial years, INR words,
 * voucher numbering and PDF-safe money formatting.
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
    get CREDIT_NOTE_SEQUENCE () {
        return CREDIT_NOTE_SEQUENCE;
    },
    get INVOICE_SEQUENCE () {
        return INVOICE_SEQUENCE;
    },
    get addDays () {
        return addDays;
    },
    get amountInWords () {
        return amountInWords;
    },
    get currentMonthKey () {
        return currentMonthKey;
    },
    get dateKeyOf () {
        return dateKeyOf;
    },
    get dateOnly () {
        return dateOnly;
    },
    get formatDocNumber () {
        return formatDocNumber;
    },
    get fyOf () {
        return fyOf;
    },
    get fyStart () {
        return fyStart;
    },
    get integerInWords () {
        return integerInWords;
    },
    get monthKeyOf () {
        return monthKeyOf;
    },
    get monthRange () {
        return monthRange;
    },
    get pdfINR () {
        return pdfINR;
    },
    get recentMonths () {
        return recentMonths;
    },
    get todayDate () {
        return todayDate;
    },
    get voucherPrefix () {
        return voucherPrefix;
    },
    get voucherSequence () {
        return voucherSequence;
    }
});
const _shared = require("@lexisora/shared");
function dateOnly(key) {
    return new Date(`${key}T00:00:00.000Z`);
}
function todayDate(now = new Date()) {
    return dateOnly((0, _shared.istDateKey)(now));
}
function dateKeyOf(d) {
    return d.toISOString().slice(0, 10);
}
function addDays(d, days) {
    return new Date(d.getTime() + days * 86_400_000);
}
function monthRange(month) {
    const [y, m] = month.split('-').map(Number);
    const start = new Date(Date.UTC(y, m - 1, 1));
    const end = new Date(Date.UTC(y, m, 0));
    return {
        start,
        end
    };
}
function monthKeyOf(d) {
    return d.toISOString().slice(0, 7);
}
function currentMonthKey(now = new Date()) {
    return (0, _shared.istDateKey)(now).slice(0, 7);
}
function recentMonths(fromMonth, count) {
    const [y, m] = fromMonth.split('-').map(Number);
    const out = [];
    for(let i = 0; i < count; i++){
        const d = new Date(Date.UTC(y, m - 1 - i, 1));
        out.push(d.toISOString().slice(0, 7));
    }
    return out;
}
function fyOf(d) {
    const y = d.getUTCMonth() >= 3 ? d.getUTCFullYear() : d.getUTCFullYear() - 1;
    return `${y}-${String((y + 1) % 100).padStart(2, '0')}`;
}
function fyStart(d) {
    const y = d.getUTCMonth() >= 3 ? d.getUTCFullYear() : d.getUTCFullYear() - 1;
    return new Date(Date.UTC(y, 3, 1));
}
const PREFIX = {
    PAYMENT: 'PMT',
    RECEIPT: 'RCPT',
    JOURNAL: 'JV',
    PAYROLL: 'JV',
    HR: 'HRV',
    SALES: 'SV',
    PURCHASE: 'PV',
    CREDIT_NOTE: 'CN'
};
function voucherPrefix(type) {
    return PREFIX[type];
}
function voucherSequence(type) {
    const p = PREFIX[type];
    return {
        key: `voucher.${p.toLowerCase()}`,
        prefix: `${p}-`,
        pad: p === 'CN' ? 4 : 3
    };
}
function formatDocNumber(prefix, n, pad) {
    return `${prefix}${String(n).padStart(pad, '0')}`;
}
const INVOICE_SEQUENCE = {
    key: 'invoice.gst',
    prefix: 'INV-',
    pad: 4
};
const CREDIT_NOTE_SEQUENCE = {
    key: 'invoice.credit_note',
    prefix: 'CN-',
    pad: 4
};
function pdfINR(paise, decimals = true) {
    const r = paise / 100;
    const s = new Intl.NumberFormat('en-IN', {
        minimumFractionDigits: decimals ? 2 : 0,
        maximumFractionDigits: decimals ? 2 : 0
    }).format(Math.abs(r));
    return `${r < 0 ? '-' : ''}Rs. ${s}`;
}
const ONES = [
    '',
    'One',
    'Two',
    'Three',
    'Four',
    'Five',
    'Six',
    'Seven',
    'Eight',
    'Nine',
    'Ten',
    'Eleven',
    'Twelve',
    'Thirteen',
    'Fourteen',
    'Fifteen',
    'Sixteen',
    'Seventeen',
    'Eighteen',
    'Nineteen'
];
const TENS = [
    '',
    '',
    'Twenty',
    'Thirty',
    'Forty',
    'Fifty',
    'Sixty',
    'Seventy',
    'Eighty',
    'Ninety'
];
function twoDigits(n) {
    if (n < 20) return ONES[n];
    const t = TENS[Math.floor(n / 10)];
    const o = n % 10;
    return o ? `${t}-${ONES[o]}` : t;
}
function threeDigits(n) {
    const h = Math.floor(n / 100);
    const rest = n % 100;
    const parts = [];
    if (h) parts.push(`${ONES[h]} Hundred`);
    if (rest) parts.push(twoDigits(rest));
    return parts.join(' ');
}
function integerInWords(n) {
    n = Math.floor(Math.abs(n));
    if (n === 0) return 'Zero';
    const parts = [];
    const crore = Math.floor(n / 1e7);
    n %= 1e7;
    const lakh = Math.floor(n / 1e5);
    n %= 1e5;
    const thousand = Math.floor(n / 1000);
    n %= 1000;
    if (crore) parts.push(`${crore >= 100 ? integerInWords(crore) : twoDigits(crore)} Crore`);
    if (lakh) parts.push(`${twoDigits(lakh)} Lakh`);
    if (thousand) parts.push(`${twoDigits(thousand)} Thousand`);
    if (n) parts.push(threeDigits(n));
    return parts.join(' ');
}
function amountInWords(paise) {
    const rupees = Math.floor(Math.abs(paise) / 100);
    const p = Math.abs(paise) % 100;
    return `Rupees ${integerInWords(rupees)}${p ? ` and ${twoDigits(p)} Paise` : ''} Only`;
}

//# sourceMappingURL=money.js.map