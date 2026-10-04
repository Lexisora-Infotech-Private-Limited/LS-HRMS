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
    get dbDateKey () {
        return dbDateKey;
    },
    get fmt () {
        return fmt;
    },
    get fmtMonthYear () {
        return fmtMonthYear;
    },
    get fmtStamp () {
        return fmtStamp;
    },
    get fmtWhen () {
        return fmtWhen;
    },
    get inrPdf () {
        return inrPdf;
    },
    get model () {
        return model;
    },
    get splitName () {
        return splitName;
    },
    get toDbDate () {
        return toDbDate;
    },
    get todayKey () {
        return todayKey;
    },
    get token () {
        return token;
    }
});
const _nodecrypto = require("node:crypto");
const _shared = require("@lexisora/shared");
const todayKey = ()=>(0, _shared.istDateKey)(new Date());
const toDbDate = (s)=>new Date(`${s}T00:00:00.000Z`);
const dbDateKey = (d)=>d ? d.toISOString().slice(0, 10) : null;
const fmt = (d)=>d ? (0, _shared.formatDate)(d) : '—';
const fmtMonthYear = (d)=>d ? (0, _shared.formatMonthYear)(d) : '—';
const fmtWhen = (d)=>`${(0, _shared.formatDayMonth)(d)}, ${(0, _shared.formatTime)(d)}`;
const fmtStamp = (d)=>`${(0, _shared.formatDate)(d)}, ${new Intl.DateTimeFormat('en-GB', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
        timeZone: 'Asia/Kolkata'
    }).format(d)}`;
const token = (bytes = 24)=>(0, _nodecrypto.randomBytes)(bytes).toString('base64url');
function inrPdf(paise) {
    return 'Rs. ' + new Intl.NumberFormat('en-IN', {
        maximumFractionDigits: 0
    }).format(Math.round(paise / 100));
}
function splitName(full) {
    const parts = full.trim().split(/\s+/);
    if (parts.length === 1) return {
        firstName: parts[0],
        lastName: ''
    };
    return {
        firstName: parts.slice(0, -1).join(' '),
        lastName: parts[parts.length - 1]
    };
}
function model(prisma, name) {
    const m = prisma[name];
    return m && typeof m === 'object' ? m : null;
}

//# sourceMappingURL=people.util.js.map