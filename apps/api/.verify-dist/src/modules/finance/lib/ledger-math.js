/**
 * Double-entry rules as pure functions (unit-tested): voucher balance validation, the
 * primary-ledger label on the day book, trial balance and account statements.
 * Balances are debit-positive (credit balances negative).
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
    get VoucherValidationError () {
        return VoucherValidationError;
    },
    get computeTrialBalance () {
        return computeTrialBalance;
    },
    get mergeLines () {
        return mergeLines;
    },
    get primaryLedger () {
        return primaryLedger;
    },
    get profitAndLoss () {
        return profitAndLoss;
    },
    get reverseLines () {
        return reverseLines;
    },
    get runningStatement () {
        return runningStatement;
    },
    get validateVoucherLines () {
        return validateVoucherLines;
    }
});
let VoucherValidationError = class VoucherValidationError extends Error {
    code;
    differencePaise;
    constructor(code, message, differencePaise = 0){
        super(message), this.code = code, this.differencePaise = differencePaise;
    }
};
const inr = (paise)=>`₹${new Intl.NumberFormat('en-IN', {
        maximumFractionDigits: 2
    }).format(paise / 100)}`;
function validateVoucherLines(lines) {
    const norm = lines.map((l)=>({
            accountId: l.accountId,
            debitPaise: Math.round(l.debitPaise ?? 0),
            creditPaise: Math.round(l.creditPaise ?? 0),
            narration: l.narration ?? null
        })).filter((l)=>l.debitPaise !== 0 || l.creditPaise !== 0);
    for (const l of norm){
        if (l.debitPaise < 0 || l.creditPaise < 0) throw new VoucherValidationError('LINE_AMOUNT', 'Amounts must be positive');
        if (l.debitPaise > 0 && l.creditPaise > 0) throw new VoucherValidationError('LINE_SIDE', 'A line can be either a debit or a credit, not both');
        if (!Number.isSafeInteger(l.debitPaise) || !Number.isSafeInteger(l.creditPaise)) throw new VoucherValidationError('LINE_AMOUNT', 'Amounts must be whole paise');
    }
    if (norm.length < 2) throw new VoucherValidationError('TOO_FEW_LINES', 'A voucher needs at least one debit and one credit line');
    const dr = norm.reduce((s, l)=>s + l.debitPaise, 0);
    const cr = norm.reduce((s, l)=>s + l.creditPaise, 0);
    if (dr !== cr) {
        const diff = Math.abs(dr - cr);
        throw new VoucherValidationError('UNBALANCED', `Debits and credits don't match. Difference ${inr(diff)}`, dr - cr);
    }
    if (dr === 0) throw new VoucherValidationError('LINE_AMOUNT', 'Voucher amount must be more than zero');
    return {
        lines: norm,
        totalPaise: dr
    };
}
function mergeLines(lines) {
    const map = new Map();
    for (const l of lines){
        const side = l.debitPaise > 0 ? 'D' : 'C';
        const k = `${l.accountId}:${side}`;
        const cur = map.get(k);
        if (cur) {
            cur.debitPaise += l.debitPaise;
            cur.creditPaise += l.creditPaise;
        } else map.set(k, {
            ...l
        });
    }
    return [
        ...map.values()
    ];
}
const MONEY_KEYS = new Set([
    'BANK',
    'CASH'
]);
const TAX_KEYS = /^GST_(INPUT|OUTPUT)_/;
function primaryLedger(lines, accounts) {
    const total = lines.reduce((s, l)=>s + l.debitPaise, 0);
    const meta = (id)=>accounts.get(id);
    const party = lines.find((l)=>meta(l.accountId)?.partyType);
    const others = lines.filter((l)=>{
        const m = meta(l.accountId);
        return m && !MONEY_KEYS.has(m.systemKey ?? '') && !TAX_KEYS.test(m.systemKey ?? '') && m.systemKey !== 'ROUND_OFF';
    });
    let pick = party ?? (others.length === 1 ? others[0] : undefined);
    // Two-line vouchers (expense vs payable, asset vs capital…): the debit account is the ledger.
    if (!pick && others.length > 1 && lines.length === 2) pick = lines.find((l)=>l.debitPaise > 0);
    if (!pick && others.length > 1) {
        // Several ledgers: when all sit on one side, show "Multiple" on that side.
        const debitSide = others.every((l)=>l.debitPaise > 0);
        const creditSide = others.every((l)=>l.creditPaise > 0);
        if (debitSide || creditSide) return {
            ledger: 'Multiple',
            debitPaise: debitSide ? total : 0,
            creditPaise: creditSide ? total : 0
        };
        return {
            ledger: 'Multiple',
            debitPaise: total,
            creditPaise: 0
        };
    }
    if (!pick) pick = lines.find((l)=>l.debitPaise > 0) ?? lines[0];
    if (!pick) return {
        ledger: '—',
        debitPaise: 0,
        creditPaise: 0
    };
    const name = meta(pick.accountId)?.name ?? '—';
    return pick.debitPaise > 0 ? {
        ledger: name,
        debitPaise: total,
        creditPaise: 0
    } : {
        ledger: name,
        debitPaise: 0,
        creditPaise: total
    };
}
function computeTrialBalance(accounts, before, within) {
    const pre = new Map(before.map((s)=>[
            s.accountId,
            s.debitPaise - s.creditPaise
        ]));
    const mov = new Map(within.map((s)=>[
            s.accountId,
            s
        ]));
    const rows = accounts.filter((a)=>!a.isGroup).map((a)=>{
        const openingPaise = a.openingPaise + (pre.get(a.id) ?? 0);
        const m = mov.get(a.id);
        const debitPaise = m?.debitPaise ?? 0;
        const creditPaise = m?.creditPaise ?? 0;
        return {
            accountId: a.id,
            code: a.code,
            name: a.name,
            type: a.type,
            openingPaise,
            debitPaise,
            creditPaise,
            closingPaise: openingPaise + debitPaise - creditPaise
        };
    }).filter((r)=>r.openingPaise !== 0 || r.debitPaise !== 0 || r.creditPaise !== 0).sort((x, y)=>x.code.localeCompare(y.code));
    const totals = rows.reduce((t, r)=>({
            openingDr: t.openingDr + Math.max(0, r.openingPaise),
            openingCr: t.openingCr + Math.max(0, -r.openingPaise),
            debitPaise: t.debitPaise + r.debitPaise,
            creditPaise: t.creditPaise + r.creditPaise,
            closingDr: t.closingDr + Math.max(0, r.closingPaise),
            closingCr: t.closingCr + Math.max(0, -r.closingPaise)
        }), {
        openingDr: 0,
        openingCr: 0,
        debitPaise: 0,
        creditPaise: 0,
        closingDr: 0,
        closingCr: 0
    });
    return {
        rows,
        totals,
        balanced: totals.closingDr === totals.closingCr && totals.debitPaise === totals.creditPaise
    };
}
function runningStatement(openingPaise, rows) {
    let bal = openingPaise;
    const out = rows.map((r)=>{
        bal += r.debitPaise - r.creditPaise;
        return {
            ...r,
            balancePaise: bal
        };
    });
    return {
        rows: out,
        closingPaise: bal
    };
}
function profitAndLoss(sums) {
    const income = sums.filter((s)=>s.type === 'INCOME').reduce((t, s)=>t + s.creditPaise - s.debitPaise, 0);
    const expenses = sums.filter((s)=>s.type === 'EXPENSE').reduce((t, s)=>t + s.debitPaise - s.creditPaise, 0);
    return {
        incomePaise: income,
        expensesPaise: expenses,
        balancePaise: income - expenses
    };
}
function reverseLines(lines) {
    return lines.map((l)=>({
            ...l,
            debitPaise: l.creditPaise,
            creditPaise: l.debitPaise
        }));
}

//# sourceMappingURL=ledger-math.js.map