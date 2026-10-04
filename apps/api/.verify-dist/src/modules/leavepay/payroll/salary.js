/**
 * Salary structure resolution (pure). "Standard FT" template:
 *   BASIC = 50% × G, HRA = 50% × BASIC, SPECIAL = G − BASIC − HRA (balancing),
 *   PF_ER = 12% × min(BASIC, 15,000) (ceiling opted), CTC/month = G + PF_ER (+ ESI_ER if covered).
 * Interns: a single STIPEND component; CTC = stipend.
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
    get COMPONENT_LABELS () {
        return COMPONENT_LABELS;
    },
    get INTERN_STIPEND () {
        return INTERN_STIPEND;
    },
    get STANDARD_FT () {
        return STANDARD_FT;
    },
    get buildStructure () {
        return buildStructure;
    },
    get grossFromCtc () {
        return grossFromCtc;
    },
    get pfEmployerMonthly () {
        return pfEmployerMonthly;
    },
    get structureFromGross () {
        return structureFromGross;
    },
    get toRupee () {
        return toRupee;
    }
});
const _statutory = require("./statutory");
const COMPONENT_LABELS = {
    BASIC: 'Basic',
    DA: 'Dearness allowance',
    HRA: 'HRA',
    SPECIAL: 'Special allowance',
    STIPEND: 'Stipend',
    PF_ER: 'PF (employer)',
    ESI_ER: 'ESI (employer)',
    CTC: 'CTC'
};
const STANDARD_FT = [
    {
        componentCode: 'BASIC',
        calc: 'PERCENT_OF_GROSS',
        value: 50
    },
    {
        componentCode: 'HRA',
        calc: 'PERCENT_OF_COMPONENT',
        value: 50,
        base: 'BASIC'
    },
    {
        componentCode: 'SPECIAL',
        calc: 'BALANCING'
    },
    {
        componentCode: 'PF_ER',
        calc: 'STATUTORY'
    }
];
const INTERN_STIPEND = [
    {
        componentCode: 'STIPEND',
        calc: 'FIXED'
    }
];
const toRupee = (p)=>Math.round(p / 100) * 100;
function structureFromGross(grossMonthlyPaise, opts) {
    const warnings = [];
    const g = toRupee(grossMonthlyPaise);
    if (opts.payType === 'STIPEND') {
        const lines = [
            line('STIPEND', g)
        ];
        return {
            lines,
            ctcMonthlyPaise: g,
            warnings
        };
    }
    const tpl = opts.template ?? STANDARD_FT;
    const vals = {};
    let assigned = 0;
    for (const t of tpl){
        if (t.calc === 'PERCENT_OF_GROSS') vals[t.componentCode] = toRupee(g * (t.value ?? 0) / 100);
        else if (t.calc === 'PERCENT_OF_COMPONENT') vals[t.componentCode] = toRupee((vals[t.base ?? 'BASIC'] ?? 0) * (t.value ?? 0) / 100);
        else if (t.calc === 'FIXED') vals[t.componentCode] = toRupee((t.value ?? 0) * 100);
        if (t.calc !== 'BALANCING' && t.calc !== 'STATUTORY') assigned += vals[t.componentCode];
    }
    const bal = tpl.find((t)=>t.calc === 'BALANCING');
    if (bal) {
        vals[bal.componentCode] = g - assigned;
        if (vals[bal.componentCode] < 0) warnings.push('Special allowance would be negative; gross is too low for this template');
    }
    const earnings = tpl.filter((t)=>t.calc !== 'STATUTORY').map((t)=>line(t.componentCode, vals[t.componentCode] ?? 0));
    const basicDa = (vals.BASIC ?? 0) + (vals.DA ?? 0);
    if (basicDa < g * 0.5 - 1) warnings.push('Basic + DA is below 50% of gross (wage-code rule); PF wages will add back the shortfall');
    const pfEr = pfEmployerMonthly(basicDa, opts);
    const esiEr = (0, _statutory.esiCovered)(g, opts.esiMode) ? Math.ceil(g * _statutory.ESI_CONFIG.erRate / 100 - 1e-9) * 100 : 0;
    const lines = [
        ...earnings
    ];
    if (pfEr) lines.push(line('PF_ER', pfEr));
    if (esiEr) lines.push(line('ESI_ER', esiEr));
    return {
        lines,
        ctcMonthlyPaise: g + pfEr + esiEr,
        warnings
    };
}
function pfEmployerMonthly(basicDaPaise, opts) {
    if (opts.pfEnabled === false) return 0;
    const wage = opts.pfCeilingOpted === false ? basicDaPaise : Math.min(basicDaPaise, _statutory.PF_CONFIG.wageCeilingPaise);
    return toRupee(wage * _statutory.PF_CONFIG.erRate);
}
function grossFromCtc(ctcAnnualPaise, opts) {
    const target = ctcAnnualPaise / 12;
    if (opts.payType === 'STIPEND') return toRupee(target);
    let lo = 0;
    let hi = Math.ceil(target / 100) * 100 + 100;
    for(let i = 0; i < 60 && hi - lo > 100; i++){
        const mid = Math.floor((lo + hi) / 200) * 100;
        if (structureFromGross(mid, opts).ctcMonthlyPaise < target) lo = mid;
        else hi = mid;
    }
    const best = [
        lo,
        hi
    ].reduce((a, b)=>Math.abs(structureFromGross(a, opts).ctcMonthlyPaise - target) <= Math.abs(structureFromGross(b, opts).ctcMonthlyPaise - target) ? a : b);
    return best;
}
function buildStructure(input, opts) {
    const gross = input.grossMonthlyPaise ?? grossFromCtc(input.ctcAnnualPaise ?? 0, opts);
    const s = structureFromGross(gross, opts);
    return {
        grossMonthlyPaise: toRupee(gross),
        ctcMonthlyPaise: s.ctcMonthlyPaise,
        ctcAnnualPaise: s.ctcMonthlyPaise * 12,
        lines: s.lines,
        table: [
            ...s.lines,
            line('CTC', s.ctcMonthlyPaise)
        ],
        warnings: s.warnings
    };
}
function line(code, monthly) {
    return {
        code,
        label: COMPONENT_LABELS[code] ?? code,
        monthlyPaise: monthly,
        annualPaise: monthly * 12
    };
}

//# sourceMappingURL=salary.js.map