"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "FinanceRegistry", {
    enumerable: true,
    get: function() {
        return FinanceRegistry;
    }
});
const _common = require("@nestjs/common");
const _schedule = require("@nestjs/schedule");
const _shared = require("@lexisora/shared");
const _prismaservice = require("../../core/prisma/prisma.service");
const _eventsservice = require("../../core/registry/events.service");
const _lookups = require("../../core/lookups/lookups");
const _registries = require("../../core/registry/registries");
const _filescontroller = require("../../core/storage/files.controller");
const _requestcontext = require("../../core/context/request-context");
const _decorators = require("../../core/auth/decorators");
const _ledgerservice = require("./ledger.service");
const _invoiceservice = require("./invoice.service");
const _purchaseservice = require("./purchase.service");
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
let FinanceRegistry = class FinanceRegistry {
    prisma;
    events;
    lookups;
    search;
    ledger;
    invoices;
    purchases;
    log = new _common.Logger('Finance');
    constructor(prisma, events, lookups, search, ledger, invoices, purchases){
        this.prisma = prisma;
        this.events = events;
        this.lookups = lookups;
        this.search = search;
        this.ledger = ledger;
        this.invoices = invoices;
        this.purchases = purchases;
    }
    onModuleInit() {
        // ── Events → ledger ───────────────────────────────────────────────────
        this.events.on('payroll.finalized', async (p)=>{
            if (!p?.runId || !p.period || !p.totals) return;
            const v = await this.ledger.postPayroll({
                runId: p.runId,
                period: p.period,
                totals: p.totals
            });
            this.log.log(`Payroll ${p.period} → ${v.number}`);
        });
        this.events.on('payroll.paid', async (p)=>{
            if (!p?.runId || !p.period) return;
            let net = p.netPaise;
            if (net === undefined) {
                const agg = await this.prisma.payslip.aggregate({
                    where: {
                        runId: p.runId,
                        status: {
                            not: 'VOID'
                        }
                    },
                    _sum: {
                        netPaise: true
                    }
                });
                net = Number(agg._sum.netPaise ?? 0);
            }
            if (net > 0) await this.ledger.postPayrollPayment({
                runId: p.runId,
                period: p.period,
                netPaise: net,
                paidAt: p.paidAt
            });
        });
        this.events.on('invoice.issued', async (p)=>{
            if (p?.invoiceId) await this.invoices.ensureSalesVoucher(p.invoiceId);
        });
        this.events.on('invoice.paid', async (p)=>{
            if (p?.invoiceId) await this.invoices.notifyPaid(p.invoiceId);
        });
        this.events.on('purchase.recorded', async (p)=>{
            if (p?.purchaseId) await this.purchases.ensureVoucher(p.purchaseId);
        });
        // ── Lookups (voucher / category forms) ─────────────────────────────────
        this.lookups.register('ledgers', async ()=>{
            const rows = await this.prisma.account.findMany({
                where: {
                    isGroup: false,
                    isActive: true
                },
                orderBy: {
                    code: 'asc'
                },
                select: {
                    id: true,
                    code: true,
                    name: true
                }
            });
            return rows.map((a)=>({
                    value: a.id,
                    label: `${a.code} · ${a.name}`
                }));
        });
        this.lookups.register('vendors', async ()=>{
            const rows = await this.prisma.vendor.findMany({
                where: {
                    isActive: true
                },
                orderBy: {
                    name: 'asc'
                },
                select: {
                    id: true,
                    name: true
                }
            });
            return rows.map((v)=>({
                    value: v.id,
                    label: v.name
                }));
        });
        // ── Header search ──────────────────────────────────────────────────────
        this.search.register('Invoices', async (q, ctx)=>(0, _decorators.hasPerm)(ctx, 'invoices.manage') ? this.searchInvoices(q) : []);
        this.search.register('Vouchers', async (q, ctx)=>(0, _decorators.hasPerm)(ctx, 'ledger.manage') || (0, _decorators.hasPerm)(ctx, 'ledger.hrvoucher') ? this.searchVouchers(q, ctx) : []);
        this.search.register('Purchases', async (q, ctx)=>(0, _decorators.hasPerm)(ctx, 'purchases.manage') ? this.searchPurchases(q) : []);
        this.search.register('Documents', async (q, ctx)=>(0, _decorators.hasPerm)(ctx, 'filing.manage') ? this.searchDocuments(q) : []);
        // ── Private files referenced by finance records ────────────────────────
        _filescontroller.fileAccessCheckers.push((fileId)=>this.canOpenFile(fileId).catch(()=>false));
    }
    async searchInvoices(q) {
        const rows = await this.prisma.invoice.findMany({
            where: {
                OR: [
                    {
                        number: {
                            contains: q,
                            mode: 'insensitive'
                        }
                    },
                    {
                        clientName: {
                            contains: q,
                            mode: 'insensitive'
                        }
                    },
                    {
                        projectName: {
                            contains: q,
                            mode: 'insensitive'
                        }
                    }
                ]
            },
            orderBy: {
                createdAt: 'desc'
            },
            take: 6
        });
        return rows.map((i)=>({
                type: 'Invoices',
                id: i.id,
                title: `${i.number ?? 'Draft'} · ${i.clientName}`,
                subtitle: `${(0, _shared.finMonthLabel)(i.period)} · ${(0, _shared.formatINR)(i.totalPaise)}`,
                link: `/invoices?open=${i.id}`
            }));
    }
    async searchVouchers(q, ctx) {
        const rows = await this.prisma.voucher.findMany({
            where: {
                ...(0, _decorators.hasPerm)(ctx, 'ledger.manage') ? {} : {
                    type: 'HR'
                },
                OR: [
                    {
                        number: {
                            contains: q,
                            mode: 'insensitive'
                        }
                    },
                    {
                        narration: {
                            contains: q,
                            mode: 'insensitive'
                        }
                    },
                    {
                        sourceRef: {
                            contains: q,
                            mode: 'insensitive'
                        }
                    }
                ]
            },
            orderBy: {
                date: 'desc'
            },
            take: 6
        });
        return rows.map((v)=>({
                type: 'Vouchers',
                id: v.id,
                title: `${v.number} · ${v.narration}`,
                subtitle: `${v.date.toISOString().slice(0, 10)} · ${(0, _shared.formatINR)(v.totalPaise)}`,
                link: `/ledger?voucher=${v.id}`
            }));
    }
    async searchPurchases(q) {
        const rows = await this.prisma.purchase.findMany({
            where: {
                OR: [
                    {
                        vendorInvoiceNo: {
                            contains: q,
                            mode: 'insensitive'
                        }
                    },
                    {
                        vendor: {
                            name: {
                                contains: q,
                                mode: 'insensitive'
                            }
                        }
                    }
                ]
            },
            include: {
                vendor: true
            },
            orderBy: {
                billDate: 'desc'
            },
            take: 6
        });
        return rows.map((p)=>({
                type: 'Purchases',
                id: p.id,
                title: `${p.vendor.name} · ${p.vendorInvoiceNo}`,
                subtitle: `${p.billDate.toISOString().slice(0, 10)} · ${(0, _shared.formatINR)(p.amountPaise)}`,
                link: `/purchases?open=${p.id}`
            }));
    }
    async searchDocuments(q) {
        const rows = await this.prisma.filingDocument.findMany({
            where: {
                deletedAt: null,
                OR: [
                    {
                        title: {
                            contains: q,
                            mode: 'insensitive'
                        }
                    },
                    {
                        tags: {
                            has: q.toLowerCase()
                        }
                    },
                    {
                        linkedRef: {
                            contains: q,
                            mode: 'insensitive'
                        }
                    }
                ]
            },
            include: {
                folder: true
            },
            orderBy: {
                uploadedAt: 'desc'
            },
            take: 6
        });
        return rows.map((d)=>({
                type: 'Documents',
                id: d.id,
                title: d.title,
                subtitle: d.folder.name,
                link: `/filing?folder=${d.folderId}&q=${encodeURIComponent(d.title)}`
            }));
    }
    /** Finance admins may open bills, invoice PDFs, voucher attachments and filed documents. */ async canOpenFile(fileId) {
        const ctx = (0, _requestcontext.getContext)();
        if (!ctx) return false;
        const any = (...keys)=>keys.some((k)=>(0, _decorators.hasPerm)(ctx, k));
        if (any('filing.manage') && await this.prisma.filingDocument.findFirst({
            where: {
                fileId,
                deletedAt: null
            },
            select: {
                id: true
            }
        })) return true;
        if (any('purchases.manage', 'ledger.manage') && await this.prisma.purchase.findFirst({
            where: {
                billFileId: fileId
            },
            select: {
                id: true
            }
        })) return true;
        if (any('invoices.manage', 'ledger.manage') && await this.prisma.invoice.findFirst({
            where: {
                pdfFileId: fileId
            },
            select: {
                id: true
            }
        })) return true;
        if (any('ledger.manage') && await this.prisma.voucher.findFirst({
            where: {
                attachmentFileId: fileId
            },
            select: {
                id: true
            }
        })) return true;
        if (any('ledger.hrvoucher') && await this.prisma.voucher.findFirst({
            where: {
                attachmentFileId: fileId,
                type: 'HR'
            },
            select: {
                id: true
            }
        })) return true;
        return false;
    }
    /** 09:00 IST daily: invoices that became overdue yesterday → alert finance admins. */ async overdueScan() {
        const tenants = await this.prisma.raw.tenant.findMany({
            where: {
                status: 'ACTIVE'
            },
            select: {
                id: true
            }
        });
        for (const t of tenants){
            try {
                const n = await (0, _requestcontext.runAsTenant)(t.id, ()=>this.invoices.notifyNewlyOverdue());
                if (n) this.log.log(`Overdue invoices alerted for tenant ${t.id}: ${n}`);
            } catch (e) {
                this.log.error(`Overdue scan failed for tenant ${t.id}: ${e.message}`);
            }
        }
    }
};
_ts_decorate([
    (0, _schedule.Cron)('0 9 * * *', {
        timeZone: 'Asia/Kolkata'
    }),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", []),
    _ts_metadata("design:returntype", Promise)
], FinanceRegistry.prototype, "overdueScan", null);
FinanceRegistry = _ts_decorate([
    (0, _common.Injectable)(),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _prismaservice.PrismaService === "undefined" ? Object : _prismaservice.PrismaService,
        typeof _eventsservice.EventsService === "undefined" ? Object : _eventsservice.EventsService,
        typeof _lookups.LookupsService === "undefined" ? Object : _lookups.LookupsService,
        typeof _registries.SearchService === "undefined" ? Object : _registries.SearchService,
        typeof _ledgerservice.LedgerService === "undefined" ? Object : _ledgerservice.LedgerService,
        typeof _invoiceservice.InvoiceService === "undefined" ? Object : _invoiceservice.InvoiceService,
        typeof _purchaseservice.PurchaseService === "undefined" ? Object : _purchaseservice.PurchaseService
    ])
], FinanceRegistry);

//# sourceMappingURL=finance.registry.js.map