/**
 * Invoice state rules (pure; unit-tested): which statuses are open, derived "Overdue",
 * display labels and the effect of a payment on the balance.
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
    get InvoiceRuleError () {
        return InvoiceRuleError;
    },
    get OPEN_INVOICE_STATUSES () {
        return OPEN_INVOICE_STATUSES;
    },
    get invoiceActions () {
        return invoiceActions;
    },
    get invoiceDisplayStatus () {
        return invoiceDisplayStatus;
    },
    get isInvoiceOverdue () {
        return isInvoiceOverdue;
    },
    get paymentOutcome () {
        return paymentOutcome;
    }
});
const OPEN_INVOICE_STATUSES = [
    'ISSUED',
    'EMAILED',
    'PARTIALLY_PAID'
];
let InvoiceRuleError = class InvoiceRuleError extends Error {
    code;
    constructor(code, message){
        super(message), this.code = code;
    }
};
const inr = (paise)=>`₹ ${new Intl.NumberFormat('en-IN', {
        maximumFractionDigits: 2
    }).format(paise / 100)}`;
function isInvoiceOverdue(inv, today) {
    return !!inv.dueDate && OPEN_INVOICE_STATUSES.includes(inv.status) && inv.dueDate.getTime() < today.getTime();
}
const LABEL = {
    DRAFT: 'Draft',
    ISSUED: 'Issued',
    EMAILED: 'Emailed',
    PARTIALLY_PAID: 'Partially paid',
    PAID: 'Paid',
    CANCELLED: 'Cancelled'
};
function invoiceDisplayStatus(status, overdue) {
    return overdue ? 'Overdue' : LABEL[status];
}
function paymentOutcome(totalPaise, balancePaise, amountPaise, tdsPaise = 0) {
    if (!Number.isInteger(amountPaise) || amountPaise <= 0) throw new InvoiceRuleError('AMOUNT', 'Amount must be more than zero');
    if (!Number.isInteger(tdsPaise) || tdsPaise < 0) throw new InvoiceRuleError('TDS', 'TDS cannot be negative');
    const settled = amountPaise + tdsPaise;
    if (settled > balancePaise) throw new InvoiceRuleError('OVERPAYMENT', `Payment is more than the balance due (${inr(balancePaise)})`);
    const balance = balancePaise - settled;
    return {
        balancePaise: balance,
        status: balance === 0 ? 'PAID' : 'PARTIALLY_PAID',
        settledPaise: settled
    };
}
function invoiceActions(status, hasPayments) {
    const open = OPEN_INVOICE_STATUSES.includes(status);
    return {
        edit: status === 'DRAFT',
        delete: status === 'DRAFT',
        issue: status === 'DRAFT',
        email: open || status === 'PAID',
        pay: open,
        cancel: open && !hasPayments
    };
}

//# sourceMappingURL=invoice-rules.js.map