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
    get DEFAULT_TEMPLATES () {
        return DEFAULT_TEMPLATES;
    },
    get OnboardingService () {
        return OnboardingService;
    }
});
const _common = require("@nestjs/common");
const _shared = require("@lexisora/shared");
const _auditservice = require("../../../core/audit/audit.service");
const _requestcontext = require("../../../core/context/request-context");
const _cryptoservice = require("../../../core/crypto/crypto.service");
const _errors = require("../../../core/http/errors");
const _notificationsservice = require("../../../core/notifications/notifications.service");
const _prismaservice = require("../../../core/prisma/prisma.service");
const _eventsservice = require("../../../core/registry/events.service");
const _settingsservice = require("../../../core/settings/settings.service");
const _compensation = require("../compensation");
const _esignservice = require("../documents/esign.service");
const _esignrender = require("../documents/esign-render");
const _vaultservice = require("../documents/vault.service");
const _idcardsservice = require("../idcards/idcards.service");
const _kitsservice = require("../kits/kits.service");
const _peoplerules = require("../people.rules");
const _peopleutil = require("../people.util");
function _ts_decorate(decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") {
        r = Reflect.decorate(decorators, target, key, desc);
    } else {
        for(var i = decorators.length - 1; i >= 0; i--){
            if (d = decorators[i]) {
                r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
            }
        }
    }
    return c > 3 && r && Object.defineProperty(target, key, r), r;
}
function _ts_metadata(metadataKey, metadataValue) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") {
        return Reflect.metadata(metadataKey, metadataValue);
    }
}
const TEMPLATES_KEY = 'people.onboarding.templates';
const VERIFY_TYPES = [
    'PAN',
    'AADHAAR',
    'MARKSHEET_10',
    'MARKSHEET_12',
    'DEGREE',
    'PREV_EMPLOYMENT',
    'CANCELLED_CHEQUE'
];
const DEFAULT_TEMPLATES = {
    offerBody: 'Dear {{firstName}},\n\nThis letter confirms your appointment at {{company}} as {{designation}} in the {{department}} team, with effect from {{joiningDate}}, with the compensation shown in Annexure A.\n\nYou will report to {{manager}} and work in {{workMode}} mode under the General shift. Your employment is governed by the company policies published on the HRMS, including the attendance, leave and information-security policies.\n\nPlease sign below to accept this offer. We look forward to working with you.',
    ndaBody: 'This Non-Disclosure Agreement is made between {{company}} and {{fullName}} ({{empCode}}).\n\nYou agree to keep client code, data and business information confidential during and after employment, to use it only for your work at {{company}}, and not to copy it to personal devices or accounts.\n\nOn leaving the company you will return or destroy all confidential material in your possession. This obligation survives the end of your employment.',
    signatoryName: 'Kavya Iyer',
    signatoryTitle: 'HR Manager'
};
const STATUS_LABEL = {
    NOT_STARTED: 'Not started',
    IN_PROGRESS: 'In progress',
    SUBMITTED: 'Submitted · verifying',
    COMPLETED: 'Completed',
    CANCELLED: 'Cancelled'
};
let OnboardingService = class OnboardingService {
    prisma;
    esign;
    vault;
    kits;
    idcards;
    crypto;
    settings;
    notify;
    audit;
    events;
    constructor(prisma, esign, vault, kits, idcards, crypto, settings, notify, audit, events){
        this.prisma = prisma;
        this.esign = esign;
        this.vault = vault;
        this.kits = kits;
        this.idcards = idcards;
        this.crypto = crypto;
        this.settings = settings;
        this.notify = notify;
        this.audit = audit;
        this.events = events;
    }
    // ── Templates ────────────────────────────────────────────────────────────
    templates() {
        return this.settings.get(TEMPLATES_KEY, DEFAULT_TEMPLATES);
    }
    async saveTemplates(t) {
        await this.settings.set(TEMPLATES_KEY, t);
        await this.audit.record({
            action: 'onboarding.templates_updated',
            entity: 'Setting',
            entityId: TEMPLATES_KEY
        });
        return this.templates();
    }
    // ── Creation ─────────────────────────────────────────────────────────────
    async createFor(employeeId) {
        const existing = await this.prisma.onboarding.findUnique({
            where: {
                employeeId
            }
        });
        if (existing) return existing;
        const tenantId = (0, _requestcontext.requireContext)().tenantId;
        const ob = await this.prisma.onboarding.create({
            data: {
                employeeId,
                status: 'NOT_STARTED',
                steps: {
                    create: _shared.ONBOARDING_STEP_KEYS.map((key, i)=>({
                            tenantId,
                            key,
                            order: i + 1,
                            status: 'PENDING'
                        }))
                }
            }
        });
        await this.audit.record({
            action: 'onboarding.created',
            entity: 'Onboarding',
            entityId: ob.id,
            meta: {
                employeeId
            }
        });
        return ob;
    }
    async load(employeeId) {
        return this.prisma.onboarding.findUnique({
            where: {
                employeeId
            },
            include: {
                steps: {
                    orderBy: {
                        order: 'asc'
                    }
                }
            }
        });
    }
    async mustLoad(employeeId) {
        const ob = await this.load(employeeId);
        if (!ob) throw (0, _errors.notFound)('Onboarding');
        return ob;
    }
    stepMap(ob) {
        const m = Object.fromEntries(_shared.ONBOARDING_STEP_KEYS.map((k)=>[
                k,
                'PENDING'
            ]));
        for (const s of ob.steps)m[s.key] = s.status;
        return m;
    }
    /** Apply a state-machine event and persist the changed statuses. */ async apply(ob, ev, stepPatch = {}) {
        let next;
        try {
            next = (0, _peoplerules.applyOnboardingEvent)(ob.status, this.stepMap(ob), ev);
        } catch (e) {
            if (e instanceof _peoplerules.OnboardingRuleError) throw new _errors.AppError(409, e.code, e.message, e.details);
            throw e;
        }
        const now = new Date();
        for (const s of ob.steps){
            const key = s.key;
            const patch = stepPatch[key];
            const newStatus = next.steps[key];
            if (newStatus === s.status && !patch) continue;
            await this.prisma.onboardingStep.update({
                where: {
                    id: s.id
                },
                data: {
                    status: newStatus,
                    completedAt: newStatus === 'DONE' ? s.completedAt ?? now : newStatus === 'NEEDS_ATTENTION' ? null : s.completedAt,
                    ...patch?.data !== undefined ? {
                        data: patch.data
                    } : {},
                    ...patch?.note !== undefined ? {
                        note: patch.note
                    } : newStatus === 'DONE' ? {
                        note: null
                    } : {},
                    ...patch?.envelopeId !== undefined ? {
                        esignEnvelopeId: patch.envelopeId
                    } : {}
                }
            });
        }
        await this.prisma.onboarding.update({
            where: {
                id: ob.id
            },
            data: {
                status: next.status,
                startedAt: ob.startedAt ?? (next.status !== 'NOT_STARTED' ? now : null),
                submittedAt: next.status === 'SUBMITTED' && ob.status !== 'SUBMITTED' ? now : ob.submittedAt,
                completedAt: next.status === 'COMPLETED' ? ob.completedAt ?? now : ob.completedAt
            }
        });
        return next;
    }
    // ── Documents (offer letter, NDA) ────────────────────────────────────────
    async docData(employeeId, kind) {
        const e = await this.prisma.employee.findUniqueOrThrow({
            where: {
                id: employeeId
            },
            include: {
                designation: true,
                department: true,
                manager: {
                    select: {
                        fullName: true
                    }
                }
            }
        });
        const t = await this.prisma.raw.tenant.findUniqueOrThrow({
            where: {
                id: (0, _requestcontext.requireContext)().tenantId
            }
        });
        const tpl = await this.templates();
        const fields = {
            firstName: e.firstName,
            fullName: e.fullName,
            empCode: e.empCode,
            company: t.name,
            designation: e.designation?.name ?? 'your role',
            department: e.department?.name ?? '',
            joiningDate: (0, _peopleutil.fmt)(e.joiningDate),
            manager: e.manager?.fullName ?? 'your reporting manager',
            workMode: e.workMode === 'OFFICE' ? 'office' : e.workMode === 'REMOTE' ? 'remote' : 'hybrid'
        };
        const body = (0, _esignrender.mergeFields)(kind === 'OFFER' ? tpl.offerBody : tpl.ndaBody, fields);
        let annexure = null;
        let annexureNote = null;
        if (kind === 'OFFER') {
            const comp = await (0, _compensation.loadCompensation)(this.prisma, this.crypto, employeeId);
            if (comp) annexure = comp.rows.map((r)=>({
                    component: r.component,
                    monthly: (0, _peopleutil.inrPdf)(r.monthlyPaise),
                    annual: (0, _peopleutil.inrPdf)(r.annualPaise),
                    isTotal: r.isTotal
                }));
            else annexureNote = 'Your compensation structure is being finalised by Payroll; HR will share Annexure A separately.';
        }
        return {
            kind,
            company: t.legalName ?? t.name,
            companyAddress: [
                t.address,
                t.city,
                t.stateName
            ].filter(Boolean).join(', ') || null,
            title: kind === 'OFFER' ? `Offer letter · ${e.designation?.name ?? e.fullName}` : 'Non-disclosure agreement',
            dateLabel: (0, _peopleutil.fmt)(new Date()),
            employee: {
                name: e.fullName,
                designation: e.designation?.name ?? null,
                department: e.department?.name ?? null,
                empCode: e.empCode,
                joiningDate: (0, _peopleutil.dbDateKey)(e.joiningDate),
                email: e.officialEmail
            },
            paragraphs: body.split(/\n\s*\n/).map((p)=>p.replace(/\n/g, ' ').trim()).filter(Boolean),
            annexure,
            annexureNote,
            signatory: {
                name: tpl.signatoryName,
                title: tpl.signatoryTitle
            }
        };
    }
    /** Make sure the offer / NDA envelopes exist for unsigned steps (regenerates when Annexure A became available). */ async ensureEnvelopes(ob) {
        const e = await this.prisma.employee.findUniqueOrThrow({
            where: {
                id: ob.employeeId
            },
            include: {
                user: true
            }
        });
        for (const [key, kind] of [
            [
                'offer',
                'OFFER'
            ],
            [
                'nda',
                'NDA'
            ]
        ]){
            const step = ob.steps.find((s)=>s.key === key);
            if (!step || step.status === 'DONE' || step.status === 'SKIPPED') continue;
            let env = step.esignEnvelopeId ? await this.prisma.esignEnvelope.findUnique({
                where: {
                    id: step.esignEnvelopeId
                }
            }) : null;
            const stale = env && kind === 'OFFER' && !env.docData.annexure && await (0, _compensation.loadCompensation)(this.prisma, this.crypto, ob.employeeId);
            if (env && ([
                'VOIDED',
                'EXPIRED',
                'DECLINED'
            ].includes(env.status) || stale)) {
                if (stale) await this.esign.voidEnvelope(env.id);
                env = null;
            }
            if (!env) {
                const doc = await this.docData(ob.employeeId, kind);
                env = await this.esign.create({
                    purpose: kind,
                    title: doc.title,
                    subjectEmployeeId: e.id,
                    doc,
                    signerName: e.fullName,
                    signerEmail: e.personalEmail ?? e.officialEmail,
                    signerUserId: e.userId
                });
                await this.prisma.onboardingStep.update({
                    where: {
                        id: step.id
                    },
                    data: {
                        esignEnvelopeId: env.id
                    }
                });
                step.esignEnvelopeId = env.id;
            }
        }
    }
    // ── Views ────────────────────────────────────────────────────────────────
    async dto(ob, employeeId) {
        const e = await this.prisma.employee.findUniqueOrThrow({
            where: {
                id: employeeId
            },
            include: {
                designation: true
            }
        });
        const documents = await this.vault.listFor(employeeId);
        const tpl = await this.templates();
        const offerDoc = {
            title: `Offer letter · ${e.designation?.name ?? ''}`.trim(),
            body: 'This letter confirms your appointment at Lexisora Infotech with the compensation shown in Annexure A.'
        };
        const t = await this.prisma.raw.tenant.findUnique({
            where: {
                id: (0, _requestcontext.requireContext)().tenantId
            }
        });
        offerDoc.body = offerDoc.body.replace('Lexisora Infotech', t?.name ?? 'the company');
        const ndaDoc = {
            title: 'Non-disclosure agreement',
            body: 'You agree to keep client code, data and business information confidential during and after employment.'
        };
        void tpl;
        if (!ob) {
            // Already-onboarded employee (G13): read-only summary.
            const has = (types)=>documents.some((d)=>types.includes(d.docType));
            const steps = _shared.ONBOARDING_STEP_KEYS.map((key, i)=>({
                    key,
                    order: i + 1,
                    label: _shared.ONBOARDING_STEP_LABELS[key],
                    status: 'DONE',
                    note: key === 'offer' && !has([
                        'OFFER_LETTER'
                    ]) ? 'Completed before paperless onboarding' : null,
                    completedAt: e.joiningDate?.toISOString() ?? null,
                    envelopeId: null,
                    data: key === 'bank' ? {
                        last4: e.bankAccountLast4,
                        ifsc: e.bankIfsc,
                        bank: e.bankName,
                        taxRegime: e.taxRegime
                    } : key === 'kit' ? {
                        tshirtSize: e.tshirtSize
                    } : null
                }));
            return {
                id: '',
                employeeId,
                employeeName: e.fullName,
                empCode: e.empCode,
                designation: e.designation?.name ?? null,
                joiningDate: (0, _peopleutil.dbDateKey)(e.joiningDate),
                status: 'COMPLETED',
                steps,
                currentStep: null,
                canFinish: false,
                incomplete: [],
                submittedAt: null,
                completedAt: e.joiningDate?.toISOString() ?? null,
                bankVerified: !!e.bankAccountLast4,
                documents,
                workMode: e.workMode,
                offerDoc,
                ndaDoc
            };
        }
        const m = this.stepMap(ob);
        return {
            id: ob.id,
            employeeId,
            employeeName: e.fullName,
            empCode: e.empCode,
            designation: e.designation?.name ?? null,
            joiningDate: (0, _peopleutil.dbDateKey)(e.joiningDate),
            status: ob.status,
            steps: ob.steps.map((s)=>({
                    key: s.key,
                    order: s.order,
                    label: _shared.ONBOARDING_STEP_LABELS[s.key],
                    status: s.status,
                    note: s.note,
                    completedAt: s.completedAt?.toISOString() ?? null,
                    envelopeId: s.esignEnvelopeId,
                    data: s.data ?? null
                })),
            currentStep: ob.status === 'SUBMITTED' || ob.status === 'COMPLETED' ? null : (0, _peoplerules.currentStep)(m),
            canFinish: (ob.status === 'NOT_STARTED' || ob.status === 'IN_PROGRESS') && (0, _peoplerules.incompleteSteps)(m).length === 0,
            incomplete: (0, _peoplerules.incompleteSteps)(m),
            submittedAt: ob.submittedAt?.toISOString() ?? null,
            completedAt: ob.completedAt?.toISOString() ?? null,
            bankVerified: !!ob.bankVerifiedAt,
            documents,
            workMode: e.workMode,
            offerDoc,
            ndaDoc
        };
    }
    myId() {
        const me = (0, _requestcontext.requireContext)().employeeId;
        if (!me) throw new _errors.AppError(400, 'NO_EMPLOYEE', 'Your account is not linked to an employee record');
        return me;
    }
    async mine() {
        const me = this.myId();
        const ob = await this.load(me);
        if (ob && ob.status !== 'COMPLETED' && ob.status !== 'CANCELLED') await this.ensureEnvelopes(ob);
        return this.dto(ob ? await this.load(me) : null, me);
    }
    async detail(employeeId) {
        const ob = await this.load(employeeId);
        const e = await this.prisma.employee.findUniqueOrThrow({
            where: {
                id: employeeId
            }
        });
        const bankStep = ob?.steps.find((s)=>s.key === 'bank');
        return {
            ...await this.dto(ob, employeeId),
            bank: {
                holder: bankStep?.data?.holderName ?? null,
                account: (0, _peoplerules.maskAccount)(e.bankAccountLast4),
                ifsc: e.bankIfsc,
                bank: e.bankName,
                taxRegime: e.taxRegime,
                uan: e.uan,
                pan: (0, _peoplerules.maskPan)(this.crypto.decrypt(e.panEnc))
            }
        };
    }
    // ── Joiner actions ───────────────────────────────────────────────────────
    async joinerOb() {
        const me = this.myId();
        const ob = await this.load(me);
        if (!ob) throw new _errors.AppError(409, 'ONBOARDING_COMPLETED', 'Your onboarding is already complete');
        return ob;
    }
    async sign(key, input, ua) {
        const ob = await this.joinerOb();
        await this.ensureEnvelopes(ob);
        const fresh = await this.mustLoad(ob.employeeId);
        const step = fresh.steps.find((s)=>s.key === key);
        if (key === 'nda' && this.stepMap(fresh).offer !== 'DONE') throw new _errors.AppError(409, 'OFFER_FIRST', 'Sign the offer letter first');
        if (step.status === 'DONE') return this.mine();
        if (!step.esignEnvelopeId) throw new _errors.AppError(409, 'DOC_NOT_READY', 'Your document is being prepared. Try again in a minute.');
        const { envelope } = await this.esign.sign(step.esignEnvelopeId, input, ua);
        await this.vault.add(ob.employeeId, {
            docType: key === 'offer' ? 'OFFER_LETTER' : 'NDA',
            fileId: envelope.signedFileId,
            title: key === 'offer' ? 'Offer letter' : 'NDA',
            source: 'ESIGNED',
            verificationStatus: 'NOT_REQUIRED',
            esignEnvelopeId: envelope.id
        });
        await this.apply(fresh, {
            type: 'STEP_DONE',
            key
        }, {
            [key]: {
                data: {
                    signedAt: envelope.signedAt?.toISOString() ?? null,
                    signedSha256: envelope.signedSha256
                }
            }
        });
        if (key === 'offer') await this.prisma.jobOffer.updateMany({
            where: {
                employeeId: ob.employeeId,
                status: {
                    in: [
                        'DRAFT',
                        'ISSUED'
                    ]
                }
            },
            data: {
                status: 'ACCEPTED'
            }
        });
        await this.audit.record({
            action: 'onboarding.step_completed',
            entity: 'Onboarding',
            entityId: fresh.id,
            meta: {
                step: key
            }
        });
        return this.mine();
    }
    async declineOffer(reason) {
        const ob = await this.joinerOb();
        const step = ob.steps.find((s)=>s.key === 'offer');
        if (step?.status === 'DONE') throw new _errors.AppError(409, 'ALREADY_SIGNED', 'You have already accepted the offer');
        if (step?.esignEnvelopeId) await this.esign.decline(step.esignEnvelopeId, reason);
        await this.prisma.onboarding.update({
            where: {
                id: ob.id
            },
            data: {
                declinedReason: reason
            }
        });
        await this.prisma.jobOffer.updateMany({
            where: {
                employeeId: ob.employeeId
            },
            data: {
                status: 'DECLINED'
            }
        });
        const e = await this.prisma.employee.findUniqueOrThrow({
            where: {
                id: ob.employeeId
            }
        });
        await this.notify.notify({
            userIds: await this.notify.usersWithPermission('onboarding.manage'),
            type: 'people.offerDeclined',
            title: `${e.fullName} declined the offer`,
            body: reason,
            link: `/onboarding?employee=${e.id}`,
            from: 'System',
            email: true
        });
        await this.audit.record({
            action: 'onboarding.offer_declined',
            entity: 'Onboarding',
            entityId: ob.id,
            meta: {
                reason
            }
        });
        return {
            ok: true
        };
    }
    async submitDocs(i) {
        const ob = await this.joinerOb();
        if (!(0, _peoplerules.isValidPan)(i.panNumber)) throw new _errors.AppError(422, 'PAN_INVALID', 'Enter a valid PAN (5 letters, 4 digits, 1 letter; 4th letter P)');
        if (!(0, _peoplerules.isValidAadhaar)(i.aadhaarNumber)) throw new _errors.AppError(422, 'AADHAAR_INVALID', 'Enter a valid 12-digit Aadhaar number');
        const m = this.stepMap(ob);
        if (m.offer !== 'DONE' && m.offer !== 'SKIPPED') throw new _errors.AppError(409, 'OFFER_FIRST', 'Sign the offer letter first');
        const empId = ob.employeeId;
        const docIds = [];
        docIds.push((await this.vault.add(empId, {
            docType: 'PAN',
            fileId: i.panFileId,
            source: 'SELF_UPLOAD'
        })).id);
        docIds.push((await this.vault.add(empId, {
            docType: 'AADHAAR',
            fileId: i.aadhaarFileId,
            source: 'SELF_UPLOAD'
        })).id);
        for (const [n, f] of i.marksheetFileIds.entries()){
            docIds.push((await this.vault.add(empId, {
                docType: 'DEGREE',
                fileId: f,
                title: i.marksheetFileIds.length === 1 ? 'Education marksheets' : `Education marksheet ${n + 1}`,
                source: 'SELF_UPLOAD'
            })).id);
        }
        if (i.prevEmploymentFileId) docIds.push((await this.vault.add(empId, {
            docType: 'PREV_EMPLOYMENT',
            fileId: i.prevEmploymentFileId,
            source: 'SELF_UPLOAD'
        })).id);
        await this.prisma.employee.update({
            where: {
                id: empId
            },
            data: {
                panEnc: this.crypto.encrypt(i.panNumber),
                aadhaarEnc: this.crypto.encrypt(i.aadhaarNumber),
                aadhaarLast4: i.aadhaarNumber.slice(-4)
            }
        });
        await this.apply(ob, {
            type: 'STEP_DONE',
            key: 'docs'
        }, {
            docs: {
                data: {
                    pan: (0, _peoplerules.maskPan)(i.panNumber),
                    aadhaarLast4: i.aadhaarNumber.slice(-4),
                    documentIds: docIds
                }
            }
        });
        await this.audit.record({
            action: 'statutory.updated',
            entity: 'Employee',
            entityId: empId,
            meta: {
                pan: (0, _peoplerules.maskPan)(i.panNumber)
            }
        });
        return this.mine();
    }
    async submitBank(i) {
        const ob = await this.joinerOb();
        const err = (0, _peoplerules.validateBank)(i);
        if (err) throw new _errors.AppError(422, 'BANK_INVALID', err);
        const e = await this.prisma.employee.findUniqueOrThrow({
            where: {
                id: ob.employeeId
            }
        });
        const bank = (0, _peoplerules.lookupIfsc)(i.ifsc);
        if (i.chequeFileId) await this.vault.add(e.id, {
            docType: 'CANCELLED_CHEQUE',
            fileId: i.chequeFileId,
            source: 'SELF_UPLOAD'
        });
        await this.prisma.employee.update({
            where: {
                id: e.id
            },
            data: {
                bankAccountEnc: this.crypto.encrypt(i.accountNumber),
                bankAccountLast4: i.accountNumber.slice(-4),
                bankIfsc: i.ifsc,
                bankName: bank?.bank ?? null,
                taxRegime: i.taxRegime,
                uan: i.uan || e.uan
            }
        });
        await this.prisma.onboarding.update({
            where: {
                id: ob.id
            },
            data: {
                bankVerifiedAt: null,
                bankVerifiedBy: null
            }
        });
        const mismatch = !(0, _peoplerules.namesMatch)(e.fullName, i.holderName);
        await this.apply(ob, {
            type: 'STEP_DONE',
            key: 'bank'
        }, {
            bank: {
                data: {
                    holderName: i.holderName,
                    last4: i.accountNumber.slice(-4),
                    ifsc: i.ifsc,
                    bank: bank?.bank ?? null,
                    branch: bank?.branch ?? null,
                    taxRegime: i.taxRegime,
                    nameMismatch: mismatch
                }
            }
        });
        await this.audit.record({
            action: 'bank_account.submitted',
            entity: 'Employee',
            entityId: e.id,
            meta: {
                account: (0, _peoplerules.maskAccount)(i.accountNumber.slice(-4)),
                ifsc: i.ifsc
            }
        });
        return this.mine();
    }
    /** Step 5: T-shirt size → Finish. HR notified, `onboarding.completed` emitted, ID card queued. */ async finish(i) {
        const ob = await this.joinerOb();
        const e = await this.prisma.employee.findUniqueOrThrow({
            where: {
                id: ob.employeeId
            }
        });
        const kitData = {
            tshirtSize: i.tshirtSize,
            delivery: i.delivery,
            address: i.address ?? null
        };
        const fixingKit = this.stepMap(ob).kit === 'NEEDS_ATTENTION';
        await this.apply(ob, fixingKit ? {
            type: 'STEP_DONE',
            key: 'kit'
        } : {
            type: 'FINISH'
        }, {
            kit: {
                data: kitData
            }
        });
        await this.prisma.employee.update({
            where: {
                id: e.id
            },
            data: {
                tshirtSize: i.tshirtSize
            }
        });
        await this.kits.setSize(e.id, i.tshirtSize, i.delivery);
        await this.idcards.ensureCard(e.id);
        await this.idcards.refresh(e.id);
        if (!fixingKit) {
            await this.notify.notify({
                userIds: await this.notify.usersWithPermission('onboarding.manage'),
                type: 'people.onboardingSubmitted',
                title: `${e.fullName} completed onboarding`,
                body: `${e.empCode} · verify documents and bank details. ID card queued, T-shirt size ${i.tshirtSize}.`,
                link: `/onboarding?employee=${e.id}`,
                from: 'System',
                email: true
            });
            await this.notify.notify({
                userIds: await this.notify.usersForEmployees([
                    e.managerId
                ]),
                type: 'people.onboardingSubmitted',
                title: `${e.fullName} completed onboarding`,
                link: `/employees/${e.id}`,
                from: 'HR'
            });
            await this.audit.record({
                action: 'onboarding.submitted',
                entity: 'Onboarding',
                entityId: ob.id,
                meta: {
                    tshirtSize: i.tshirtSize
                }
            });
            this.events.emit('onboarding.completed', {
                employeeId: e.id
            });
        }
        await this.maybeComplete(e.id);
        return this.mine();
    }
    // ── HR ───────────────────────────────────────────────────────────────────
    async list(status) {
        const obs = await this.prisma.onboarding.findMany({
            where: status ? {
                status: status
            } : {
                status: {
                    not: 'CANCELLED'
                }
            },
            include: {
                steps: true
            }
        });
        const emps = await this.prisma.employee.findMany({
            where: {
                id: {
                    in: obs.map((o)=>o.employeeId)
                }
            },
            select: {
                id: true,
                fullName: true,
                empCode: true,
                joiningDate: true,
                bankAccountLast4: true,
                status: true
            }
        });
        const em = new Map(emps.map((e)=>[
                e.id,
                e
            ]));
        const pending = await this.prisma.employeeDocument.groupBy({
            by: [
                'employeeId'
            ],
            where: {
                employeeId: {
                    in: obs.map((o)=>o.employeeId)
                },
                verificationStatus: 'PENDING',
                deletedAt: null,
                isCurrent: true
            },
            _count: {
                _all: true
            }
        });
        const pm = new Map(pending.map((p)=>[
                p.employeeId,
                p._count._all
            ]));
        return obs.filter((o)=>em.has(o.employeeId)).map((o)=>{
            const e = em.get(o.employeeId);
            return {
                employeeId: e.id,
                name: e.fullName,
                empCode: e.empCode,
                joiningDate: (0, _peopleutil.dbDateKey)(e.joiningDate),
                stepsDone: o.steps.filter((s)=>s.status === 'DONE' || s.status === 'SKIPPED').length,
                docsPending: pm.get(e.id) ?? 0,
                bank: o.bankVerifiedAt ? 'Verified' : e.bankAccountLast4 ? 'Pending verification' : 'Not added',
                status: o.status,
                statusLabel: STATUS_LABEL[o.status] ?? o.status
            };
        }).sort((a, b)=>(b.joiningDate ?? '').localeCompare(a.joiningDate ?? ''));
    }
    async reopen(employeeId, key, reason) {
        const ob = await this.mustLoad(employeeId);
        if (ob.status === 'COMPLETED') throw new _errors.AppError(409, 'ONBOARDING_COMPLETED', 'Onboarding is complete; update the profile instead');
        await this.apply(ob, {
            type: 'REOPEN',
            key
        }, {
            [key]: {
                note: reason
            }
        });
        if (key === 'offer' || key === 'nda') {
            const step = ob.steps.find((s)=>s.key === key);
            if (step?.esignEnvelopeId) await this.prisma.onboardingStep.update({
                where: {
                    id: step.id
                },
                data: {
                    esignEnvelopeId: null
                }
            });
        }
        await this.notify.notify({
            userIds: await this.notify.usersForEmployees([
                employeeId
            ]),
            type: 'people.onboardingReopened',
            title: `HR reopened “${_shared.ONBOARDING_STEP_LABELS[key]}” in your onboarding`,
            body: reason,
            link: '/onboarding',
            from: 'HR',
            email: true
        });
        await this.audit.record({
            action: 'onboarding.reopened',
            entity: 'Onboarding',
            entityId: ob.id,
            meta: {
                step: key,
                reason
            }
        });
        return this.detail(employeeId);
    }
    async override(employeeId, reason) {
        const ob = await this.mustLoad(employeeId);
        await this.apply(ob, {
            type: 'OVERRIDE'
        });
        await this.prisma.onboarding.update({
            where: {
                id: ob.id
            },
            data: {
                overrideReason: reason
            }
        });
        await this.audit.record({
            action: 'onboarding.override',
            entity: 'Onboarding',
            entityId: ob.id,
            meta: {
                reason
            }
        });
        return this.detail(employeeId);
    }
    async verifyBank(employeeId, decision, reason) {
        const ctx = (0, _requestcontext.requireContext)();
        const ob = await this.mustLoad(employeeId);
        const e = await this.prisma.employee.findUniqueOrThrow({
            where: {
                id: employeeId
            }
        });
        if (!e.bankAccountLast4) throw (0, _errors.badRequest)('No bank details submitted yet', 'NO_BANK');
        if (decision === 'VERIFIED') {
            await this.prisma.onboarding.update({
                where: {
                    id: ob.id
                },
                data: {
                    bankVerifiedAt: new Date(),
                    bankVerifiedBy: ctx.userName ?? null
                }
            });
            await this.audit.record({
                action: 'bank_account.verified',
                entity: 'Employee',
                entityId: employeeId
            });
            await this.maybeComplete(employeeId);
        } else {
            if (!reason?.trim()) throw (0, _errors.badRequest)('Give a reason', 'REASON_REQUIRED');
            await this.reopen(employeeId, 'bank', reason);
            await this.audit.record({
                action: 'bank_account.rejected',
                entity: 'Employee',
                entityId: employeeId,
                meta: {
                    reason
                }
            });
        }
        return this.detail(employeeId);
    }
    /** Called after HR verifies/rejects a document. */ async afterDocDecision(employeeId, decision, title, reason) {
        const ob = await this.load(employeeId);
        if (!ob || ob.status === 'COMPLETED' || ob.status === 'CANCELLED') return;
        if (decision === 'REJECTED') {
            await this.apply(ob, {
                type: 'DOC_REJECTED'
            }, {
                docs: {
                    note: `${title ?? 'A document'} was rejected: ${reason ?? ''}`.trim()
                }
            });
        } else await this.maybeComplete(employeeId);
    }
    /** SUBMITTED → COMPLETED once every required document and the bank account are verified. */ async maybeComplete(employeeId) {
        const ob = await this.load(employeeId);
        if (!ob || ob.status !== 'SUBMITTED' || !ob.bankVerifiedAt) return false;
        const open = await this.prisma.employeeDocument.count({
            where: {
                employeeId,
                docType: {
                    in: [
                        ...VERIFY_TYPES
                    ]
                },
                isCurrent: true,
                deletedAt: null,
                verificationStatus: {
                    in: [
                        'PENDING',
                        'REJECTED'
                    ]
                }
            }
        });
        if (open) return false;
        await this.apply(ob, {
            type: 'ALL_VERIFIED'
        });
        await this.notify.notify({
            userIds: await this.notify.usersForEmployees([
                employeeId
            ]),
            type: 'people.onboardingCompleted',
            title: 'Your onboarding is complete',
            body: 'HR has verified your documents and bank details.',
            link: '/onboarding',
            from: 'HR'
        });
        await this.audit.record({
            action: 'onboarding.completed',
            entity: 'Onboarding',
            entityId: ob.id
        });
        return true;
    }
    async cancel(employeeId) {
        const ob = await this.load(employeeId);
        if (!ob) return;
        await this.apply(ob, {
            type: 'CANCEL'
        });
    }
    /** Reminder job: joiners starting within 7 days with steps still open. */ async remind() {
        const obs = await this.prisma.onboarding.findMany({
            where: {
                status: {
                    in: [
                        'NOT_STARTED',
                        'IN_PROGRESS'
                    ]
                }
            },
            include: {
                steps: true
            }
        });
        let sent = 0;
        for (const o of obs){
            const e = await this.prisma.employee.findUnique({
                where: {
                    id: o.employeeId
                }
            });
            if (!e?.joiningDate) continue;
            const days = Math.round((e.joiningDate.getTime() - Date.now()) / 86400_000);
            if (![
                7,
                3,
                1
            ].includes(days)) continue;
            const open = o.steps.filter((s)=>s.status !== 'DONE' && s.status !== 'SKIPPED').map((s)=>_shared.ONBOARDING_STEP_LABELS[s.key]);
            await this.notify.notify({
                userIds: await this.notify.usersForEmployees([
                    e.id
                ]),
                type: 'people.onboardingReminder',
                title: `You join in ${days} day${days === 1 ? '' : 's'} · finish your onboarding`,
                body: `Still open: ${open.join(', ')}`,
                link: '/onboarding',
                from: 'HR',
                email: true
            });
            sent++;
        }
        return sent;
    }
};
OnboardingService = _ts_decorate([
    (0, _common.Injectable)(),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _prismaservice.PrismaService === "undefined" ? Object : _prismaservice.PrismaService,
        typeof _esignservice.EsignService === "undefined" ? Object : _esignservice.EsignService,
        typeof _vaultservice.VaultService === "undefined" ? Object : _vaultservice.VaultService,
        typeof _kitsservice.KitsService === "undefined" ? Object : _kitsservice.KitsService,
        typeof _idcardsservice.IdCardsService === "undefined" ? Object : _idcardsservice.IdCardsService,
        typeof _cryptoservice.CryptoService === "undefined" ? Object : _cryptoservice.CryptoService,
        typeof _settingsservice.SettingsService === "undefined" ? Object : _settingsservice.SettingsService,
        typeof _notificationsservice.NotificationsService === "undefined" ? Object : _notificationsservice.NotificationsService,
        typeof _auditservice.AuditService === "undefined" ? Object : _auditservice.AuditService,
        typeof _eventsservice.EventsService === "undefined" ? Object : _eventsservice.EventsService
    ])
], OnboardingService);

//# sourceMappingURL=onboarding.service.js.map