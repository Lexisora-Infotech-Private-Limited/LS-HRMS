"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "ProfileService", {
    enumerable: true,
    get: function() {
        return ProfileService;
    }
});
const _common = require("@nestjs/common");
const _shared = require("@lexisora/shared");
const _decorators = require("../../../core/auth/decorators");
const _requestcontext = require("../../../core/context/request-context");
const _cryptoservice = require("../../../core/crypto/crypto.service");
const _errors = require("../../../core/http/errors");
const _prismaservice = require("../../../core/prisma/prisma.service");
const _assetsservice = require("../assets/assets.service");
const _compensation = require("../compensation");
const _vaultservice = require("../documents/vault.service");
const _kitsservice = require("../kits/kits.service");
const _peopleaccess = require("../people.access");
const _peoplerules = require("../people.rules");
const _peopleutil = require("../people.util");
const _employeesservice = require("./employees.service");
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
const minToHm = (m)=>`${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const WORK_MODE_PUNCH = {
    OFFICE: 'Office · biometric punch',
    REMOTE: 'Remote · web + desktop punch',
    HYBRID: 'Hybrid · web + desktop punch'
};
let ProfileService = class ProfileService {
    prisma;
    crypto;
    access;
    vault;
    assets;
    kits;
    employees;
    constructor(prisma, crypto, access, vault, assets, kits, employees){
        this.prisma = prisma;
        this.crypto = crypto;
        this.access = access;
        this.vault = vault;
        this.assets = assets;
        this.kits = kits;
        this.employees = employees;
    }
    tabsFor(ctx, rel) {
        const tabs = [
            'overview'
        ];
        if (rel.self || rel.hr) tabs.push('documents');
        tabs.push('assets');
        if (rel.self || (0, _decorators.hasPerm)(ctx, 'employees.compensation')) tabs.push('pay');
        tabs.push('attendance');
        if (rel.self || rel.hr) tabs.push('devices');
        return tabs;
    }
    async profile(idOrMe) {
        const id = this.access.resolveId(idOrMe);
        const rel = await this.access.assertCanView(id);
        const ctx = (0, _requestcontext.requireContext)();
        const e = await this.prisma.employee.findUnique({
            where: {
                id
            },
            include: {
                department: true,
                designation: true,
                branch: true,
                manager: {
                    select: {
                        id: true,
                        fullName: true
                    }
                }
            }
        });
        if (!e) throw (0, _errors.notFound)('Employee');
        let shift = '—';
        let location = WORK_MODE_PUNCH[e.workMode] ?? e.workMode;
        try {
            const s = e.shiftId ? await (0, _peopleutil.model)(this.prisma, 'shift')?.findUnique({
                where: {
                    id: e.shiftId
                }
            }) : await (0, _peopleutil.model)(this.prisma, 'shift')?.findFirst({
                where: {
                    isDefault: true
                }
            });
            if (s) shift = `${s.name} · ${minToHm(s.startMinute)}–${minToHm(s.endMinute)}`;
            const loc = e.workLocationId ? await (0, _peopleutil.model)(this.prisma, 'workLocation')?.findUnique({
                where: {
                    id: e.workLocationId
                }
            }) : null;
            if (loc && e.workMode !== 'REMOTE') location = `${loc.name} · ${e.workMode === 'OFFICE' ? 'biometric punch' : 'web + desktop punch'}`;
        } catch  {
        /* time tables not present */ }
        const privileged = rel.self || rel.hr;
        const overview = [
            {
                label: 'Official email',
                value: e.officialEmail
            },
            {
                label: 'Phone',
                value: e.phone ? privileged || rel.manager ? e.phone : e.phone.replace(/\d{5}$/, 'XXXXX') : '—'
            },
            {
                label: 'Shift',
                value: shift
            },
            {
                label: 'Work location',
                value: location
            },
            {
                label: 'Blood group',
                value: e.bloodGroup ?? '—'
            },
            {
                label: 'Emergency contact',
                value: e.emergencyContactName ? `${e.emergencyContactName}${e.emergencyContactPhone ? ` · ${e.emergencyContactPhone}` : ''}` : '—'
            }
        ];
        if (privileged) {
            overview.push({
                label: 'Personal email',
                value: e.personalEmail ?? '—'
            }, {
                label: 'Date of birth',
                value: (0, _peopleutil.fmt)(e.dateOfBirth)
            }, {
                label: 'Address',
                value: e.address ?? '—'
            }, {
                label: 'Branch',
                value: e.branch?.name ?? '—'
            }, {
                label: 'Employment type',
                value: e.employmentType === 'INTERN' ? 'Intern' : e.employmentType === 'CONTRACT' ? 'Contract' : 'Full-time'
            }, {
                label: 'PAN',
                value: (0, _peoplerules.maskPan)(this.crypto.decrypt(e.panEnc))
            }, {
                label: 'Bank account',
                value: e.bankAccountLast4 ? `${(0, _peoplerules.maskAccount)(e.bankAccountLast4)} · ${e.bankIfsc ?? ''}` : '—'
            }, {
                label: 'Tax regime',
                value: e.taxRegime === 'OLD' ? 'Old regime' : 'New regime'
            });
            if (e.status === 'NOTICE_PERIOD' || e.status === 'EXITED') overview.push({
                label: e.status === 'EXITED' ? 'Exited on' : 'Last working day',
                value: (0, _peopleutil.fmt)(e.exitDate)
            });
        }
        // Badges from workplace Kudos (optional table).
        let badges = [];
        let moreBadges = 0;
        try {
            const k = (0, _peopleutil.model)(this.prisma, 'kudos');
            if (k) {
                const rows = await k.findMany({
                    where: {
                        recipientEmployeeId: id,
                        revokedAt: null
                    },
                    include: {
                        badge: {
                            select: {
                                name: true
                            }
                        }
                    },
                    orderBy: {
                        createdAt: 'desc'
                    },
                    take: 50
                });
                const uniq = [
                    ...new Set(rows.map((r)=>r.badge?.name).filter(Boolean))
                ];
                badges = uniq.slice(0, 3);
                moreBadges = Math.max(0, uniq.length - 3);
            }
        } catch  {
        /* workplace not available */ }
        const hr = (0, _peopleaccess.isHr)(ctx) || ctx.permissions.has('*');
        return {
            id: e.id,
            isSelf: rel.self,
            fullName: e.fullName,
            initials: (0, _peoplerules.initials)(e.fullName),
            photoFileId: e.photoFileId,
            empCode: e.empCode,
            designation: e.designation?.name ?? null,
            designationId: e.designationId,
            department: e.department?.name ?? null,
            departmentId: e.departmentId,
            manager: e.manager?.fullName ?? null,
            managerId: e.managerId,
            branchId: e.branchId,
            workMode: e.workMode,
            employmentType: e.employmentType,
            status: e.status,
            statusLabel: (0, _peoplerules.employeeStatusLabel)(e.status, e.employmentType),
            joiningDate: (0, _peopleutil.dbDateKey)(e.joiningDate),
            badges,
            moreBadges,
            visibleTabs: this.tabsFor(ctx, rel),
            canEdit: hr,
            canEditSelf: rel.self,
            canLifecycle: hr,
            exitedOn: e.status === 'EXITED' ? (0, _peopleutil.dbDateKey)(e.exitDate) : null,
            overview,
            editable: hr || rel.self ? {
                fullName: e.fullName,
                phone: e.phone,
                personalEmail: e.personalEmail,
                departmentId: e.departmentId,
                designationId: e.designationId,
                branchId: e.branchId,
                managerId: e.managerId,
                employmentType: e.employmentType,
                workMode: e.workMode,
                joiningDate: (0, _peopleutil.dbDateKey)(e.joiningDate),
                shiftId: e.shiftId,
                workLocationId: e.workLocationId,
                bloodGroup: e.bloodGroup,
                dateOfBirth: (0, _peopleutil.dbDateKey)(e.dateOfBirth),
                gender: e.gender,
                maritalStatus: e.maritalStatus,
                address: e.address,
                emergencyContactName: e.emergencyContactName,
                emergencyContactPhone: e.emergencyContactPhone,
                photoFileId: e.photoFileId
            } : {},
            exitCase: hr || rel.self || rel.manager ? await this.employees.exitCaseDto(id) : null
        };
    }
    async documents(idOrMe) {
        const id = this.access.resolveId(idOrMe);
        const rel = await this.access.assertCanView(id);
        if (!rel.self && !rel.hr) throw (0, _errors.forbidden)('Documents are visible only to the employee and HR');
        const rows = await this.vault.listFor(id);
        const canVerify = (0, _decorators.hasPerm)((0, _requestcontext.requireContext)(), 'onboarding.manage');
        return rows.map((d)=>({
                id: d.id,
                title: d.title,
                category: d.category,
                categoryLabel: d.categoryLabel,
                docType: d.docType,
                status: d.status,
                statusLabel: d.statusLabel,
                uploadedAt: d.uploadedAt,
                fileId: d.fileId,
                rejectionReason: d.rejectionReason,
                canVerify: canVerify && d.status === 'PENDING'
            }));
    }
    async assetsTab(idOrMe) {
        const id = this.access.resolveId(idOrMe);
        await this.access.assertCanView(id);
        const rows = await this.assets.forEmployee(id);
        const kit = await this.kits.summary(id);
        if (kit) rows.push({
            id: 'kit',
            item: 'Welcome kit',
            serial: '—',
            assigned: kit.date ? (0, _peopleutil.fmt)(kit.date) : '—',
            status: kit.issued === kit.total ? 'ISSUED' : 'PARTIAL',
            statusLabel: `${kit.issued} of ${kit.total} items`
        });
        return {
            rows
        };
    }
    async pay(idOrMe) {
        const id = this.access.resolveId(idOrMe);
        const rel = await this.access.assertCanView(id);
        if (!rel.self && !(0, _decorators.hasPerm)((0, _requestcontext.requireContext)(), 'employees.compensation')) throw (0, _errors.forbidden)('Compensation is visible only to the employee and Payroll/HR');
        const comp = await (0, _compensation.loadCompensation)(this.prisma, this.crypto, id);
        return {
            rows: comp?.rows ?? [],
            effectiveFrom: comp?.effectiveFrom ?? null,
            source: comp?.source ?? null
        };
    }
    /** Last 6 months from time's AttendanceDay (present/leave days, idle, late). */ async attendance(idOrMe) {
        const id = this.access.resolveId(idOrMe);
        await this.access.assertCanView(id);
        const m = (0, _peopleutil.model)(this.prisma, 'attendanceDay');
        if (!m) return {
            rows: []
        };
        const today = (0, _peopleutil.todayKey)();
        const from = new Date(`${today.slice(0, 7)}-01T00:00:00.000Z`);
        from.setUTCMonth(from.getUTCMonth() - 5);
        let days = [];
        try {
            days = await m.findMany({
                where: {
                    employeeId: id,
                    date: {
                        gte: from
                    }
                },
                select: {
                    date: true,
                    presentFraction: true,
                    leaveFraction: true,
                    idleMinutes: true,
                    isLate: true
                }
            });
        } catch  {
            return {
                rows: []
            };
        }
        const by = new Map();
        for (const d of days){
            const key = d.date.toISOString().slice(0, 7);
            const r = by.get(key) ?? {
                month: (0, _shared.formatMonthYear)(d.date),
                present: 0,
                leave: 0,
                idleMinutes: 0,
                late: 0
            };
            r.present += d.presentFraction ?? 0;
            r.leave += d.leaveFraction ?? 0;
            r.idleMinutes += d.idleMinutes ?? 0;
            r.late += d.isLate ? 1 : 0;
            by.set(key, r);
        }
        return {
            rows: [
                ...by.entries()
            ].sort((a, b)=>b[0].localeCompare(a[0])).map(([, r])=>({
                    ...r,
                    present: Math.round(r.present * 2) / 2,
                    leave: Math.round(r.leave * 2) / 2
                }))
        };
    }
    /** Header search provider: HR/managers get code + email; employees see name + designation only. */ async search(q, ctx) {
        const full = (0, _decorators.hasPerm)(ctx, 'employees.view');
        const scope = full ? await this.access.listScope() : null;
        const rows = await this.prisma.employee.findMany({
            where: {
                status: {
                    not: 'EXITED'
                },
                ...scope && full ? {} : {},
                OR: [
                    {
                        fullName: {
                            contains: q,
                            mode: 'insensitive'
                        }
                    },
                    ...full ? [
                        {
                            empCode: {
                                contains: q,
                                mode: 'insensitive'
                            }
                        },
                        {
                            officialEmail: {
                                contains: q,
                                mode: 'insensitive'
                            }
                        }
                    ] : []
                ]
            },
            include: {
                designation: true,
                department: true
            },
            take: 6,
            orderBy: {
                fullName: 'asc'
            }
        });
        return rows.map((e)=>{
            const canOpen = full && (!scope || scope.includes(e.id));
            return {
                type: 'people',
                id: e.id,
                title: e.fullName,
                subtitle: full ? [
                    e.designation?.name,
                    e.department?.name,
                    e.empCode
                ].filter(Boolean).join(' · ') : e.designation?.name ?? undefined,
                link: e.id === ctx.employeeId ? '/me' : canOpen ? `/employees/${e.id}` : '/employees'
            };
        });
    }
};
ProfileService = _ts_decorate([
    (0, _common.Injectable)(),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _prismaservice.PrismaService === "undefined" ? Object : _prismaservice.PrismaService,
        typeof _cryptoservice.CryptoService === "undefined" ? Object : _cryptoservice.CryptoService,
        typeof _peopleaccess.PeopleAccess === "undefined" ? Object : _peopleaccess.PeopleAccess,
        typeof _vaultservice.VaultService === "undefined" ? Object : _vaultservice.VaultService,
        typeof _assetsservice.AssetsService === "undefined" ? Object : _assetsservice.AssetsService,
        typeof _kitsservice.KitsService === "undefined" ? Object : _kitsservice.KitsService,
        typeof _employeesservice.EmployeesService === "undefined" ? Object : _employeesservice.EmployeesService
    ])
], ProfileService);

//# sourceMappingURL=profile.service.js.map