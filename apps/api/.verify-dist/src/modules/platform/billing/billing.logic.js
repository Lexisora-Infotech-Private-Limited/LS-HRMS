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
    get SAC_CODE () {
        return SAC_CODE;
    },
    get SUPPLIER_GSTIN () {
        return SUPPLIER_GSTIN;
    },
    get SUPPLIER_STATE () {
        return SUPPLIER_STATE;
    },
    get addCycle () {
        return addCycle;
    },
    get daysInclusive () {
        return daysInclusive;
    },
    get daysUntil () {
        return daysUntil;
    },
    get defaultSubscriptionFor () {
        return defaultSubscriptionFor;
    },
    get discountFor () {
        return discountFor;
    },
    get displayedSeats () {
        return displayedSeats;
    },
    get gstSplit () {
        return gstSplit;
    },
    get invoiceNumber () {
        return invoiceNumber;
    },
    get mrrPaise () {
        return mrrPaise;
    },
    get pctChange () {
        return pctChange;
    },
    get periodLine () {
        return periodLine;
    },
    get planLabel () {
        return planLabel;
    },
    get prorationPaise () {
        return prorationPaise;
    },
    get reminderDue () {
        return reminderDue;
    },
    get roundHalfUp () {
        return roundHalfUp;
    },
    get roundToRupee () {
        return roundToRupee;
    },
    get seatAvailable () {
        return seatAvailable;
    },
    get seatsBilled () {
        return seatsBilled;
    },
    get totalsFor () {
        return totalsFor;
    },
    get validatePromo () {
        return validatePromo;
    }
});
const _shared = require("@lexisora/shared");
const SUPPLIER_STATE = '24';
const SUPPLIER_GSTIN = '24AAECL1234F1Z5';
const SAC_CODE = '998314';
const roundHalfUp = (n)=>Math.floor(n + 0.5);
function discountFor(subtotal, promo) {
    if (!promo || subtotal <= 0) return 0;
    if (promo.percentOff) return Math.min(subtotal, roundHalfUp(subtotal * promo.percentOff / 100));
    if (promo.amountOffPaise) return Math.min(subtotal, promo.amountOffPaise);
    return 0;
}
function gstSplit(taxable, placeOfSupply, supplierState = SUPPLIER_STATE) {
    if (placeOfSupply === supplierState) {
        const half = roundHalfUp(taxable * 0.09);
        return {
            cgst: half,
            sgst: half,
            igst: 0
        };
    }
    return {
        cgst: 0,
        sgst: 0,
        igst: roundHalfUp(taxable * 0.18)
    };
}
function roundToRupee(paise) {
    const total = roundHalfUp(paise / 100) * 100;
    return {
        total,
        roundOff: total - paise
    };
}
function totalsFor(lines, placeOfSupply, promo) {
    const subtotal = lines.reduce((s, l)=>s + l.amountPaise, 0);
    const discount = discountFor(subtotal, promo);
    const all = discount ? [
        ...lines,
        {
            kind: 'DISCOUNT',
            description: `Promo ${promo.code} · ${promo.description}`,
            quantity: 1,
            unitPaise: -discount,
            amountPaise: -discount
        }
    ] : lines;
    const taxable = subtotal - discount;
    const g = gstSplit(taxable, placeOfSupply);
    const { total, roundOff } = roundToRupee(taxable + g.cgst + g.sgst + g.igst);
    return {
        lines: all,
        subtotalPaise: subtotal,
        discountPaise: discount,
        taxablePaise: taxable,
        cgstPaise: g.cgst,
        sgstPaise: g.sgst,
        igstPaise: g.igst,
        roundOffPaise: roundOff,
        totalPaise: total,
        placeOfSupply
    };
}
function periodLine(cycle, quantity, unitPaise = _shared.GROWTH_PRICE_PAISE[cycle]) {
    const chargeable = (0, _shared.chargeableSeats)(quantity);
    const per = (0, _shared.seatPeriodPaise)(cycle, unitPaise);
    return {
        kind: 'SEATS',
        description: `Growth · ${cycle === 'YEARLY' ? 'yearly' : 'monthly'} · ${quantity} seats (first ${_shared.FREE_SEATS} free) · ${chargeable} × ₹${(unitPaise / 100).toFixed(0)}/user/month${cycle === 'YEARLY' ? ' × 12' : ''}`,
        quantity: chargeable,
        unitPaise: per,
        amountPaise: chargeable * per
    };
}
function daysInclusive(from, to) {
    const d = (x)=>Math.floor((x.getTime() + 5.5 * 3600_000) / 86400_000);
    return Math.max(0, d(to) - d(from));
}
function prorationPaise(oldQ, newQ, cycle, remainingDays, totalDays, unitPaise = _shared.GROWTH_PRICE_PAISE[cycle]) {
    const added = (0, _shared.chargeableSeats)(newQ) - (0, _shared.chargeableSeats)(oldQ);
    if (added <= 0 || totalDays <= 0) return 0;
    return roundHalfUp(added * (0, _shared.seatPeriodPaise)(cycle, unitPaise) * remainingDays / totalDays);
}
function addCycle(start, cycle) {
    const d = new Date(start);
    if (cycle === 'YEARLY') d.setUTCFullYear(d.getUTCFullYear() + 1);
    else d.setUTCMonth(d.getUTCMonth() + 1);
    return d;
}
function validatePromo(promo, ctx) {
    if (!promo) return {
        ok: false,
        status: 404,
        code: 'PROMO_NOT_FOUND',
        message: 'That promo code doesn’t exist'
    };
    if (!promo.active || ctx.now < promo.validFrom || promo.validUntil && ctx.now > promo.validUntil) {
        return {
            ok: false,
            status: 400,
            code: 'PROMO_EXPIRED',
            message: 'This promo code has expired'
        };
    }
    if (ctx.alreadyRedeemed) return {
        ok: false,
        status: 409,
        code: 'PROMO_ALREADY_USED',
        message: 'Already used'
    };
    if (promo.maxRedemptions !== null && promo.redeemedCount >= promo.maxRedemptions) {
        return {
            ok: false,
            status: 400,
            code: 'PROMO_EXHAUSTED',
            message: 'This promo code has reached its limit'
        };
    }
    // A Free tenant may hold a Growth promo until it upgrades.
    const plan = ctx.planCode === 'FREE' ? 'GROWTH' : ctx.planCode;
    if (promo.planCodes.length && !promo.planCodes.includes(plan)) {
        return {
            ok: false,
            status: 400,
            code: 'PROMO_NOT_FOR_PLAN',
            message: 'This promo code isn’t valid for your plan'
        };
    }
    if (ctx.cycle && promo.cycles.length && !promo.cycles.includes(ctx.cycle)) {
        return {
            ok: false,
            status: 400,
            code: 'PROMO_NOT_FOR_CYCLE',
            message: `This promo code isn’t valid for ${ctx.cycle === 'YEARLY' ? 'yearly' : 'monthly'} billing`
        };
    }
    return {
        ok: true
    };
}
const BILLABLE = new Set([
    'ACTIVE',
    'PAST_DUE',
    'READ_ONLY'
]);
const PAID_PLANS = new Set([
    'GROWTH',
    'ENTERPRISE'
]);
function mrrPaise(subs) {
    let sum = 0;
    for (const s of subs){
        if (!BILLABLE.has(s.status) || !PAID_PLANS.has(s.planCode)) continue;
        if (s.planCode === 'ENTERPRISE' && s.contractPaisePerYear) {
            sum += roundHalfUp(s.contractPaisePerYear / 12);
            continue;
        }
        const cycle = s.cycle ?? 'MONTHLY';
        sum += (0, _shared.chargeableSeats)(s.quantity) * (s.unitPaise ?? _shared.GROWTH_PRICE_PAISE[cycle]);
    }
    return sum;
}
function seatsBilled(subs) {
    return subs.filter((s)=>BILLABLE.has(s.status) && PAID_PLANS.has(s.planCode)).reduce((n, s)=>n + s.quantity, 0);
}
function pctChange(now, before) {
    if (!before) return null;
    return Math.round((now - before) / before * 100);
}
function planLabel(planCode, cycle) {
    if (planCode === 'GROWTH') return `Growth · ${cycle === 'MONTHLY' ? 'monthly' : 'yearly'}`;
    return ({
        FREE: 'Free',
        ENTERPRISE: 'Enterprise',
        INTERNAL: 'Internal'
    })[planCode] ?? planCode;
}
function defaultSubscriptionFor(isOperator) {
    return isOperator ? {
        planCode: 'INTERNAL',
        status: 'ACTIVE',
        quantity: _shared.FREE_SEATS,
        collection: 'OFFLINE_INVOICE'
    } : {
        planCode: 'FREE',
        status: 'FREE',
        quantity: _shared.FREE_SEATS,
        collection: 'GATEWAY'
    };
}
function displayedSeats(planCode, quantity, used) {
    if (planCode === 'FREE') return _shared.FREE_SEATS;
    if (planCode === 'INTERNAL') return Math.max(quantity, used);
    return quantity;
}
function seatAvailable(planCode, quantity, activeUsers) {
    if (planCode === 'INTERNAL') return true;
    const limit = planCode === 'FREE' ? _shared.FREE_SEATS : quantity;
    return activeUsers < limit;
}
function invoiceNumber(fy, n) {
    return `LXS/${fy.slice(2)}/${String(n).padStart(4, '0')}`;
}
function daysUntil(end, now) {
    const day = (d)=>Date.parse(`${(0, _shared.istDateKey)(d)}T00:00:00Z`);
    return Math.round((day(end) - day(now)) / 86_400_000);
}
function reminderDue(cycle, daysLeft) {
    return daysLeft === 7 || daysLeft === 1 || cycle === 'YEARLY' && daysLeft === 30;
}

//# sourceMappingURL=billing.logic.js.map