"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "BillingJobs", {
    enumerable: true,
    get: function() {
        return BillingJobs;
    }
});
const _common = require("@nestjs/common");
const _schedule = require("@nestjs/schedule");
const _shared = require("@lexisora/shared");
const _prismaservice = require("../../../core/prisma/prisma.service");
const _requestcontext = require("../../../core/context/request-context");
const _platformutil = require("../platform.util");
const _billingservice = require("./billing.service");
const _billinglogic = require("./billing.logic");
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
const DAY = 86_400_000;
let BillingJobs = class BillingJobs {
    prisma;
    billing;
    log = new _common.Logger('BillingJobs');
    constructor(prisma, billing){
        this.prisma = prisma;
        this.billing = billing;
    }
    async eachSubscription(name, where, fn) {
        const subs = await this.prisma.raw.subscription.findMany({
            where
        });
        for (const s of subs){
            try {
                await (0, _requestcontext.runAsTenant)(s.tenantId, ()=>fn(s));
            } catch (e) {
                this.log.error(`${name} failed for tenant ${s.tenantId}: ${e.message}`);
            }
        }
        return subs.length;
    }
    /** 01:00 IST: periods that ended → renewal invoice (gateway collection) or scheduled downgrade. */ async renewals() {
        const n = await this.eachSubscription('billing.renewals', {
            planCode: 'GROWTH',
            status: 'ACTIVE',
            currentPeriodEnd: {
                lt: new Date()
            }
        }, (s)=>this.billing.renewOrDowngrade(s));
        if (n) this.log.log(`Processed ${n} renewals`);
    }
    /** Hourly: grace ended → read-only; 30 days unpaid → suspended. */ async dunning() {
        await this.eachSubscription('billing.dunning', {
            status: {
                in: [
                    'PAST_DUE',
                    'READ_ONLY'
                ]
            }
        }, (s)=>this.billing.dunning(s));
    }
    /** 09:00 IST: renewal reminders at T-30 (yearly), T-7 and T-1. */ async reminders() {
        const now = new Date();
        await this.eachSubscription('billing.reminders', {
            planCode: 'GROWTH',
            status: 'ACTIVE',
            cancelAtPeriodEnd: false,
            currentPeriodEnd: {
                gt: now,
                lt: new Date(now.getTime() + 31 * DAY)
            }
        }, async (s)=>{
            if (s.currentPeriodEnd && (0, _billinglogic.reminderDue)(s.cycle, (0, _billinglogic.daysUntil)(s.currentPeriodEnd, now))) await this.billing.renewalReminder(s);
        });
    }
    /** 00:30 IST: platform MRR snapshot (Tenants screen "MRR +x%" compares with 30 days ago). */ async mrrSnapshot() {
        const operator = await (0, _platformutil.platformTenantId)(this.prisma.raw).catch(()=>null);
        const subs = await this.prisma.raw.subscription.findMany({
            where: operator ? {
                tenantId: {
                    not: operator
                }
            } : {}
        });
        const metrics = subs;
        const date = new Date(`${(0, _shared.istDateKey)()}T00:00:00Z`);
        const data = {
            mrrPaise: (0, _billinglogic.mrrPaise)(metrics),
            seatsBilled: (0, _billinglogic.seatsBilled)(metrics),
            paidTenants: subs.filter((s)=>(s.planCode === 'GROWTH' || s.planCode === 'ENTERPRISE') && [
                    'ACTIVE',
                    'PAST_DUE',
                    'READ_ONLY'
                ].includes(s.status)).length,
            freeTenants: subs.filter((s)=>s.planCode === 'FREE').length
        };
        await this.prisma.raw.mrrSnapshot.upsert({
            where: {
                date
            },
            create: {
                date,
                ...data
            },
            update: data
        });
    }
};
_ts_decorate([
    (0, _schedule.Cron)('0 1 * * *', {
        timeZone: 'Asia/Kolkata'
    }),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", []),
    _ts_metadata("design:returntype", Promise)
], BillingJobs.prototype, "renewals", null);
_ts_decorate([
    (0, _schedule.Cron)('20 * * * *', {
        timeZone: 'Asia/Kolkata'
    }),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", []),
    _ts_metadata("design:returntype", Promise)
], BillingJobs.prototype, "dunning", null);
_ts_decorate([
    (0, _schedule.Cron)('0 9 * * *', {
        timeZone: 'Asia/Kolkata'
    }),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", []),
    _ts_metadata("design:returntype", Promise)
], BillingJobs.prototype, "reminders", null);
_ts_decorate([
    (0, _schedule.Cron)('30 0 * * *', {
        timeZone: 'Asia/Kolkata'
    }),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", []),
    _ts_metadata("design:returntype", Promise)
], BillingJobs.prototype, "mrrSnapshot", null);
BillingJobs = _ts_decorate([
    (0, _common.Injectable)(),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _prismaservice.PrismaService === "undefined" ? Object : _prismaservice.PrismaService,
        typeof _billingservice.BillingService === "undefined" ? Object : _billingservice.BillingService
    ])
], BillingJobs);

//# sourceMappingURL=billing.jobs.js.map