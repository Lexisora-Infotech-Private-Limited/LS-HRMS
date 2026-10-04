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
    get COMPLIANCE_SETTINGS_KEY () {
        return COMPLIANCE_SETTINGS_KEY;
    },
    get ComplianceService () {
        return ComplianceService;
    }
});
const _common = require("@nestjs/common");
const _shared = require("@lexisora/shared");
const _prismaservice = require("../../core/prisma/prisma.service");
const _settingsservice = require("../../core/settings/settings.service");
const _auditservice = require("../../core/audit/audit.service");
const _requestcontext = require("../../core/context/request-context");
const _errors = require("../../core/http/errors");
const _purchaseservice = require("./purchase.service");
const _compliance = require("./lib/compliance");
const _money = require("./lib/money");
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
const COMPLIANCE_SETTINGS_KEY = 'finance.compliance';
let ComplianceService = class ComplianceService {
    prisma;
    settings;
    audit;
    purchases;
    constructor(prisma, settings, audit, purchases){
        this.prisma = prisma;
        this.settings = settings;
        this.audit = audit;
        this.purchases = purchases;
    }
    async filings() {
        const s = await this.settings.get(COMPLIANCE_SETTINGS_KEY, {
            filings: {}
        });
        return s.filings ?? {};
    }
    async calendar() {
        return (0, _compliance.complianceCalendar)((0, _shared.istDateKey)(), await this.filings());
    }
    async markFiled(input) {
        if (input.filedOn > (0, _shared.istDateKey)()) throw (0, _errors.badRequest)('Filing date cannot be in the future');
        const s = await this.settings.get(COMPLIANCE_SETTINGS_KEY, {
            filings: {}
        });
        const key = (0, _compliance.filingKey)(input.form, input.period);
        const filings = {
            ...s.filings ?? {},
            [key]: {
                ref: input.ref?.trim() || null,
                filedOn: input.filedOn,
                by: (0, _requestcontext.requireContext)().userName ?? null
            }
        };
        await this.settings.set(COMPLIANCE_SETTINGS_KEY, {
            ...s,
            filings
        });
        await this.audit.record({
            action: 'compliance.filed',
            entity: 'Compliance',
            entityId: key,
            meta: {
                ...input
            }
        });
        return {
            key,
            ...filings[key]
        };
    }
    async unmarkFiled(form, period) {
        const s = await this.settings.get(COMPLIANCE_SETTINGS_KEY, {
            filings: {}
        });
        const key = (0, _compliance.filingKey)(form, period);
        const filings = {
            ...s.filings ?? {}
        };
        delete filings[key];
        await this.settings.set(COMPLIANCE_SETTINGS_KEY, {
            ...s,
            filings
        });
        await this.audit.record({
            action: 'compliance.unfiled',
            entity: 'Compliance',
            entityId: key
        });
        return {
            ok: true
        };
    }
    /** GST returns register: last `months` return periods (current month first, "Open"). */ async gstReturns(months = 6) {
        const today = (0, _shared.istDateKey)();
        const filings = await this.filings();
        const periods = (0, _money.recentMonths)((0, _money.currentMonthKey)(), months);
        const docs = await this.prisma.filingDocument.findMany({
            where: {
                linkedEntityType: 'GST_RETURN',
                linkedEntityId: {
                    in: periods.map((p)=>`GSTR3B:${p}`)
                },
                deletedAt: null
            },
            select: {
                id: true,
                linkedEntityId: true
            }
        });
        const docBy = new Map(docs.map((d)=>[
                d.linkedEntityId,
                d.id
            ]));
        const rows = [];
        for (const p of periods){
            const s = await this.purchases.gstr3b(p);
            const out = s.outward.igstPaise + s.outward.cgstPaise + s.outward.sgstPaise;
            rows.push({
                period: p,
                periodLabel: (0, _shared.finMonthLabel)(p),
                taxablePaise: s.outward.taxablePaise,
                outputTaxPaise: out,
                itcPaise: s.itc.totalPaise,
                netPayablePaise: s.payable.totalPaise,
                invoices: s.outward.invoices,
                bills: s.itc.bills,
                gstr1: (0, _compliance.gstReturnStatus)('GSTR1', p, today, filings),
                gstr3b: (0, _compliance.gstReturnStatus)('GSTR3B', p, today, filings),
                workingDocumentId: docBy.get(`GSTR3B:${p}`) ?? null
            });
        }
        return rows;
    }
};
ComplianceService = _ts_decorate([
    (0, _common.Injectable)(),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _prismaservice.PrismaService === "undefined" ? Object : _prismaservice.PrismaService,
        typeof _settingsservice.SettingsService === "undefined" ? Object : _settingsservice.SettingsService,
        typeof _auditservice.AuditService === "undefined" ? Object : _auditservice.AuditService,
        typeof _purchaseservice.PurchaseService === "undefined" ? Object : _purchaseservice.PurchaseService
    ])
], ComplianceService);

//# sourceMappingURL=compliance.service.js.map