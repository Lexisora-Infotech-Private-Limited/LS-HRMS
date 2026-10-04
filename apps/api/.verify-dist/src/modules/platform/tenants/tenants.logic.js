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
    get initialQuantity () {
        return initialQuantity;
    },
    get isPaidPlan () {
        return isPaidPlan;
    },
    get nameFromEmail () {
        return nameFromEmail;
    },
    get seatsFigure () {
        return seatsFigure;
    },
    get slugProblem () {
        return slugProblem;
    },
    get tenantInTab () {
        return tenantInTab;
    },
    get tenantPlanCode () {
        return tenantPlanCode;
    },
    get tenantStatusOf () {
        return tenantStatusOf;
    }
});
const _shared = require("@lexisora/shared");
function tenantPlanCode(sub, isOperator) {
    if (isOperator) return 'INTERNAL';
    const p = sub?.planCode;
    return p === 'GROWTH' || p === 'ENTERPRISE' || p === 'INTERNAL' ? p : 'FREE';
}
function tenantStatusOf(tenantStatus, sub, isOperator) {
    if (tenantStatus === 'SUSPENDED' || sub?.status === 'SUSPENDED') return {
        status: 'Suspended',
        tone: 'neutral'
    };
    if (isOperator) return {
        status: 'Active',
        tone: 'accent'
    };
    if (sub?.status === 'READ_ONLY') return {
        status: 'Read-only',
        tone: 'outline'
    };
    if (sub?.status === 'PAST_DUE' || tenantStatus === 'PAYMENT_DUE') return {
        status: 'Payment due',
        tone: 'outline'
    };
    if (!sub || sub.planCode === 'FREE') return {
        status: 'Free tier',
        tone: 'neutral'
    };
    if (sub.status === 'CANCELLED') return {
        status: 'Cancelled',
        tone: 'neutral'
    };
    return {
        status: 'Active',
        tone: 'accent'
    };
}
const isPaidPlan = (p)=>p === 'GROWTH' || p === 'ENTERPRISE';
function seatsFigure(planCode, used, quantity) {
    return isPaidPlan(planCode) ? quantity.toLocaleString('en-IN') : used.toLocaleString('en-IN');
}
function tenantInTab(row, tab) {
    if (tab === 'all') return true;
    if (tab === 'paid') return isPaidPlan(row.planCode);
    if (tab === 'free') return row.planCode === 'FREE';
    return [
        'Payment due',
        'Read-only',
        'Suspended'
    ].includes(row.status);
}
function slugProblem(slug) {
    if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(slug)) return 'Use letters, numbers and hyphens, e.g. nova';
    if (slug.length < 3) return 'Use at least 3 characters';
    if (_shared.RESERVED_SLUGS.includes(slug)) return `“${slug}” is reserved`;
    return null;
}
function nameFromEmail(email) {
    const local = email.split('@')[0] ?? email;
    const words = local.split(/[._-]+/).filter(Boolean);
    if (!words.length) return email;
    return words.map((w)=>w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}
function initialQuantity(planCode, seats) {
    return planCode === 'FREE' ? _shared.FREE_SEATS : Math.max(_shared.FREE_SEATS + 1, seats ?? _shared.FREE_SEATS + 1);
}

//# sourceMappingURL=tenants.logic.js.map