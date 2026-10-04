"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "loadCompensation", {
    enumerable: true,
    get: function() {
        return loadCompensation;
    }
});
const _peoplerules = require("./people.rules");
const _peopleutil = require("./people.util");
async function loadCompensation(prisma, crypto, employeeId) {
    try {
        const sal = await prisma.employeeSalary.findFirst({
            where: {
                employeeId,
                status: 'ACTIVE'
            },
            orderBy: {
                effectiveFrom: 'desc'
            }
        });
        if (sal) {
            const struct = (crypto.decryptJson(sal.structureEnc) ?? []).filter((r)=>!/^(CTC|GROSS|NET|TOTAL|NET_PAY)$/i.test(r.code ?? ''));
            const rows = struct.filter((r)=>(r.monthlyPaise ?? 0) > 0 || (r.annualPaise ?? 0) > 0).map((r)=>({
                    component: r.label ?? r.code ?? '—',
                    monthlyPaise: r.monthlyPaise ?? Math.round((r.annualPaise ?? 0) / 12),
                    annualPaise: r.annualPaise ?? (r.monthlyPaise ?? 0) * 12
                }));
            const rowsOrSplit = rows.length ? rows : (0, _peoplerules.splitCtc)(sal.ctcAnnualPaise).map((r)=>({
                    component: r.label,
                    monthlyPaise: r.monthlyPaise,
                    annualPaise: r.annualPaise
                }));
            rowsOrSplit.push({
                component: 'CTC',
                monthlyPaise: Math.round(sal.ctcAnnualPaise / 12),
                annualPaise: sal.ctcAnnualPaise,
                isTotal: true
            });
            return {
                rows: rowsOrSplit,
                ctcAnnualPaise: sal.ctcAnnualPaise,
                effectiveFrom: (0, _peopleutil.dbDateKey)(sal.effectiveFrom),
                source: 'PAYROLL'
            };
        }
    } catch  {
    /* payroll tables unavailable in this build */ }
    const app = await prisma.jobApplication.findFirst({
        where: {
            employeeId
        },
        include: {
            offer: true
        }
    });
    if (app?.offer) {
        const rows = (0, _peoplerules.splitCtc)(app.offer.annualCtcPaise).map((r)=>({
                component: r.label,
                monthlyPaise: r.monthlyPaise,
                annualPaise: r.annualPaise
            }));
        rows.push({
            component: 'CTC',
            monthlyPaise: Math.round(app.offer.annualCtcPaise / 12),
            annualPaise: app.offer.annualCtcPaise,
            isTotal: true
        });
        return {
            rows,
            ctcAnnualPaise: app.offer.annualCtcPaise,
            effectiveFrom: (0, _peopleutil.dbDateKey)(app.offer.joiningDate),
            source: 'OFFER'
        };
    }
    return null;
}

//# sourceMappingURL=compensation.js.map