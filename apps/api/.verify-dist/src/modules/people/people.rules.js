/**
 * Pure business rules for the People domain (no Nest / Prisma imports) so they are unit
 * tested in isolation: employee codes, statutory validation, CSV import rows, the onboarding
 * step state machine, exit/notice rules, appraisal scoring, interview results, ICS, asset
 * warranty thresholds, welcome-kit status, ID-card completeness and vCards.
 */ // ── Employee codes ─────────────────────────────────────────────────────────
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
    get ASSET_TRANSITIONS () {
        return ASSET_TRANSITIONS;
    },
    get CYCLE_FLOW () {
        return CYCLE_FLOW;
    },
    get EXIT_CHECKLIST () {
        return EXIT_CHECKLIST;
    },
    get MISSING_LABELS () {
        return MISSING_LABELS;
    },
    get OB_KEYS () {
        return OB_KEYS;
    },
    get OnboardingRuleError () {
        return OnboardingRuleError;
    },
    get STAGE_TRANSITIONS () {
        return STAGE_TRANSITIONS;
    },
    get addDays () {
        return addDays;
    },
    get applicationScore () {
        return applicationScore;
    },
    get applyOnboardingEvent () {
        return applyOnboardingEvent;
    },
    get bandFor () {
        return bandFor;
    },
    get buildIcs () {
        return buildIcs;
    },
    get buildVcf () {
        return buildVcf;
    },
    get canAssetMove () {
        return canAssetMove;
    },
    get canMoveStage () {
        return canMoveStage;
    },
    get computeLwd () {
        return computeLwd;
    },
    get csvEscape () {
        return csvEscape;
    },
    get currentStep () {
        return currentStep;
    },
    get dateOnly () {
        return dateOnly;
    },
    get daysBetween () {
        return daysBetween;
    },
    get defaultNoticeDays () {
        return defaultNoticeDays;
    },
    get eligibleForCycle () {
        return eligibleForCycle;
    },
    get empCodeSeries () {
        return empCodeSeries;
    },
    get employeeStatusLabel () {
        return employeeStatusLabel;
    },
    get exitBlockers () {
        return exitBlockers;
    },
    get formatEmpCode () {
        return formatEmpCode;
    },
    get idCardMissing () {
        return idCardMissing;
    },
    get incompleteSteps () {
        return incompleteSteps;
    },
    get initials () {
        return initials;
    },
    get isValidAadhaar () {
        return isValidAadhaar;
    },
    get isValidIfsc () {
        return isValidIfsc;
    },
    get isValidPan () {
        return isValidPan;
    },
    get istDateTime () {
        return istDateTime;
    },
    get kitStatus () {
        return kitStatus;
    },
    get lookupIfsc () {
        return lookupIfsc;
    },
    get maskAadhaar () {
        return maskAadhaar;
    },
    get maskAccount () {
        return maskAccount;
    },
    get maskPan () {
        return maskPan;
    },
    get maxCodeNumber () {
        return maxCodeNumber;
    },
    get namesMatch () {
        return namesMatch;
    },
    get orderByManager () {
        return orderByManager;
    },
    get overallFromRatings () {
        return overallFromRatings;
    },
    get parseFlexibleDate () {
        return parseFlexibleDate;
    },
    get pct () {
        return pct;
    },
    get resultFromRecommendation () {
        return resultFromRecommendation;
    },
    get slugify () {
        return slugify;
    },
    get splitCtc () {
        return splitCtc;
    },
    get stockKey () {
        return stockKey;
    },
    get suggestCycleName () {
        return suggestCycleName;
    },
    get suggestResult () {
        return suggestResult;
    },
    get templateWeightsValid () {
        return templateWeightsValid;
    },
    get validateBank () {
        return validateBank;
    },
    get validateCsvRow () {
        return validateCsvRow;
    },
    get validateCsvRows () {
        return validateCsvRows;
    },
    get verhoeffDigit () {
        return verhoeffDigit;
    },
    get verhoeffValid () {
        return verhoeffValid;
    },
    get warrantyThreshold () {
        return warrantyThreshold;
    },
    get weightedScore () {
        return weightedScore;
    },
    get whatsappLink () {
        return whatsappLink;
    },
    get ymd () {
        return ymd;
    }
});
function empCodeSeries(type) {
    return type === 'INTERN' ? {
        key: 'employee.intern',
        prefix: 'LX-I-',
        pad: 3
    } : {
        key: 'employee.fulltime',
        prefix: 'LX-',
        pad: 4
    };
}
function formatEmpCode(type, n) {
    if (!Number.isInteger(n) || n < 1) throw new Error('Sequence value must be a positive integer');
    const s = empCodeSeries(type);
    return s.prefix + String(n).padStart(s.pad, '0');
}
function maxCodeNumber(codes, type) {
    const re = type === 'INTERN' ? /^LX-I-(\d+)$/ : /^LX-(\d+)$/;
    return codes.reduce((m, c)=>{
        const x = re.exec(c);
        return x ? Math.max(m, Number(x[1])) : m;
    }, 0);
}
function isValidPan(pan) {
    return /^[A-Z]{5}[0-9]{4}[A-Z]$/.test(pan) && pan[3] === 'P';
}
const VD = [
    [
        0,
        1,
        2,
        3,
        4,
        5,
        6,
        7,
        8,
        9
    ],
    [
        1,
        2,
        3,
        4,
        0,
        6,
        7,
        8,
        9,
        5
    ],
    [
        2,
        3,
        4,
        0,
        1,
        7,
        8,
        9,
        5,
        6
    ],
    [
        3,
        4,
        0,
        1,
        2,
        8,
        9,
        5,
        6,
        7
    ],
    [
        4,
        0,
        1,
        2,
        3,
        9,
        5,
        6,
        7,
        8
    ],
    [
        5,
        9,
        8,
        7,
        6,
        0,
        4,
        3,
        2,
        1
    ],
    [
        6,
        5,
        9,
        8,
        7,
        1,
        0,
        4,
        3,
        2
    ],
    [
        7,
        6,
        5,
        9,
        8,
        2,
        1,
        0,
        4,
        3
    ],
    [
        8,
        7,
        6,
        5,
        9,
        3,
        2,
        1,
        0,
        4
    ],
    [
        9,
        8,
        7,
        6,
        5,
        4,
        3,
        2,
        1,
        0
    ]
];
const VP = [
    [
        0,
        1,
        2,
        3,
        4,
        5,
        6,
        7,
        8,
        9
    ],
    [
        1,
        5,
        7,
        6,
        2,
        8,
        3,
        0,
        9,
        4
    ],
    [
        5,
        8,
        0,
        3,
        7,
        9,
        6,
        1,
        4,
        2
    ],
    [
        8,
        9,
        1,
        6,
        0,
        4,
        3,
        5,
        2,
        7
    ],
    [
        9,
        4,
        5,
        3,
        1,
        2,
        6,
        8,
        7,
        0
    ],
    [
        4,
        2,
        8,
        6,
        5,
        7,
        3,
        9,
        0,
        1
    ],
    [
        2,
        7,
        9,
        3,
        8,
        0,
        6,
        4,
        1,
        5
    ],
    [
        7,
        0,
        4,
        6,
        9,
        1,
        3,
        2,
        5,
        8
    ]
];
function verhoeffValid(num) {
    if (!/^\d+$/.test(num)) return false;
    let c = 0;
    const digits = num.split('').reverse().map(Number);
    for(let i = 0; i < digits.length; i++)c = VD[c][VP[i % 8][digits[i]]];
    return c === 0;
}
function verhoeffDigit(num) {
    const inv = [
        0,
        4,
        3,
        2,
        1,
        5,
        6,
        7,
        8,
        9
    ];
    let c = 0;
    const digits = num.split('').reverse().map(Number);
    for(let i = 0; i < digits.length; i++)c = VD[c][VP[(i + 1) % 8][digits[i]]];
    return inv[c];
}
function isValidAadhaar(a) {
    return /^[2-9]\d{11}$/.test(a) && verhoeffValid(a);
}
function isValidIfsc(ifsc) {
    return /^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc);
}
function validateBank(i) {
    if (!/^\d{9,18}$/.test(i.accountNumber)) return 'Account number must be 9 to 18 digits';
    if (i.accountNumber !== i.confirmAccountNumber) return 'Account numbers do not match';
    if (!isValidIfsc(i.ifsc)) return 'Enter a valid IFSC (e.g. HDFC0001234)';
    return null;
}
const maskPan = (pan)=>pan && pan.length === 10 ? `XXXXX${pan.slice(5, 9)}X` : '—';
const maskAadhaar = (last4)=>last4 ? `XXXX XXXX ${last4}` : '—';
const maskAccount = (last4)=>last4 ? `XXXXXX${last4}` : '—';
/** Bundled IFSC → bank lookup (stub adapter; real adapter would call ifsc.razorpay.com). */ const IFSC_BANKS = {
    HDFC: 'HDFC Bank',
    ICIC: 'ICICI Bank',
    SBIN: 'State Bank of India',
    UTIB: 'Axis Bank',
    KKBK: 'Kotak Mahindra Bank',
    PUNB: 'Punjab National Bank',
    BARB: 'Bank of Baroda',
    CNRB: 'Canara Bank',
    UBIN: 'Union Bank of India',
    IDIB: 'Indian Bank',
    YESB: 'Yes Bank',
    INDB: 'IndusInd Bank',
    IDFB: 'IDFC First Bank',
    FDRL: 'Federal Bank',
    BKID: 'Bank of India',
    MAHB: 'Bank of Maharashtra',
    CBIN: 'Central Bank of India',
    IOBA: 'Indian Overseas Bank',
    RATN: 'RBL Bank',
    AUBL: 'AU Small Finance Bank'
};
function lookupIfsc(ifsc) {
    if (!isValidIfsc(ifsc)) return null;
    const bank = IFSC_BANKS[ifsc.slice(0, 4)];
    return bank ? {
        bank,
        branch: `Branch ${ifsc.slice(5)}`
    } : {
        bank: `${ifsc.slice(0, 4)} Bank`,
        branch: `Branch ${ifsc.slice(5)}`
    };
}
function parseFlexibleDate(s) {
    const v = (s ?? '').trim();
    let y, m, d;
    let x = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(v);
    if (x) [y, m, d] = [
        Number(x[1]),
        Number(x[2]),
        Number(x[3])
    ];
    else if (x = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/.exec(v)) [d, m, y] = [
        Number(x[1]),
        Number(x[2]),
        Number(x[3])
    ];
    else return null;
    const dt = new Date(Date.UTC(y, m - 1, d));
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
    return dt.toISOString().slice(0, 10);
}
const dateOnly = (s)=>new Date(`${s}T00:00:00.000Z`);
const ymd = (d)=>d.toISOString().slice(0, 10);
function addDays(s, n) {
    const d = dateOnly(s);
    d.setUTCDate(d.getUTCDate() + n);
    return ymd(d);
}
function daysBetween(a, b) {
    return Math.round((dateOnly(b).getTime() - dateOnly(a).getTime()) / 86400_000);
}
const TYPE_MAP = {
    'full-time': 'FULL_TIME',
    fulltime: 'FULL_TIME',
    full_time: 'FULL_TIME',
    ft: 'FULL_TIME',
    intern: 'INTERN',
    internship: 'INTERN',
    contract: 'CONTRACT'
};
const MODE_MAP = {
    office: 'OFFICE',
    remote: 'REMOTE',
    wfh: 'REMOTE',
    hybrid: 'HYBRID'
};
function validateCsvRow(raw, row, ctx, fileEmails = new Set()) {
    const errors = [];
    const g = (k)=>(raw[k] ?? '').trim();
    const fullName = g('full_name');
    const officialEmail = g('official_email').toLowerCase();
    const personalEmail = g('personal_email').toLowerCase() || null;
    const phone = g('phone');
    const department = g('department');
    const designation = g('designation');
    const managerEmail = g('manager_email').toLowerCase() || null;
    const typeRaw = g('employment_type').toLowerCase() || 'full-time';
    const modeRaw = g('work_mode').toLowerCase() || 'office';
    const branch = g('branch') || null;
    if (fullName.length < 2) errors.push({
        row,
        field: 'full_name',
        message: 'Full name is required'
    });
    if (!/^\S+@\S+\.\S+$/.test(officialEmail)) errors.push({
        row,
        field: 'official_email',
        message: 'Official email is invalid'
    });
    else if (ctx.existingEmails.has(officialEmail)) errors.push({
        row,
        field: 'official_email',
        message: `${officialEmail} already exists`
    });
    if (personalEmail && !/^\S+@\S+\.\S+$/.test(personalEmail)) errors.push({
        row,
        field: 'personal_email',
        message: 'Personal email is invalid'
    });
    if (!/^\+?[0-9 ()-]{10,18}$/.test(phone)) errors.push({
        row,
        field: 'phone',
        message: 'Phone must have at least 10 digits'
    });
    const departmentId = ctx.departments.get(department.toLowerCase()) ?? null;
    if (!department) errors.push({
        row,
        field: 'department',
        message: 'Department is required'
    });
    else if (!departmentId && !ctx.createMissingMasters) errors.push({
        row,
        field: 'department',
        message: `Unknown department "${department}"`
    });
    const designationId = ctx.designations.get(designation.toLowerCase()) ?? null;
    if (!designation) errors.push({
        row,
        field: 'designation',
        message: 'Designation is required'
    });
    else if (!designationId && !ctx.createMissingMasters) errors.push({
        row,
        field: 'designation',
        message: `Unknown designation "${designation}"`
    });
    const branchId = branch ? ctx.branches.get(branch.toLowerCase()) ?? null : null;
    if (branch && !branchId && !ctx.createMissingMasters) errors.push({
        row,
        field: 'branch',
        message: `Unknown branch "${branch}"`
    });
    const employmentType = TYPE_MAP[typeRaw];
    if (!employmentType) errors.push({
        row,
        field: 'employment_type',
        message: 'Employment type must be Full-time, Intern or Contract'
    });
    const workMode = MODE_MAP[modeRaw];
    if (!workMode) errors.push({
        row,
        field: 'work_mode',
        message: 'Work mode must be Office, Remote or Hybrid'
    });
    const joiningDate = parseFlexibleDate(g('joining_date'));
    if (!joiningDate) errors.push({
        row,
        field: 'joining_date',
        message: 'Joining date must be YYYY-MM-DD or DD-MM-YYYY'
    });
    else if (daysBetween(joiningDate, ctx.today) > 365) errors.push({
        row,
        field: 'joining_date',
        message: 'Joining date is more than a year ago'
    });
    let managerId = null;
    if (managerEmail) {
        managerId = ctx.managersByEmail.get(managerEmail) ?? null;
        if (!managerId && !fileEmails.has(managerEmail)) errors.push({
            row,
            field: 'manager_email',
            message: `Manager ${managerEmail} not found`
        });
        if (managerEmail === officialEmail) errors.push({
            row,
            field: 'manager_email',
            message: 'An employee cannot report to themselves'
        });
    }
    if (errors.length) return {
        ok: false,
        errors
    };
    return {
        ok: true,
        errors,
        value: {
            row,
            fullName,
            officialEmail,
            personalEmail,
            phone,
            department,
            departmentId,
            designation,
            designationId,
            managerEmail,
            managerId,
            employmentType: employmentType,
            workMode: workMode,
            joiningDate: joiningDate,
            branch,
            branchId
        }
    };
}
function validateCsvRows(rows, ctx) {
    const fileEmails = new Set(rows.map((r)=>(r.official_email ?? '').trim().toLowerCase()).filter(Boolean));
    const seen = new Set();
    const valid = [];
    const errors = [];
    rows.forEach((raw, i)=>{
        const row = i + 1;
        const email = (raw.official_email ?? '').trim().toLowerCase();
        if (email && seen.has(email)) {
            errors.push({
                row,
                field: 'official_email',
                message: `${email} appears more than once in the file`
            });
            return;
        }
        seen.add(email);
        const r = validateCsvRow(raw, row, ctx, fileEmails);
        if (r.ok && r.value) valid.push(r.value);
        else errors.push(...r.errors);
    });
    // Rows whose manager is another row that failed validation cannot be resolved.
    const validEmails = new Set(valid.map((v)=>v.officialEmail));
    const final = [];
    for (const v of valid){
        if (v.managerEmail && !v.managerId && !validEmails.has(v.managerEmail)) {
            errors.push({
                row: v.row,
                field: 'manager_email',
                message: `Manager ${v.managerEmail} is not valid in this file`
            });
        } else final.push(v);
    }
    errors.sort((a, b)=>a.row - b.row);
    return {
        valid: final,
        errors
    };
}
function orderByManager(rows) {
    const byEmail = new Map(rows.map((r)=>[
            r.officialEmail,
            r
        ]));
    const out = [];
    const done = new Set();
    const visit = (r, depth = 0)=>{
        if (done.has(r.officialEmail) || depth > 50) return;
        if (r.managerEmail && !r.managerId && byEmail.has(r.managerEmail)) visit(byEmail.get(r.managerEmail), depth + 1);
        if (!done.has(r.officialEmail)) {
            done.add(r.officialEmail);
            out.push(r);
        }
    };
    rows.forEach((r)=>visit(r));
    return out;
}
function csvEscape(v) {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
const OB_KEYS = [
    'offer',
    'nda',
    'docs',
    'bank',
    'kit'
];
let OnboardingRuleError = class OnboardingRuleError extends Error {
    code;
    details;
    constructor(code, message, details){
        super(message), this.code = code, this.details = details;
    }
};
function incompleteSteps(steps, upTo = [
    'offer',
    'nda',
    'docs',
    'bank'
]) {
    return upTo.filter((k)=>steps[k] !== 'DONE' && steps[k] !== 'SKIPPED');
}
function currentStep(steps) {
    return OB_KEYS.find((k)=>steps[k] === 'NEEDS_ATTENTION') ?? OB_KEYS.find((k)=>steps[k] !== 'DONE' && steps[k] !== 'SKIPPED') ?? null;
}
function applyOnboardingEvent(status, steps, ev) {
    const next = {
        ...steps
    };
    if (status === 'CANCELLED') throw new OnboardingRuleError('ONBOARDING_CANCELLED', 'This onboarding was cancelled');
    switch(ev.type){
        case 'STEP_DONE':
            {
                if (status === 'COMPLETED') throw new OnboardingRuleError('ONBOARDING_COMPLETED', 'Onboarding is already complete');
                if (status === 'SUBMITTED' && steps[ev.key] !== 'NEEDS_ATTENTION') {
                    throw new OnboardingRuleError('ONBOARDING_SUBMITTED', 'Onboarding is submitted; HR must reopen a step before you can change it');
                }
                if (ev.key === 'kit' && steps.kit !== 'NEEDS_ATTENTION') {
                    throw new OnboardingRuleError('USE_FINISH', 'Confirm your T-shirt size with “Finish onboarding”');
                }
                if ((ev.key === 'nda' || ev.key === 'docs' || ev.key === 'bank') && steps.offer !== 'DONE' && steps.offer !== 'SKIPPED') {
                    throw new OnboardingRuleError('OFFER_FIRST', 'Sign the offer letter first');
                }
                next[ev.key] = 'DONE';
                // A joiner fixing a step after submission goes straight back to SUBMITTED once nothing is open.
                const resubmitted = next.kit === 'DONE' && !incompleteSteps(next).length && !OB_KEYS.some((k)=>next[k] === 'NEEDS_ATTENTION');
                return {
                    status: resubmitted ? 'SUBMITTED' : 'IN_PROGRESS',
                    steps: next
                };
            }
        case 'FINISH':
            {
                if (status === 'SUBMITTED' || status === 'COMPLETED') throw new OnboardingRuleError('ALREADY_SUBMITTED', 'Onboarding is already submitted');
                const missing = incompleteSteps(next);
                if (missing.length) throw new OnboardingRuleError('STEPS_INCOMPLETE', 'Finish the earlier steps first', missing);
                next.kit = 'DONE';
                return {
                    status: 'SUBMITTED',
                    steps: next
                };
            }
        case 'DOC_REJECTED':
            {
                next.docs = 'NEEDS_ATTENTION';
                return {
                    status: status === 'NOT_STARTED' ? 'NOT_STARTED' : 'IN_PROGRESS',
                    steps: next
                };
            }
        case 'REOPEN':
            {
                next[ev.key] = 'NEEDS_ATTENTION';
                return {
                    status: 'IN_PROGRESS',
                    steps: next
                };
            }
        case 'ALL_VERIFIED':
            {
                if (status !== 'SUBMITTED') return {
                    status,
                    steps: next
                };
                return {
                    status: 'COMPLETED',
                    steps: next
                };
            }
        case 'OVERRIDE':
            {
                for (const k of OB_KEYS)if (next[k] !== 'DONE') next[k] = 'SKIPPED';
                return {
                    status: 'COMPLETED',
                    steps: next
                };
            }
        case 'CANCEL':
            return {
                status: 'CANCELLED',
                steps: next
            };
    }
}
function defaultNoticeDays(type, joiningDate, today) {
    if (type === 'INTERN') return 7;
    if (type === 'CONTRACT') return 15;
    if (joiningDate && daysBetween(joiningDate, today) < 183) return 15; // on probation
    return 30;
}
function computeLwd(resignationDate, noticeDays, chosenLwd) {
    const def = addDays(resignationDate, noticeDays - 1);
    if (!chosenLwd) return {
        lastWorkingDay: def,
        shortfallDays: 0
    };
    if (chosenLwd < resignationDate) throw new Error('Last working day cannot be before the resignation date');
    return {
        lastWorkingDay: chosenLwd,
        shortfallDays: Math.max(0, daysBetween(chosenLwd, def))
    };
}
const EXIT_CHECKLIST = [
    {
        key: 'ASSET_RETURN',
        label: 'Return company assets',
        ownerRole: 'HR / IT',
        blocking: true,
        auto: true
    },
    {
        key: 'IDCARD_SURRENDER',
        label: 'Surrender ID card',
        ownerRole: 'HR',
        blocking: true,
        auto: false
    },
    {
        key: 'KT_HANDOVER',
        label: 'Knowledge transfer & handover',
        ownerRole: 'Manager',
        blocking: true,
        auto: false
    },
    {
        key: 'ACCESS_REVOKE',
        label: 'Revoke system access',
        ownerRole: 'IT',
        blocking: false,
        auto: true
    },
    {
        key: 'FNF_SETTLEMENT',
        label: 'Full & final settlement',
        ownerRole: 'Payroll',
        blocking: false,
        auto: false
    },
    {
        key: 'RELIEVING_LETTER',
        label: 'Relieving letter issued',
        ownerRole: 'HR',
        blocking: false,
        auto: false
    },
    {
        key: 'EXIT_INTERVIEW',
        label: 'Exit interview (optional)',
        ownerRole: 'HR',
        blocking: false,
        auto: false
    }
];
function exitBlockers(items, assignedAssets) {
    const out = [];
    for (const i of items){
        if (!i.blocking) continue;
        if (i.key === 'ASSET_RETURN') {
            if (assignedAssets > 0) out.push(`${assignedAssets} asset${assignedAssets === 1 ? '' : 's'} not returned`);
        } else if (i.status === 'PENDING') out.push(EXIT_CHECKLIST.find((e)=>e.key === i.key)?.label ?? i.key);
    }
    return out;
}
function employeeStatusLabel(status, type) {
    if (status === 'ONBOARDING') return 'Onboarding';
    if (status === 'NOTICE_PERIOD') return 'Notice period';
    if (status === 'EXITED') return 'Exited';
    return type === 'INTERN' ? 'Intern' : 'Active';
}
function templateWeightsValid(weights) {
    if (!weights.length) return false;
    const sum = weights.reduce((a, b)=>a + b, 0);
    return Math.abs(sum - 100) <= 0.01;
}
function weightedScore(items) {
    if (!items.length || items.some((i)=>i.rating === null || i.rating === undefined)) return null;
    const w = items.reduce((a, i)=>a + i.weight, 0);
    if (w <= 0) return null;
    const s = items.reduce((a, i)=>a + i.weight * i.rating, 0) / w;
    return Math.round(s * 100) / 100;
}
function bandFor(score) {
    if (score === null || score === undefined) return null;
    if (score >= 4.5) return 'Outstanding';
    if (score >= 3.5) return 'Exceeds expectations';
    if (score >= 2.5) return 'Meets expectations';
    if (score >= 1.5) return 'Needs improvement';
    return 'Unsatisfactory';
}
function pct(part, whole) {
    return whole ? Math.round(100 * part / whole) : 0;
}
function suggestCycleName(d) {
    const [y, m] = d.split('-').map(Number);
    const fyStart = m >= 4 ? y : y - 1;
    const fy = `FY${String(fyStart % 100).padStart(2, '0')}-${String((fyStart + 1) % 100).padStart(2, '0')}`;
    if (m >= 4 && m <= 9) return {
        name: `H1 ${fy}`,
        from: `${fyStart}-04-01`,
        to: `${fyStart}-09-30`
    };
    return {
        name: `H2 ${fy}`,
        from: `${fyStart}-10-01`,
        to: `${fyStart + 1}-03-31`
    };
}
function eligibleForCycle(e, cyc) {
    if (e.status !== 'ACTIVE') return false;
    if (!cyc.types.includes(e.employmentType)) return false;
    if (!e.joiningDate) return false;
    return e.joiningDate <= addDays(cyc.periodTo, -cyc.minTenureDays);
}
const CYCLE_FLOW = {
    DRAFT: 'SELF_REVIEW',
    SELF_REVIEW: 'MANAGER_REVIEW',
    MANAGER_REVIEW: 'CALIBRATION',
    CALIBRATION: 'CLOSED',
    CLOSED: null
};
function resultFromRecommendation(rec) {
    if (rec === 'STRONG_HIRE' || rec === 'HIRE') return 'SELECTED';
    if (rec === 'NO_HIRE' || rec === 'STRONG_NO_HIRE') return 'REJECTED';
    return 'PENDING';
}
function suggestResult(recs) {
    const r = recs.map(resultFromRecommendation).filter((x)=>x !== 'PENDING');
    if (!r.length) return null;
    const sel = r.filter((x)=>x === 'SELECTED').length;
    const rej = r.length - sel;
    return sel > rej ? 'SELECTED' : rej > sel ? 'REJECTED' : 'ON_HOLD';
}
function applicationScore(overalls) {
    const v = overalls.filter((x)=>typeof x === 'number');
    if (!v.length) return null;
    return Math.round(v.reduce((a, b)=>a + b, 0) / v.length * 10) / 10;
}
function overallFromRatings(ratings) {
    const v = ratings.filter((x)=>typeof x === 'number');
    if (!v.length) return null;
    return Math.round(v.reduce((a, b)=>a + b, 0) / v.length * 2 * 10) / 10;
}
const STAGE_TRANSITIONS = {
    SCREENING: [
        'INTERVIEW',
        'OFFERED',
        'REJECTED',
        'WITHDRAWN'
    ],
    INTERVIEW: [
        'SCREENING',
        'OFFERED',
        'REJECTED',
        'WITHDRAWN'
    ],
    OFFERED: [
        'HIRED',
        'OFFER_DECLINED',
        'REJECTED',
        'WITHDRAWN',
        'INTERVIEW'
    ],
    HIRED: [],
    REJECTED: [
        'SCREENING'
    ],
    OFFER_DECLINED: [
        'SCREENING'
    ],
    WITHDRAWN: [
        'SCREENING'
    ]
};
function canMoveStage(from, to) {
    return (STAGE_TRANSITIONS[from] ?? []).includes(to);
}
function icsDate(d) {
    return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}
function icsLocal(d) {
    // Wall-clock time in Asia/Kolkata (UTC+05:30, no DST).
    const ist = new Date(d.getTime() + 330 * 60_000);
    return ist.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, '');
}
const icsText = (s)=>s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
function buildIcs(i) {
    const end = new Date(i.start.getTime() + i.durationMin * 60_000);
    const lines = [
        'BEGIN:VCALENDAR',
        'PRODID:-//Lexisora HRMS//Interviews//EN',
        'VERSION:2.0',
        'CALSCALE:GREGORIAN',
        `METHOD:${i.method}`,
        'BEGIN:VTIMEZONE',
        'TZID:Asia/Kolkata',
        'BEGIN:STANDARD',
        'DTSTART:19700101T000000',
        'TZOFFSETFROM:+0530',
        'TZOFFSETTO:+0530',
        'TZNAME:IST',
        'END:STANDARD',
        'END:VTIMEZONE',
        'BEGIN:VEVENT',
        `UID:${i.uid}`,
        `SEQUENCE:${i.sequence}`,
        `DTSTAMP:${icsDate(i.now ?? new Date())}`,
        `DTSTART;TZID=Asia/Kolkata:${icsLocal(i.start)}`,
        `DTEND;TZID=Asia/Kolkata:${icsLocal(end)}`,
        `SUMMARY:${icsText(i.summary)}`,
        ...i.description ? [
            `DESCRIPTION:${icsText(i.description)}`
        ] : [],
        ...i.location ? [
            `LOCATION:${icsText(i.location)}`
        ] : [],
        `ORGANIZER;CN=${icsText(i.organizer.name)}:mailto:${i.organizer.email}`,
        ...i.attendees.map((a)=>`ATTENDEE;CN=${icsText(a.name)};ROLE=REQ-PARTICIPANT;RSVP=TRUE:mailto:${a.email}`),
        `STATUS:${i.method === 'CANCEL' ? 'CANCELLED' : 'CONFIRMED'}`,
        'BEGIN:VALARM',
        'TRIGGER:-PT15M',
        'ACTION:DISPLAY',
        'DESCRIPTION:Interview reminder',
        'END:VALARM',
        'END:VEVENT',
        'END:VCALENDAR'
    ];
    return lines.join('\r\n') + '\r\n';
}
function istDateTime(date, time) {
    return new Date(`${date}T${time}:00+05:30`);
}
function warrantyThreshold(warrantyTill, today) {
    if (!warrantyTill) return null;
    const d = daysBetween(today, warrantyTill);
    if (d === 0) return 0;
    if (d > 0 && d <= 7) return 7;
    if (d > 7 && d <= 30) return 30;
    return null;
}
const ASSET_TRANSITIONS = {
    IN_STOCK: [
        'ASSIGNED',
        'UNDER_REPAIR',
        'RETIRED',
        'LOST'
    ],
    ASSIGNED: [
        'RETURNED',
        'UNDER_REPAIR',
        'LOST'
    ],
    RETURNED: [
        'IN_STOCK',
        'UNDER_REPAIR',
        'RETIRED',
        'LOST'
    ],
    UNDER_REPAIR: [
        'IN_STOCK',
        'ASSIGNED',
        'LOST'
    ],
    RETIRED: [
        'LOST'
    ],
    LOST: []
};
function canAssetMove(from, to) {
    return (ASSET_TRANSITIONS[from] ?? []).includes(to);
}
function kitStatus(lines) {
    const n = lines.filter((l)=>l.issued).length;
    if (!lines.length || n === 0) return 'PENDING';
    return n === lines.length ? 'ISSUED' : 'PARTIAL';
}
function stockKey(sizes, size) {
    return sizes.length ? size ?? '' : '_';
}
function idCardMissing(e, requireBloodGroup) {
    const m = [];
    if (!e.photoFileId) m.push('employee.photo');
    if (requireBloodGroup && !e.bloodGroup) m.push('employee.blood_group');
    if (!e.designation) m.push('employee.designation');
    if (!e.fullName) m.push('employee.full_name');
    return m;
}
const MISSING_LABELS = {
    'employee.photo': 'photo',
    'employee.blood_group': 'blood group',
    'employee.designation': 'designation',
    'employee.full_name': 'name'
};
function slugify(name) {
    return name.toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_]+/g, '-').replace(/-+/g, '-').slice(0, 40);
}
function buildVcf(c) {
    const parts = c.name.trim().split(/\s+/);
    const last = parts.length > 1 ? parts[parts.length - 1] : '';
    const first = parts.length > 1 ? parts.slice(0, -1).join(' ') : parts[0];
    const esc = (s)=>s.replace(/([,;\\])/g, '\\$1');
    const lines = [
        'BEGIN:VCARD',
        'VERSION:3.0',
        `FN:${esc(c.name)}`,
        `N:${esc(last ?? '')};${esc(first ?? '')};;;`,
        `ORG:${esc(c.org)}`,
        ...c.title ? [
            `TITLE:${esc(c.title)}`
        ] : [],
        `EMAIL;TYPE=WORK,INTERNET:${c.email}`,
        ...c.phone ? [
            `TEL;TYPE=WORK,CELL:${c.phone}`
        ] : [],
        ...c.url ? [
            `URL:${c.url}`
        ] : [],
        ...c.address ? [
            `ADR;TYPE=WORK:;;${esc(c.address)};;;;`
        ] : [],
        ...c.linkedin ? [
            `X-SOCIALPROFILE;TYPE=linkedin:${c.linkedin}`
        ] : [],
        'END:VCARD'
    ];
    return lines.join('\r\n') + '\r\n';
}
function whatsappLink(phone, text) {
    const digits = (phone ?? '').replace(/\D/g, '');
    const p = digits.length === 10 ? `91${digits}` : digits;
    return `https://wa.me/${p}?text=${encodeURIComponent(text)}`;
}
function initials(name) {
    return name.split(/\s+/).filter(Boolean).map((p)=>p[0].toUpperCase()).slice(0, 2).join('');
}
function splitCtc(annualPaise) {
    const monthly = Math.round(annualPaise / 12);
    let pf = 180_000;
    let gross = monthly - pf;
    if (Math.round(gross * 0.5 * 0.12) < pf) {
        // Low salaries: PF = 12% of basic where basic = 50% of gross → gross = monthly / 1.06
        gross = Math.round(monthly / 1.06);
        pf = monthly - gross;
    }
    const basic = Math.round(gross * 0.5);
    const hra = Math.round(gross * 0.25);
    const special = gross - basic - hra;
    const rows = [
        {
            code: 'BASIC',
            label: 'Basic',
            monthlyPaise: basic
        },
        {
            code: 'HRA',
            label: 'HRA',
            monthlyPaise: hra
        },
        {
            code: 'SPECIAL',
            label: 'Special allowance',
            monthlyPaise: special
        },
        {
            code: 'PF_ER',
            label: 'PF (employer)',
            monthlyPaise: pf
        }
    ];
    return rows.map((r)=>({
            ...r,
            annualPaise: r.monthlyPaise * 12
        }));
}
function namesMatch(a, b) {
    const norm = (s)=>s.toLowerCase().replace(/[^a-z\s]/g, '').split(/\s+/).filter((x)=>x.length > 1);
    const A = new Set(norm(a));
    const B = norm(b);
    if (!A.size || !B.length) return false;
    const hit = B.filter((x)=>A.has(x)).length;
    return hit / Math.max(A.size, B.length) >= 0.5;
}

//# sourceMappingURL=people.rules.js.map