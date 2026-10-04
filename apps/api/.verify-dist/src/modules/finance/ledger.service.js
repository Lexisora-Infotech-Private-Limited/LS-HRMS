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
    get DEFAULT_FINANCE_SETTINGS () {
        return DEFAULT_FINANCE_SETTINGS;
    },
    get FINANCE_SETTINGS_KEY () {
        return FINANCE_SETTINGS_KEY;
    },
    get LedgerService () {
        return LedgerService;
    }
});
const _common = require("@nestjs/common");
const _client = require("@prisma/client");
const _shared = require("@lexisora/shared");
const _prismaservice = require("../../core/prisma/prisma.service");
const _sequenceservice = require("../../core/registry/sequence.service");
const _auditservice = require("../../core/audit/audit.service");
const _eventsservice = require("../../core/registry/events.service");
const _settingsservice = require("../../core/settings/settings.service");
const _requestcontext = require("../../core/context/request-context");
const _decorators = require("../../core/auth/decorators");
const _errors = require("../../core/http/errors");
const _paginate = require("../../core/http/paginate");
const _coa = require("./lib/coa");
const _gst = require("./lib/gst");
const _ledgermath = require("./lib/ledger-math");
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
const FINANCE_SETTINGS_KEY = 'finance.settings';
const DEFAULT_FINANCE_SETTINGS = {
    booksLockedUpTo: null,
    defaultPaymentTermsDays: 15,
    bank: {
        bankName: 'HDFC Bank',
        accountName: 'Lexisora Infotech Pvt Ltd',
        accountNo: '50200012345678',
        ifsc: 'HDFC0000123',
        branch: 'Satellite, Ahmedabad',
        upiId: 'lexisora@hdfcbank'
    },
    signatory: 'Rohit Verma, Director'
};
const voucherInclude = {
    lines: {
        orderBy: {
            sortOrder: 'asc'
        },
        include: {
            account: true
        }
    }
};
let LedgerService = class LedgerService {
    prisma;
    seq;
    audit;
    events;
    settings;
    log = new _common.Logger('Ledger');
    constructor(prisma, seq, audit, events, settings){
        this.prisma = prisma;
        this.seq = seq;
        this.audit = audit;
        this.events = events;
        this.settings = settings;
    }
    financeSettings() {
        return this.settings.get(FINANCE_SETTINGS_KEY, DEFAULT_FINANCE_SETTINGS);
    }
    // ── Chart of accounts ────────────────────────────────────────────────────
    /** Create any missing seeded accounts for the current tenant (idempotent). */ async ensureChart() {
        const existing = await this.prisma.account.findMany({
            select: {
                id: true,
                code: true,
                systemKey: true
            }
        });
        const byCode = new Map(existing.map((a)=>[
                a.code,
                a.id
            ]));
        const keys = new Set(existing.map((a)=>a.systemKey).filter(Boolean));
        for (const e of _coa.CHART_OF_ACCOUNTS){
            if (byCode.has(e.code) || e.key && keys.has(e.key)) continue;
            const row = await this.prisma.account.create({
                data: {
                    code: e.code,
                    name: e.name,
                    type: e.type,
                    isGroup: !!e.group,
                    systemKey: e.key ?? null,
                    isSystem: true,
                    parentId: e.parent ? byCode.get(e.parent) ?? null : null
                }
            });
            byCode.set(e.code, row.id);
        }
    }
    async accountIdByKey(key) {
        let a = await this.prisma.account.findFirst({
            where: {
                systemKey: key
            },
            select: {
                id: true
            }
        });
        if (!a) {
            await this.ensureChart();
            a = await this.prisma.account.findFirst({
                where: {
                    systemKey: key
                },
                select: {
                    id: true
                }
            });
        }
        if (!a) throw new _errors.AppError(500, 'ACCOUNT_MISSING', `System account ${key} is missing from the chart of accounts`);
        return a.id;
    }
    /** Receivable sub-ledger for a client (created lazily under Sundry debtors). */ clientAccount(clientId, clientName) {
        return this.partyAccount('CLIENT', clientId, clientName, 'AR', 'ASSET');
    }
    /** Payable sub-ledger for a vendor (created lazily under Sundry creditors). */ vendorAccount(vendorId, vendorName) {
        return this.partyAccount('VENDOR', vendorId, vendorName, 'AP', 'LIABILITY');
    }
    async partyAccount(partyType, partyId, name, groupKey, type) {
        const found = await this.prisma.account.findFirst({
            where: {
                partyType,
                partyId
            },
            select: {
                id: true,
                name: true
            }
        });
        if (found) return found.id;
        const parentId = await this.accountIdByKey(groupKey);
        const parent = await this.prisma.account.findFirst({
            where: {
                id: parentId
            },
            select: {
                code: true
            }
        });
        const used = new Set((await this.prisma.account.findMany({
            where: {
                code: {
                    startsWith: parent.code
                }
            },
            select: {
                code: true
            }
        })).map((s)=>s.code));
        let n = 1;
        while(used.has(`${parent.code}${String(n).padStart(3, '0')}`))n++;
        try {
            const row = await this.prisma.account.create({
                data: {
                    code: `${parent.code}${String(n).padStart(3, '0')}`,
                    name,
                    type,
                    parentId,
                    partyType,
                    partyId,
                    isSystem: true
                }
            });
            return row.id;
        } catch (e) {
            // Concurrent creation for the same party: reuse the winner.
            const again = await this.prisma.account.findFirst({
                where: {
                    partyType,
                    partyId
                },
                select: {
                    id: true
                }
            });
            if (again) return again.id;
            throw e;
        }
    }
    /** Throws when the date is inside locked books (or in the future, unless allowed). */ assertOpen(date, allowFuture = false) {
        return this.assertOpenPeriod(date, allowFuture);
    }
    // ── Payroll (event consumers) ────────────────────────────────────────────
    /**
   * `payroll.finalized` → one aggregated accrual JV per run (never per employee):
   * Dr Salaries + Employer PF; Cr Salary payable (net), PF, PT, TDS payable.
   * Dated the period end (or today when the month is still running); idempotent per run.
   */ async postPayroll(p) {
        const count = await this.prisma.payslip.count({
            where: {
                runId: p.runId
            }
        }).catch(()=>0);
        const { end } = (0, _money.monthRange)(p.period);
        const today = (0, _money.todayDate)();
        let date = end.getTime() > today.getTime() ? today : end;
        const s = await this.financeSettings();
        if (s.booksLockedUpTo && (0, _money.dateKeyOf)(date) <= s.booksLockedUpTo) date = today;
        const lines = (0, _gst.payrollPostingLines)({
            ...p.totals,
            employeeCount: p.totals.employeeCount ?? count
        });
        return this.post({
            type: 'PAYROLL',
            date,
            narration: `Payroll ${(0, _shared.finMonthLabel)(p.period)} (${count || p.totals.employeeCount || 0} employees)`,
            lines: lines.map((l)=>({
                    accountId: '',
                    systemKey: l.key,
                    debitPaise: l.debitPaise,
                    creditPaise: l.creditPaise,
                    narration: l.narration
                })),
            sourceType: 'PAYROLL_RUN',
            sourceId: p.runId,
            sourceRef: `${p.period} payroll`,
            allowFuture: true
        });
    }
    /** `payroll.paid` → salary payout: Dr Salary payable, Cr Bank (idempotent per run). */ async postPayrollPayment(p) {
        const date = p.paidAt ? (0, _money.todayDate)(new Date(p.paidAt)) : (0, _money.todayDate)();
        return this.post({
            type: 'PAYMENT',
            date,
            narration: `Salary payout ${(0, _shared.finMonthLabel)(p.period)}`,
            lines: [
                {
                    accountId: '',
                    systemKey: 'SALARY_PAYABLE',
                    debitPaise: p.netPaise
                },
                {
                    accountId: '',
                    systemKey: 'BANK',
                    creditPaise: p.netPaise
                }
            ],
            sourceType: 'PAYROLL_RUN',
            sourceId: `${p.runId}:paid`,
            sourceRef: `${p.period} payroll`,
            allowFuture: true
        });
    }
    // ── Posting ──────────────────────────────────────────────────────────────
    async assertOpenPeriod(date, allowFuture = false) {
        const s = await this.financeSettings();
        if (s.booksLockedUpTo && (0, _money.dateKeyOf)(date) <= s.booksLockedUpTo) {
            throw new _errors.AppError(422, 'PERIOD_LOCKED', `Books are locked up to ${s.booksLockedUpTo}. Pick a later date.`);
        }
        if (!allowFuture && date.getTime() > (0, _money.todayDate)().getTime()) throw new _errors.AppError(422, 'FUTURE_DATE', 'Voucher date cannot be in the future');
    }
    async post(input) {
        const ctx = (0, _requestcontext.requireContext)();
        const sourceType = input.sourceType ?? 'MANUAL';
        if (input.sourceId) {
            const dup = await this.prisma.voucher.findFirst({
                where: {
                    sourceType,
                    sourceId: input.sourceId
                },
                include: voucherInclude
            });
            if (dup) return dup; // idempotent auto-posting
        }
        await this.assertOpenPeriod(input.date, input.allowFuture);
        // Resolve system keys → account ids.
        const resolved = [];
        for (const l of input.lines){
            const accountId = l.accountId || (l.systemKey ? await this.accountIdByKey(l.systemKey) : '');
            if (!accountId) throw (0, _errors.badRequest)('Every line needs an account');
            resolved.push({
                ...l,
                accountId
            });
        }
        let v;
        try {
            v = (0, _ledgermath.validateVoucherLines)(resolved);
        } catch (e) {
            if (e instanceof _ledgermath.VoucherValidationError) throw new _errors.AppError(422, e.code, e.message, {
                differencePaise: e.differencePaise
            });
            throw e;
        }
        const accounts = await this.prisma.account.findMany({
            where: {
                id: {
                    in: [
                        ...new Set(v.lines.map((l)=>l.accountId))
                    ]
                }
            }
        });
        const byId = new Map(accounts.map((a)=>[
                a.id,
                a
            ]));
        for (const l of v.lines){
            const a = byId.get(l.accountId);
            if (!a) throw (0, _errors.badRequest)('Unknown account on a voucher line');
            if (a.isGroup) throw new _errors.AppError(422, 'GROUP_ACCOUNT', `${a.name} is a group — post to one of its ledgers`);
            if (!a.isActive) throw new _errors.AppError(422, 'INACTIVE_ACCOUNT', `${a.name} is inactive`);
        }
        const fy = (0, _money.fyOf)(input.date);
        const sq = (0, _money.voucherSequence)(input.type);
        const number = input.number ?? await this.seq.next(sq.key, {
            prefix: sq.prefix,
            pad: sq.pad,
            period: fy
        });
        const tenantId = ctx.tenantId;
        const voucher = await this.prisma.voucher.create({
            data: {
                number,
                type: input.type,
                date: input.date,
                fy,
                narration: input.narration.trim(),
                sourceType,
                sourceId: input.sourceId ?? null,
                sourceRef: input.sourceRef ?? null,
                employeeId: input.employeeId ?? null,
                attachmentFileId: input.attachmentFileId ?? null,
                reversalOfId: sourceType === 'REVERSAL' ? input.sourceId ?? null : null,
                totalPaise: v.totalPaise,
                postedByUserId: ctx.userId ?? null,
                postedByName: ctx.userName ?? 'System',
                lines: {
                    create: v.lines.map((l, i)=>({
                            tenantId,
                            accountId: l.accountId,
                            debitPaise: l.debitPaise,
                            creditPaise: l.creditPaise,
                            narration: l.narration,
                            sortOrder: i
                        }))
                }
            },
            include: voucherInclude
        });
        await this.audit.record({
            action: 'voucher.posted',
            entity: 'Voucher',
            entityId: voucher.id,
            meta: {
                number,
                type: input.type,
                totalPaise: v.totalPaise,
                sourceType,
                sourceRef: input.sourceRef ?? null
            }
        });
        this.events.emit('voucher.posted', {
            voucherId: voucher.id,
            number,
            type: input.type
        });
        return voucher;
    }
    /** Reverse a posted voucher: a JV with swapped sides; the original becomes REVERSED. */ async reverse(voucherId, reason, date) {
        const orig = await this.prisma.voucher.findFirst({
            where: {
                id: voucherId
            },
            include: voucherInclude
        });
        if (!orig) throw (0, _errors.notFound)('Voucher');
        if (orig.status === 'REVERSED') throw (0, _errors.conflict)('This voucher has already been reversed', 'ALREADY_REVERSED');
        if (orig.reversalOfId) throw (0, _errors.conflict)('A reversal cannot be reversed — post a new voucher instead', 'REVERSAL_OF_REVERSAL');
        const when = date ?? (0, _money.todayDate)();
        const rev = await this.post({
            type: 'JOURNAL',
            date: when.getTime() < orig.date.getTime() ? orig.date : when,
            narration: `Reversal of ${orig.number}: ${reason}`.slice(0, 500),
            lines: (0, _ledgermath.reverseLines)(orig.lines.map((l)=>({
                    accountId: l.accountId,
                    debitPaise: l.debitPaise,
                    creditPaise: l.creditPaise,
                    narration: l.narration
                }))),
            sourceType: 'REVERSAL',
            sourceId: orig.id,
            sourceRef: orig.number,
            employeeId: orig.employeeId
        });
        await this.prisma.voucher.update({
            where: {
                id: orig.id
            },
            data: {
                status: 'REVERSED',
                reversedById: rev.id
            }
        });
        await this.audit.record({
            action: 'voucher.reversed',
            entity: 'Voucher',
            entityId: orig.id,
            meta: {
                number: orig.number,
                reversal: rev.number,
                reason
            }
        });
        return rev;
    }
    /** "New voucher" form → balanced voucher with an automatic Bank/Cash counter line. */ async createManual(input, ctx) {
        const full = (0, _decorators.hasPerm)(ctx, 'ledger.manage');
        if (!full && input.type !== 'HR') throw (0, _errors.forbidden)('You can raise HR vouchers only');
        const date = (0, _money.dateOnly)(input.date);
        let lines;
        if (input.type === 'JOURNAL') {
            lines = (input.lines ?? []).map((l)=>({
                    accountId: l.accountId,
                    debitPaise: l.debitPaise,
                    creditPaise: l.creditPaise,
                    narration: l.narration ?? null
                }));
        } else {
            const ledger = await this.prisma.account.findFirst({
                where: {
                    id: input.accountId
                }
            });
            if (!ledger) throw (0, _errors.badRequest)('Pick a ledger');
            if (!full && ledger.type !== 'EXPENSE') throw (0, _errors.forbidden)('HR vouchers can only be booked to expense ledgers');
            const counterKey = input.type === 'HR' && input.employeeId && !input.counterAccountId ? 'REIMB_PAYABLE' : 'BANK';
            const counterId = input.counterAccountId || await this.accountIdByKey(counterKey);
            const counter = await this.prisma.account.findFirst({
                where: {
                    id: counterId
                }
            });
            if (!counter) throw (0, _errors.badRequest)('Pick the bank / cash account');
            if (!full && ![
                'BANK',
                'CASH',
                'REIMB_PAYABLE'
            ].includes(counter.systemKey ?? '')) throw (0, _errors.forbidden)('HR vouchers are paid from Bank, Cash or Reimbursements payable');
            if (counter.id === ledger.id) throw (0, _errors.badRequest)('Ledger and bank/cash account must be different');
            const amt = input.amountPaise;
            lines = input.type === 'RECEIPT' ? [
                {
                    accountId: counter.id,
                    debitPaise: amt
                },
                {
                    accountId: ledger.id,
                    creditPaise: amt
                }
            ] : [
                {
                    accountId: ledger.id,
                    debitPaise: amt
                },
                {
                    accountId: counter.id,
                    creditPaise: amt
                }
            ];
        }
        const v = await this.post({
            type: input.type,
            date,
            narration: input.narration,
            lines,
            sourceType: 'MANUAL',
            employeeId: input.employeeId ?? null,
            attachmentFileId: input.attachmentFileId ?? null
        });
        return {
            id: v.id,
            number: v.number
        };
    }
    // ── Reads ────────────────────────────────────────────────────────────────
    metaMap(accounts) {
        return new Map(accounts.map((a)=>[
                a.id,
                a
            ]));
    }
    toRow(v) {
        const meta = this.metaMap(v.lines.map((l)=>l.account));
        const p = (0, _ledgermath.primaryLedger)(v.lines, meta);
        return {
            id: v.id,
            number: v.number,
            type: v.type,
            date: (0, _money.dateKeyOf)(v.date),
            narration: v.narration,
            ledger: p.ledger,
            debitPaise: p.debitPaise,
            creditPaise: p.creditPaise,
            status: v.status,
            sourceType: v.sourceType,
            sourceRef: v.sourceRef,
            isReversal: !!v.reversalOfId
        };
    }
    async list(q, ctx) {
        const tab = (0, _decorators.hasPerm)(ctx, 'ledger.manage') ? q.tab : 'hr';
        const dateWhere = q.from || q.to ? {
            date: {
                ...q.from ? {
                    gte: (0, _money.dateOnly)(q.from)
                } : {},
                ...q.to ? {
                    lte: (0, _money.dateOnly)(q.to)
                } : {}
            }
        } : {};
        if (tab === 'income' || tab === 'expenses') {
            const where = {
                account: {
                    type: tab === 'income' ? 'INCOME' : 'EXPENSE'
                },
                voucher: {
                    ...dateWhere,
                    ...q.q ? {
                        OR: [
                            {
                                number: {
                                    contains: q.q,
                                    mode: 'insensitive'
                                }
                            },
                            {
                                narration: {
                                    contains: q.q,
                                    mode: 'insensitive'
                                }
                            }
                        ]
                    } : {}
                },
                ...q.accountId ? {
                    accountId: q.accountId
                } : {}
            };
            const [rows, total] = await Promise.all([
                this.prisma.voucherLine.findMany({
                    where,
                    include: {
                        voucher: true,
                        account: true
                    },
                    orderBy: [
                        {
                            voucher: {
                                date: 'desc'
                            }
                        },
                        {
                            voucher: {
                                createdAt: 'desc'
                            }
                        }
                    ],
                    ...(0, _paginate.pageArgs)(q)
                }),
                this.prisma.voucherLine.count({
                    where
                })
            ]);
            return (0, _paginate.paginated)(rows.map((l)=>({
                    id: l.id,
                    voucherId: l.voucherId,
                    number: l.voucher.number,
                    date: (0, _money.dateKeyOf)(l.voucher.date),
                    accountId: l.accountId,
                    account: l.account.name,
                    narration: l.narration || l.voucher.narration,
                    debitPaise: l.debitPaise,
                    creditPaise: l.creditPaise
                })), total, q);
        }
        const where = {
            ...dateWhere,
            ...tab === 'hr' ? {
                type: 'HR'
            } : q.type ? {
                type: q.type
            } : {},
            ...q.source ? {
                sourceType: q.source
            } : {},
            ...q.accountId ? {
                lines: {
                    some: {
                        accountId: q.accountId
                    }
                }
            } : {},
            ...q.q ? {
                OR: [
                    {
                        number: {
                            contains: q.q,
                            mode: 'insensitive'
                        }
                    },
                    {
                        narration: {
                            contains: q.q,
                            mode: 'insensitive'
                        }
                    },
                    {
                        sourceRef: {
                            contains: q.q,
                            mode: 'insensitive'
                        }
                    }
                ]
            } : {}
        };
        const [rows, total] = await Promise.all([
            this.prisma.voucher.findMany({
                where,
                include: voucherInclude,
                orderBy: [
                    {
                        date: 'desc'
                    },
                    {
                        createdAt: 'desc'
                    }
                ],
                ...(0, _paginate.pageArgs)(q)
            }),
            this.prisma.voucher.count({
                where
            })
        ]);
        return (0, _paginate.paginated)(rows.map((v)=>this.toRow(v)), total, q);
    }
    async detail(id, ctx) {
        const v = await this.prisma.voucher.findFirst({
            where: {
                id
            },
            include: voucherInclude
        });
        if (!v) throw (0, _errors.notFound)('Voucher');
        if (!(0, _decorators.hasPerm)(ctx, 'ledger.manage') && v.type !== 'HR') throw (0, _errors.forbidden)();
        const [emp, revOf, revBy] = await Promise.all([
            v.employeeId ? this.prisma.employee.findFirst({
                where: {
                    id: v.employeeId
                },
                select: {
                    fullName: true
                }
            }) : null,
            v.reversalOfId ? this.prisma.voucher.findFirst({
                where: {
                    id: v.reversalOfId
                },
                select: {
                    id: true,
                    number: true
                }
            }) : null,
            v.reversedById ? this.prisma.voucher.findFirst({
                where: {
                    id: v.reversedById
                },
                select: {
                    id: true,
                    number: true
                }
            }) : null
        ]);
        let link = null;
        if (v.sourceType === 'INVOICE' && v.sourceId) link = `/invoices?open=${v.sourceId}`;
        else if (v.sourceType === 'INVOICE_PAYMENT' && v.sourceId) {
            const p = await this.prisma.invoicePayment.findFirst({
                where: {
                    id: v.sourceId
                },
                select: {
                    invoiceId: true
                }
            });
            link = p ? `/invoices?open=${p.invoiceId}` : null;
        } else if (v.sourceType === 'CREDIT_NOTE' && v.sourceId) {
            const cn = await this.prisma.invoiceCreditNote.findFirst({
                where: {
                    id: v.sourceId
                },
                select: {
                    invoiceId: true
                }
            });
            link = cn ? `/invoices?open=${cn.invoiceId}` : null;
        } else if (v.sourceType === 'PURCHASE' && v.sourceId) link = `/purchases?open=${v.sourceId}`;
        else if (v.sourceType === 'PAYROLL_RUN') link = '/payroll';
        return {
            ...this.toRow(v),
            fy: v.fy,
            totalPaise: v.totalPaise,
            employeeName: emp?.fullName ?? null,
            attachmentFileId: v.attachmentFileId,
            postedByName: v.postedByName,
            createdAt: v.createdAt.toISOString(),
            reversalOf: revOf,
            reversedBy: revBy,
            source: {
                type: v.sourceType,
                id: v.sourceId,
                ref: v.sourceRef,
                link
            },
            lines: v.lines.map((l)=>({
                    id: l.id,
                    accountId: l.accountId,
                    accountCode: l.account.code,
                    account: l.account.name,
                    debitPaise: l.debitPaise,
                    creditPaise: l.creditPaise,
                    narration: l.narration
                }))
        };
    }
    /** Σ debit/credit per account for a date range (raw SQL: sums can exceed Int). */ async sums(from, to, opts = {}) {
        const tenantId = (0, _requestcontext.requireContext)().tenantId;
        const conds = [
            _client.Prisma.sql`l."tenantId" = ${tenantId}`
        ];
        if (opts.before && from) conds.push(_client.Prisma.sql`v."date" < ${from}`);
        else {
            if (from) conds.push(_client.Prisma.sql`v."date" >= ${from}`);
            if (to) conds.push(_client.Prisma.sql`v."date" <= ${to}`);
        }
        const rows = await this.prisma.raw.$queryRaw`
      SELECT l."accountId" AS "accountId", SUM(l."debitPaise")::bigint AS dr, SUM(l."creditPaise")::bigint AS cr
      FROM "VoucherLine" l JOIN "Voucher" v ON v."id" = l."voucherId"
      WHERE ${_client.Prisma.join(conds, ' AND ')}
      GROUP BY l."accountId"`;
        return rows.map((r)=>({
                accountId: r.accountId,
                debitPaise: Number(r.dr ?? 0),
                creditPaise: Number(r.cr ?? 0)
            }));
    }
    async kpis(month = (0, _money.currentMonthKey)()) {
        const { start, end } = (0, _money.monthRange)(month);
        const [sums, accounts, invoiceCount, s, payroll] = await Promise.all([
            this.sums(start, end),
            this.prisma.account.findMany({
                select: {
                    id: true,
                    type: true
                }
            }),
            this.prisma.invoice.count({
                where: {
                    invoiceDate: {
                        gte: start,
                        lte: end
                    },
                    status: {
                        notIn: [
                            'DRAFT',
                            'CANCELLED'
                        ]
                    }
                }
            }),
            this.financeSettings(),
            this.prisma.voucher.count({
                where: {
                    type: 'PAYROLL',
                    status: 'POSTED',
                    date: {
                        gte: start,
                        lte: end
                    }
                }
            })
        ]);
        const type = new Map(accounts.map((a)=>[
                a.id,
                a.type
            ]));
        let income = 0;
        let expenses = 0;
        for (const x of sums){
            const t = type.get(x.accountId);
            if (t === 'INCOME') income += x.creditPaise - x.debitPaise;
            if (t === 'EXPENSE') expenses += x.debitPaise - x.creditPaise;
        }
        return {
            month,
            monthLabel: (0, _shared.finMonthLabel)(month),
            incomePaise: income,
            expensesPaise: expenses,
            balancePaise: income - expenses,
            invoiceCount,
            payrollPosted: payroll > 0,
            booksLockedUpTo: s.booksLockedUpTo
        };
    }
    async trialBalance(fromKey, toKey) {
        const to = toKey ? (0, _money.dateOnly)(toKey) : (0, _money.todayDate)();
        const from = fromKey ? (0, _money.dateOnly)(fromKey) : (0, _money.fyStart)(to);
        if (from.getTime() > to.getTime()) throw (0, _errors.badRequest)('From date must be before To date');
        const [accounts, before, within] = await Promise.all([
            this.prisma.account.findMany({
                select: {
                    id: true,
                    code: true,
                    name: true,
                    type: true,
                    openingPaise: true,
                    isGroup: true
                }
            }),
            this.sums(from, null, {
                before: true
            }),
            this.sums(from, to)
        ]);
        const tb = (0, _ledgermath.computeTrialBalance)(accounts, before, within);
        return {
            from: (0, _money.dateKeyOf)(from),
            to: (0, _money.dateKeyOf)(to),
            ...tb
        };
    }
    async statement(accountId, fromKey, toKey) {
        const account = await this.prisma.account.findFirst({
            where: {
                id: accountId
            }
        });
        if (!account) throw (0, _errors.notFound)('Account');
        const to = toKey ? (0, _money.dateOnly)(toKey) : (0, _money.todayDate)();
        const from = fromKey ? (0, _money.dateOnly)(fromKey) : (0, _money.fyStart)(to);
        const before = (await this.sums(from, null, {
            before: true
        })).find((s)=>s.accountId === accountId);
        const opening = account.openingPaise + (before ? before.debitPaise - before.creditPaise : 0);
        const lines = await this.prisma.voucherLine.findMany({
            where: {
                accountId,
                voucher: {
                    date: {
                        gte: from,
                        lte: to
                    }
                }
            },
            include: {
                voucher: true
            },
            orderBy: [
                {
                    voucher: {
                        date: 'asc'
                    }
                },
                {
                    voucher: {
                        createdAt: 'asc'
                    }
                }
            ],
            take: 2000
        });
        const st = (0, _ledgermath.runningStatement)(opening, lines.map((l)=>({
                voucherId: l.voucherId,
                number: l.voucher.number,
                date: (0, _money.dateKeyOf)(l.voucher.date),
                narration: l.narration || l.voucher.narration,
                debitPaise: l.debitPaise,
                creditPaise: l.creditPaise
            })));
        return {
            account: {
                id: account.id,
                code: account.code,
                name: account.name,
                type: account.type
            },
            from: (0, _money.dateKeyOf)(from),
            to: (0, _money.dateKeyOf)(to),
            openingPaise: opening,
            closingPaise: st.closingPaise,
            rows: st.rows
        };
    }
    async accounts() {
        await this.ensureChart();
        const [accounts, sums] = await Promise.all([
            this.prisma.account.findMany({
                orderBy: {
                    code: 'asc'
                }
            }),
            this.sums(null, (0, _money.todayDate)())
        ]);
        const bal = new Map(sums.map((s)=>[
                s.accountId,
                s.debitPaise - s.creditPaise
            ]));
        const rows = accounts.map((a)=>({
                id: a.id,
                code: a.code,
                name: a.name,
                type: a.type,
                parentId: a.parentId,
                isGroup: a.isGroup,
                systemKey: a.systemKey,
                partyType: a.partyType,
                isSystem: a.isSystem,
                isActive: a.isActive,
                balancePaise: a.openingPaise + (bal.get(a.id) ?? 0)
            }));
        // Roll group balances up from their ledgers.
        const byId = new Map(rows.map((r)=>[
                r.id,
                r
            ]));
        for (const r of rows.filter((x)=>!x.isGroup)){
            let p = r.parentId ? byId.get(r.parentId) : undefined;
            while(p){
                if (p.isGroup) p.balancePaise += r.balancePaise;
                p = p.parentId ? byId.get(p.parentId) : undefined;
            }
        }
        return rows;
    }
    async createAccount(input) {
        if (input.parentId) {
            const parent = await this.prisma.account.findFirst({
                where: {
                    id: input.parentId
                }
            });
            if (!parent) throw (0, _errors.badRequest)('Parent group not found');
            if (!parent.isGroup) throw (0, _errors.badRequest)('Parent must be a group account');
            if (parent.type !== input.type) throw (0, _errors.badRequest)(`A ${input.type.toLowerCase()} account can't sit under ${parent.name}`);
        }
        if (await this.prisma.account.findFirst({
            where: {
                code: input.code
            }
        })) throw (0, _errors.conflict)(`Account code ${input.code} is already used`);
        const row = await this.prisma.account.create({
            data: {
                code: input.code,
                name: input.name,
                type: input.type,
                parentId: input.parentId ?? null,
                openingPaise: input.openingPaise ?? 0
            }
        });
        await this.audit.record({
            action: 'account.created',
            entity: 'Account',
            entityId: row.id,
            meta: {
                code: row.code,
                name: row.name
            }
        });
        return row;
    }
    async updateAccount(id, input) {
        const a = await this.prisma.account.findFirst({
            where: {
                id
            }
        });
        if (!a) throw (0, _errors.notFound)('Account');
        if (a.isSystem && input.isActive === false) throw (0, _errors.badRequest)('System accounts cannot be deactivated');
        const row = await this.prisma.account.update({
            where: {
                id
            },
            data: input
        });
        await this.audit.record({
            action: 'account.updated',
            entity: 'Account',
            entityId: id,
            meta: input
        });
        return row;
    }
    async lockBooks(upTo) {
        const s = await this.financeSettings();
        if ((0, _money.dateOnly)(upTo).getTime() > (0, _money.todayDate)().getTime()) throw (0, _errors.badRequest)('You can only lock books up to today');
        const drafts = await this.prisma.invoice.count({
            where: {
                status: 'DRAFT',
                periodEnd: {
                    lte: (0, _money.dateOnly)(upTo)
                }
            }
        });
        await this.settings.set(FINANCE_SETTINGS_KEY, {
            ...s,
            booksLockedUpTo: upTo
        });
        await this.audit.record({
            action: 'period.locked',
            entity: 'Ledger',
            meta: {
                upTo
            }
        });
        return {
            booksLockedUpTo: upTo,
            draftInvoicesInPeriod: drafts
        };
    }
    /** Day book or trial balance as CSV. */ async exportCsv(kind, fromKey, toKey, ctx) {
        const esc = (s)=>{
            const t = String(s ?? '');
            return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
        };
        const rupees = (p)=>p ? (p / 100).toFixed(2) : '';
        let lines;
        if (kind === 'trial') {
            const tb = await this.trialBalance(fromKey, toKey);
            lines = [
                'Code,Account,Type,Opening Dr,Opening Cr,Debit,Credit,Closing Dr,Closing Cr',
                ...tb.rows.map((r)=>[
                        r.code,
                        r.name,
                        r.type,
                        rupees(Math.max(0, r.openingPaise)),
                        rupees(Math.max(0, -r.openingPaise)),
                        rupees(r.debitPaise),
                        rupees(r.creditPaise),
                        rupees(Math.max(0, r.closingPaise)),
                        rupees(Math.max(0, -r.closingPaise))
                    ].map(esc).join(',')),
                [
                    '',
                    'Total',
                    '',
                    rupees(tb.totals.openingDr),
                    rupees(tb.totals.openingCr),
                    rupees(tb.totals.debitPaise),
                    rupees(tb.totals.creditPaise),
                    rupees(tb.totals.closingDr),
                    rupees(tb.totals.closingCr)
                ].map(esc).join(',')
            ];
            await this.audit.record({
                action: 'ledger.export',
                entity: 'Ledger',
                meta: {
                    kind,
                    from: tb.from,
                    to: tb.to
                }
            });
            return {
                filename: `trial-balance-${tb.from}-to-${tb.to}.csv`,
                csv: lines.join('\n')
            };
        }
        const to = toKey ? (0, _money.dateOnly)(toKey) : (0, _money.todayDate)();
        const from = fromKey ? (0, _money.dateOnly)(fromKey) : (0, _money.fyStart)(to);
        const hrOnly = ctx ? !(0, _decorators.hasPerm)(ctx, 'ledger.manage') : false;
        const vouchers = await this.prisma.voucher.findMany({
            where: {
                date: {
                    gte: from,
                    lte: to
                },
                ...hrOnly ? {
                    type: 'HR'
                } : {}
            },
            include: voucherInclude,
            orderBy: [
                {
                    date: 'asc'
                },
                {
                    createdAt: 'asc'
                }
            ],
            take: 20000
        });
        lines = [
            'Date,Voucher,Type,Ledger,Narration,Debit,Credit,Status'
        ];
        for (const v of vouchers){
            const r = this.toRow(v);
            lines.push([
                r.date,
                r.number,
                _shared.FIN_VOUCHER_TYPE_LABEL[r.type],
                r.ledger,
                r.narration,
                rupees(r.debitPaise),
                rupees(r.creditPaise),
                r.status
            ].map(esc).join(','));
        }
        await this.audit.record({
            action: 'ledger.export',
            entity: 'Ledger',
            meta: {
                kind,
                from: (0, _money.dateKeyOf)(from),
                to: (0, _money.dateKeyOf)(to)
            }
        });
        return {
            filename: `day-book-${(0, _money.dateKeyOf)(from)}-to-${(0, _money.dateKeyOf)(to)}.csv`,
            csv: lines.join('\n')
        };
    }
    /** Postable ledgers for the voucher form (HR: expense ledgers + payment sources only). */ async ledgerOptions(ctx) {
        await this.ensureChart();
        const full = (0, _decorators.hasPerm)(ctx, 'ledger.manage');
        const rows = await this.prisma.account.findMany({
            where: {
                isGroup: false,
                isActive: true
            },
            orderBy: {
                code: 'asc'
            }
        });
        const money = rows.filter((a)=>[
                'BANK',
                'CASH',
                'REIMB_PAYABLE'
            ].includes(a.systemKey ?? ''));
        const ledgers = full ? rows : rows.filter((a)=>a.type === 'EXPENSE');
        return {
            ledgers: ledgers.map((a)=>({
                    value: a.id,
                    label: `${a.name}`,
                    code: a.code,
                    type: a.type,
                    systemKey: a.systemKey
                })),
            counters: money.map((a)=>({
                    value: a.id,
                    label: a.name,
                    systemKey: a.systemKey
                })),
            canManage: full
        };
    }
};
LedgerService = _ts_decorate([
    (0, _common.Injectable)(),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _prismaservice.PrismaService === "undefined" ? Object : _prismaservice.PrismaService,
        typeof _sequenceservice.SequenceService === "undefined" ? Object : _sequenceservice.SequenceService,
        typeof _auditservice.AuditService === "undefined" ? Object : _auditservice.AuditService,
        typeof _eventsservice.EventsService === "undefined" ? Object : _eventsservice.EventsService,
        typeof _settingsservice.SettingsService === "undefined" ? Object : _settingsservice.SettingsService
    ])
], LedgerService);

//# sourceMappingURL=ledger.service.js.map