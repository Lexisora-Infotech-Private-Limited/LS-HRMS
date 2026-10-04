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
    get EmployeesService () {
        return EmployeesService;
    },
    get escapeHtml () {
        return escapeHtml;
    }
});
const _common = require("@nestjs/common");
const _shared = require("@lexisora/shared");
const _env = require("../../../config/env");
const _auditservice = require("../../../core/audit/audit.service");
const _requestcontext = require("../../../core/context/request-context");
const _errors = require("../../../core/http/errors");
const _paginate = require("../../../core/http/paginate");
const _mailservice = require("../../../core/mail/mail.service");
const _notificationsservice = require("../../../core/notifications/notifications.service");
const _prismaservice = require("../../../core/prisma/prisma.service");
const _eventsservice = require("../../../core/registry/events.service");
const _sequenceservice = require("../../../core/registry/sequence.service");
const _peopleaccess = require("../people.access");
const _peoplerules = require("../people.rules");
const _peopleutil = require("../people.util");
const _onboardingservice = require("../onboarding/onboarding.service");
const _idcardsservice = require("../idcards/idcards.service");
const _kitsservice = require("../kits/kits.service");
const _vcardservice = require("../vcard/vcard.service");
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
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { parse: parseCsv } = require('csv-parse/sync');
const ACTIVE_STATUSES = [
    'ONBOARDING',
    'ACTIVE',
    'NOTICE_PERIOD'
];
let EmployeesService = class EmployeesService {
    prisma;
    seq;
    mail;
    notify;
    audit;
    events;
    access;
    onboarding;
    idcards;
    kits;
    vcard;
    log = new _common.Logger('People');
    constructor(prisma, seq, mail, notify, audit, events, access, onboarding, idcards, kits, vcard){
        this.prisma = prisma;
        this.seq = seq;
        this.mail = mail;
        this.notify = notify;
        this.audit = audit;
        this.events = events;
        this.access = access;
        this.onboarding = onboarding;
        this.idcards = idcards;
        this.kits = kits;
        this.vcard = vcard;
    }
    // ── Directory ────────────────────────────────────────────────────────────
    tabWhere(tab) {
        switch(tab){
            case 'full_time':
                return {
                    employmentType: {
                        not: 'INTERN'
                    },
                    status: {
                        not: 'EXITED'
                    }
                };
            case 'interns':
                return {
                    employmentType: 'INTERN',
                    status: {
                        not: 'EXITED'
                    }
                };
            case 'notice':
                return {
                    status: 'NOTICE_PERIOD'
                };
            case 'exited':
                return {
                    status: 'EXITED'
                };
            default:
                return {
                    status: {
                        in: [
                            ...ACTIVE_STATUSES
                        ]
                    }
                };
        }
    }
    async scopeWhere(q) {
        const scope = await this.access.listScope();
        const where = {};
        if (scope) where.id = {
            in: scope
        };
        if (q?.q) {
            where.OR = [
                {
                    fullName: {
                        contains: q.q,
                        mode: 'insensitive'
                    }
                },
                {
                    empCode: {
                        contains: q.q,
                        mode: 'insensitive'
                    }
                },
                {
                    officialEmail: {
                        contains: q.q,
                        mode: 'insensitive'
                    }
                }
            ];
        }
        if (q?.departmentId) where.departmentId = q.departmentId;
        if (q?.workMode) where.workMode = q.workMode;
        if (q?.managerId) where.managerId = q.managerId;
        return where;
    }
    async list(q) {
        const base = await this.scopeWhere(q);
        const where = {
            AND: [
                base,
                this.tabWhere(q.tab)
            ]
        };
        const [rows, total] = await Promise.all([
            this.prisma.employee.findMany({
                where,
                include: {
                    department: true,
                    designation: true,
                    manager: {
                        select: {
                            fullName: true
                        }
                    }
                },
                orderBy: [
                    {
                        fullName: 'asc'
                    }
                ],
                ...(0, _paginate.pageArgs)(q)
            }),
            this.prisma.employee.count({
                where
            })
        ]);
        const items = rows.map((e)=>({
                id: e.id,
                fullName: e.fullName,
                empCode: e.empCode,
                photoFileId: e.photoFileId,
                department: e.department?.name ?? null,
                designation: e.designation?.name ?? null,
                workMode: e.workMode,
                manager: e.manager?.fullName ?? null,
                employmentType: e.employmentType,
                status: e.status,
                statusLabel: (0, _peoplerules.employeeStatusLabel)(e.status, e.employmentType),
                officialEmail: e.officialEmail
            }));
        return {
            ...(0, _paginate.paginated)(items, total, q),
            counts: await this.counts(q)
        };
    }
    async counts(q) {
        const base = await this.scopeWhere({
            ...q,
            q: q?.q
        });
        const tabs = [
            'all',
            'full_time',
            'interns',
            'notice',
            'exited'
        ];
        const vals = await Promise.all(tabs.map((t)=>this.prisma.employee.count({
                where: {
                    AND: [
                        base,
                        this.tabWhere(t)
                    ]
                }
            })));
        return Object.fromEntries(tabs.map((t, i)=>[
                t,
                vals[i]
            ]));
    }
    exportCsv = async (q)=>{
        const base = await this.scopeWhere(q);
        const rows = await this.prisma.employee.findMany({
            where: {
                AND: [
                    base,
                    this.tabWhere(q.tab)
                ]
            },
            include: {
                department: true,
                designation: true,
                manager: {
                    select: {
                        fullName: true
                    }
                }
            },
            orderBy: {
                fullName: 'asc'
            }
        });
        const head = [
            'Name',
            'Emp ID',
            'Official email',
            'Department',
            'Designation',
            'Work mode',
            'Manager',
            'Status',
            'Joining date'
        ];
        const lines = rows.map((e)=>[
                e.fullName,
                e.empCode,
                e.officialEmail,
                e.department?.name,
                e.designation?.name,
                e.workMode,
                e.manager?.fullName,
                (0, _peoplerules.employeeStatusLabel)(e.status, e.employmentType),
                (0, _peopleutil.dbDateKey)(e.joiningDate)
            ].map(_peoplerules.csvEscape).join(','));
        return [
            head.join(','),
            ...lines
        ].join('\n');
    };
    // ── Create (Add employee / import / hire) ─────────────────────────────────
    async nextEmpCode(type) {
        const s = (0, _peoplerules.empCodeSeries)(type);
        const existing = await this.prisma.employee.findMany({
            where: {
                empCode: {
                    startsWith: s.prefix
                }
            },
            select: {
                empCode: true
            }
        });
        const start = (0, _peoplerules.maxCodeNumber)(existing.map((e)=>e.empCode), type) + 1;
        for(let i = 0; i < 5; i++){
            const n = await this.seq.nextValue(s.key, {
                start
            });
            const code = (0, _peoplerules.formatEmpCode)(type, n);
            if (!await this.prisma.employee.findFirst({
                where: {
                    empCode: code
                },
                select: {
                    id: true
                }
            })) return code;
        }
        throw new _errors.AppError(409, 'EMP_CODE_EXHAUSTED', 'Could not allocate an employee code; try again');
    }
    async assertManager(managerId, selfId) {
        if (!managerId) return;
        if (managerId === selfId) throw (0, _errors.badRequest)('An employee cannot report to themselves', 'MANAGER_INVALID');
        const m = await this.prisma.employee.findUnique({
            where: {
                id: managerId
            },
            select: {
                id: true,
                status: true,
                managerId: true
            }
        });
        if (!m || m.status === 'EXITED') throw (0, _errors.badRequest)('Pick an active reporting manager', 'MANAGER_INVALID');
        if (selfId) {
            // No cycles: the new manager must not be in the employee's own subtree.
            let cur = m.managerId;
            for(let i = 0; cur && i < 20; i++){
                if (cur === selfId) throw (0, _errors.badRequest)('That reporting line would create a cycle', 'MANAGER_CYCLE');
                cur = (await this.prisma.employee.findUnique({
                    where: {
                        id: cur
                    },
                    select: {
                        managerId: true
                    }
                }))?.managerId ?? null;
            }
        }
    }
    async create(input, opts = {}) {
        const ctx = (0, _requestcontext.requireContext)();
        const email = input.officialEmail.toLowerCase();
        if (await this.prisma.employee.findFirst({
            where: {
                officialEmail: email
            },
            select: {
                id: true
            }
        })) {
            throw (0, _errors.conflict)(`${email} already belongs to an employee`, 'EMAIL_TAKEN');
        }
        if (await this.prisma.user.findFirst({
            where: {
                email
            },
            select: {
                id: true
            }
        })) throw (0, _errors.conflict)(`${email} already has a login`, 'EMAIL_TAKEN');
        const [dept, desig] = await Promise.all([
            this.prisma.department.findUnique({
                where: {
                    id: input.departmentId
                }
            }),
            this.prisma.designation.findUnique({
                where: {
                    id: input.designationId
                }
            })
        ]);
        if (!dept) throw (0, _errors.badRequest)('Pick a department', 'DEPARTMENT_INVALID');
        if (!desig) throw (0, _errors.badRequest)('Pick a designation', 'DESIGNATION_INVALID');
        await this.assertManager(input.managerId);
        if (input.joiningDate < '2000-01-01') throw (0, _errors.badRequest)('Joining date looks wrong');
        let empCode;
        if (input.empCodeOverride) {
            if (await this.prisma.employee.findFirst({
                where: {
                    empCode: input.empCodeOverride
                }
            })) throw (0, _errors.conflict)(`Emp ID ${input.empCodeOverride} is taken`, 'EMP_CODE_TAKEN');
            empCode = input.empCodeOverride;
        } else empCode = await this.nextEmpCode(input.employmentType);
        const role = await this.prisma.role.findFirst({
            where: {
                key: 'employee'
            }
        });
        if (!role) throw new _errors.AppError(500, 'ROLE_MISSING', 'The Employee role is missing for this workspace');
        const { firstName, lastName } = (0, _peopleutil.splitName)(input.fullName);
        const inviteToken = (0, _peopleutil.token)(32);
        const branchId = input.branchId ?? (await this.prisma.branch.findFirst({
            orderBy: {
                createdAt: 'asc'
            },
            select: {
                id: true
            }
        }))?.id ?? null;
        const { user, employee } = await this.prisma.$transaction(async (tx)=>{
            const user = await tx.user.create({
                data: {
                    email,
                    name: input.fullName,
                    roleId: role.id,
                    status: 'INVITED',
                    inviteToken,
                    inviteExpiresAt: new Date(Date.now() + 7 * 86400_000)
                }
            });
            const employee = await tx.employee.create({
                data: {
                    userId: user.id,
                    empCode,
                    firstName,
                    lastName,
                    fullName: input.fullName.trim(),
                    officialEmail: email,
                    personalEmail: input.personalEmail ?? null,
                    phone: input.phone,
                    departmentId: dept.id,
                    designationId: desig.id,
                    branchId,
                    managerId: input.managerId ?? null,
                    employmentType: input.employmentType,
                    workMode: input.workMode,
                    shiftId: input.shiftId ?? null,
                    workLocationId: input.workLocationId ?? null,
                    photoFileId: input.photoFileId ?? null,
                    status: input.skipOnboarding ? 'ACTIVE' : 'ONBOARDING',
                    joiningDate: (0, _peopleutil.toDbDate)(input.joiningDate)
                }
            });
            return {
                user,
                employee
            };
        });
        if (!input.skipOnboarding) await this.onboarding.createFor(employee.id);
        await this.kits.ensureIssue(employee.id);
        const card = await this.idcards.ensureCard(employee.id);
        await this.vcard.ensureProfile(employee.id, employee.fullName);
        if (opts.resumeFileId) {
            await this.prisma.employeeDocument.create({
                data: {
                    employeeId: employee.id,
                    category: 'CAREER',
                    docType: 'RESUME',
                    title: 'Resume',
                    fileId: opts.resumeFileId,
                    source: 'RECRUITMENT',
                    verificationStatus: 'NOT_REQUIRED'
                }
            });
        }
        let inviteSent = false;
        if (input.sendInvite !== false) inviteSent = await this.sendInvite(employee.id, inviteToken, input.personalEmail ?? email, input.fullName, !!input.skipOnboarding);
        if (input.managerId) {
            await this.notify.notify({
                userIds: await this.notify.usersForEmployees([
                    input.managerId
                ]),
                type: 'people.newReport',
                title: `${input.fullName} joins your team on ${(0, _peopleutil.fmt)(input.joiningDate)}`,
                body: `${desig.name} · ${dept.name} · ${empCode}`,
                link: `/employees/${employee.id}`,
                from: 'HR'
            });
        }
        await this.audit.record({
            action: 'employee.created',
            entity: 'Employee',
            entityId: employee.id,
            meta: {
                empCode,
                sourceApplicationId: opts.sourceApplicationId ?? null,
                by: ctx.userName ?? null
            }
        });
        this.events.emit('employee.created', {
            employeeId: employee.id
        });
        this.log.log(`Employee ${empCode} created (${user.email})`);
        return {
            employee: {
                id: employee.id,
                empCode,
                fullName: employee.fullName
            },
            inviteSent,
            idCardStatus: card.status
        };
    }
    async sendInvite(employeeId, inviteToken, to, name, existing) {
        const link = `${_env.env.WEB_ORIGIN}/accept-invite?token=${encodeURIComponent(inviteToken)}`;
        const t = await this.prisma.raw.tenant.findUnique({
            where: {
                id: (0, _requestcontext.requireContext)().tenantId
            }
        });
        const company = t?.brandName ?? t?.name ?? 'Lexisora';
        const ok = await this.mail.send({
            to,
            subject: existing ? `Your ${company} HRMS account` : `Welcome to ${company} · start your paperless onboarding`,
            text: existing ? `Hi ${name},\n\nYour account on ${company} HRMS is ready. Set your password here (valid for 7 days):\n${link}\n\n— ${company} HR` : `Hi ${name},\n\nWelcome to ${company}! Before day one, please sign your offer letter and NDA, upload your documents, add bank details and pick your welcome-kit size.\n\nSet your password to begin (link valid for 7 days):\n${link}\n\n— ${company} HR`,
            html: `<p>Hi ${escapeHtml(name)},</p><p>${existing ? `Your account on ${escapeHtml(company)} HRMS is ready.` : `Welcome to ${escapeHtml(company)}! Complete your paperless onboarding before day one: sign your offer letter and NDA, upload documents, add bank details and pick your welcome-kit size.`}</p><p><a href="${link}">Set your password &amp; ${existing ? 'sign in' : 'start onboarding'}</a> (valid for 7 days)</p><p>— ${escapeHtml(company)} HR</p>`
        });
        if (ok) await this.prisma.onboarding.updateMany({
            where: {
                employeeId
            },
            data: {
                invitedAt: new Date()
            }
        });
        return ok;
    }
    async resendInvite(id) {
        const e = await this.prisma.employee.findUnique({
            where: {
                id
            },
            include: {
                user: true
            }
        });
        if (!e?.user) throw (0, _errors.notFound)('Employee');
        if (e.user.status !== 'INVITED') throw (0, _errors.badRequest)(`${e.fullName} has already accepted the invite`, 'INVITE_ACCEPTED');
        const inviteToken = (0, _peopleutil.token)(32);
        await this.prisma.user.update({
            where: {
                id: e.user.id
            },
            data: {
                inviteToken,
                inviteExpiresAt: new Date(Date.now() + 7 * 86400_000)
            }
        });
        const ok = await this.sendInvite(e.id, inviteToken, e.personalEmail ?? e.officialEmail, e.fullName, e.status !== 'ONBOARDING');
        await this.audit.record({
            action: 'employee.invite_resent',
            entity: 'Employee',
            entityId: e.id
        });
        return {
            inviteSent: ok
        };
    }
    // ── Update ───────────────────────────────────────────────────────────────
    async update(id, dto) {
        const before = await this.prisma.employee.findUnique({
            where: {
                id
            }
        });
        if (!before) throw (0, _errors.notFound)('Employee');
        if (dto.managerId !== undefined) await this.assertManager(dto.managerId, id);
        const data = {};
        const changed = {};
        const set = (k, v)=>{
            const old = before[k];
            const oldCmp = old instanceof Date ? (0, _peopleutil.dbDateKey)(old) : old;
            const newCmp = v instanceof Date ? (0, _peopleutil.dbDateKey)(v) : v;
            if (oldCmp !== newCmp) {
                data[k] = v;
                changed[k] = [
                    oldCmp ?? null,
                    newCmp ?? null
                ];
            }
        };
        for (const [k, v] of Object.entries(dto)){
            if (v === undefined) continue;
            if (k === 'joiningDate' || k === 'dateOfBirth') set(k, v ? (0, _peopleutil.toDbDate)(v) : null);
            else set(k, v);
        }
        if (dto.fullName) {
            const n = (0, _peopleutil.splitName)(dto.fullName);
            data.firstName = n.firstName;
            data.lastName = n.lastName;
        }
        if (!Object.keys(changed).length) return {
            ok: true,
            changed: {}
        };
        await this.prisma.employee.update({
            where: {
                id
            },
            data
        });
        if (dto.fullName) await this.prisma.user.updateMany({
            where: {
                id: before.userId ?? ''
            },
            data: {
                name: dto.fullName
            }
        });
        await this.audit.record({
            action: 'employee.updated',
            entity: 'Employee',
            entityId: id,
            meta: {
                changed: changed
            }
        });
        this.events.emit('employee.updated', {
            employeeId: id,
            changed
        });
        await this.idcards.refresh(id);
        return {
            ok: true,
            changed
        };
    }
    async updateSelf(dto) {
        const me = this.access.meId();
        if (!me) throw (0, _errors.notFound)('Employee');
        const allowed = {};
        for (const k of [
            'phone',
            'personalEmail',
            'bloodGroup',
            'maritalStatus',
            'address',
            'emergencyContactName',
            'emergencyContactPhone',
            'photoFileId'
        ]){
            if (dto[k] !== undefined) allowed[k] = dto[k];
        }
        return this.update(me, allowed);
    }
    // ── Lifecycle: notice, exit, conversion ──────────────────────────────────
    async setStatus(id, from, to, extra = {}) {
        await this.prisma.employee.update({
            where: {
                id
            },
            data: {
                status: to,
                ...extra
            }
        });
        await this.audit.record({
            action: 'employee.status_changed',
            entity: 'Employee',
            entityId: id,
            meta: {
                from,
                to
            }
        });
        this.events.emit('employee.statusChanged', {
            employeeId: id,
            from,
            to
        });
    }
    async startExit(id, dto) {
        const e = await this.prisma.employee.findUnique({
            where: {
                id
            }
        });
        if (!e) throw (0, _errors.notFound)('Employee');
        if (e.status !== 'ACTIVE' && e.status !== 'ONBOARDING') throw (0, _errors.conflict)(`${e.fullName} is ${(0, _peoplerules.employeeStatusLabel)(e.status, e.employmentType).toLowerCase()}`, 'INVALID_STATUS');
        const notice = (0, _peoplerules.defaultNoticeDays)(e.employmentType, (0, _peopleutil.dbDateKey)(e.joiningDate), (0, _peopleutil.todayKey)());
        let lwd;
        try {
            lwd = (0, _peoplerules.computeLwd)(dto.resignationDate, notice, dto.lastWorkingDay);
        } catch (err) {
            throw (0, _errors.badRequest)(err.message, 'LWD_INVALID');
        }
        const assigned = await this.prisma.asset.count({
            where: {
                currentAssigneeId: id,
                status: 'ASSIGNED',
                deletedAt: null
            }
        });
        const exitCase = await this.prisma.exitCase.create({
            data: {
                employeeId: id,
                exitType: dto.exitType,
                resignationDate: (0, _peopleutil.toDbDate)(dto.resignationDate),
                lastWorkingDay: (0, _peopleutil.toDbDate)(lwd.lastWorkingDay),
                noticeShortfallDays: lwd.shortfallDays,
                reason: dto.reason ?? null,
                items: {
                    create: _peoplerules.EXIT_CHECKLIST.map((c, i)=>({
                            tenantId: (0, _requestcontext.requireContext)().tenantId,
                            key: c.key,
                            label: c.label,
                            ownerRole: c.ownerRole,
                            blocking: c.blocking,
                            auto: c.auto,
                            order: i,
                            status: c.key === 'ASSET_RETURN' && assigned === 0 ? 'DONE' : 'PENDING'
                        }))
                }
            }
        });
        await this.setStatus(id, e.status, 'NOTICE_PERIOD', {
            noticeStartDate: (0, _peopleutil.toDbDate)(dto.resignationDate),
            exitDate: (0, _peopleutil.toDbDate)(lwd.lastWorkingDay),
            exitReason: dto.reason ?? null
        });
        await this.audit.record({
            action: 'employee.exit_started',
            entity: 'Employee',
            entityId: id,
            meta: {
                exitCaseId: exitCase.id,
                lwd: lwd.lastWorkingDay
            }
        });
        const mgrUsers = await this.notify.usersForEmployees([
            e.managerId
        ]);
        await this.notify.notify({
            userIds: mgrUsers,
            type: 'people.exitStarted',
            title: `${e.fullName} is serving notice · last day ${(0, _peopleutil.fmt)(lwd.lastWorkingDay)}`,
            body: 'Plan the knowledge transfer and reassign work before the last working day.',
            link: `/employees/${id}`,
            from: 'HR'
        });
        return this.exitCaseDto(id);
    }
    async exitCaseDto(employeeId) {
        const c = await this.prisma.exitCase.findFirst({
            where: {
                employeeId,
                status: {
                    in: [
                        'OPEN',
                        'COMPLETED'
                    ]
                }
            },
            orderBy: {
                createdAt: 'desc'
            },
            include: {
                items: {
                    orderBy: {
                        order: 'asc'
                    }
                }
            }
        });
        if (!c) return null;
        const assigned = await this.prisma.asset.count({
            where: {
                currentAssigneeId: employeeId,
                status: 'ASSIGNED',
                deletedAt: null
            }
        });
        // Keep the derived asset item in sync.
        const assetItem = c.items.find((i)=>i.key === 'ASSET_RETURN');
        if (assetItem && c.status === 'OPEN') {
            const want = assigned === 0 ? 'DONE' : 'PENDING';
            if (assetItem.status !== want) {
                await this.prisma.exitChecklistItem.update({
                    where: {
                        id: assetItem.id
                    },
                    data: {
                        status: want,
                        doneAt: want === 'DONE' ? new Date() : null,
                        doneByName: want === 'DONE' ? 'System' : null
                    }
                });
                assetItem.status = want;
            }
        }
        const blockers = (0, _peoplerules.exitBlockers)(c.items, assigned);
        return {
            id: c.id,
            exitType: c.exitType,
            resignationDate: (0, _peopleutil.dbDateKey)(c.resignationDate),
            lastWorkingDay: (0, _peopleutil.dbDateKey)(c.lastWorkingDay),
            noticeShortfallDays: c.noticeShortfallDays,
            reason: c.reason,
            status: c.status,
            items: c.items.map((i)=>({
                    key: i.key,
                    label: i.key === 'ASSET_RETURN' && assigned ? `${i.label} · ${assigned} pending` : i.label,
                    ownerRole: i.ownerRole,
                    blocking: i.blocking,
                    auto: i.auto,
                    status: i.status,
                    doneByName: i.doneByName,
                    doneAt: i.doneAt?.toISOString() ?? null,
                    note: i.note
                })),
            canComplete: c.status === 'OPEN' && blockers.length === 0,
            blockers
        };
    }
    async updateChecklist(employeeId, key, status, note) {
        const ctx = (0, _requestcontext.requireContext)();
        const c = await this.prisma.exitCase.findFirst({
            where: {
                employeeId,
                status: 'OPEN'
            },
            include: {
                items: true
            }
        });
        if (!c) throw (0, _errors.notFound)('Exit case');
        const item = c.items.find((i)=>i.key === key);
        if (!item) throw (0, _errors.notFound)('Checklist item');
        if (item.key === 'ASSET_RETURN') throw (0, _errors.badRequest)('Asset return ticks itself when every assigned asset is returned', 'AUTO_ITEM');
        // The manager may tick the KT item; everything else is HR.
        if (!(0, _peopleaccess.isHr)(ctx)) {
            const e = await this.prisma.employee.findUnique({
                where: {
                    id: employeeId
                },
                select: {
                    managerId: true
                }
            });
            if (!(key === 'KT_HANDOVER' && e?.managerId && e.managerId === ctx.employeeId)) throw new _errors.AppError(403, 'FORBIDDEN', 'Only HR can update this item');
        }
        if (status === 'NA' && item.blocking && ![
            'ABSCONDING',
            'TERMINATION'
        ].includes(c.exitType)) throw (0, _errors.badRequest)('Blocking items cannot be skipped for this exit type', 'BLOCKING_ITEM');
        await this.prisma.exitChecklistItem.update({
            where: {
                id: item.id
            },
            data: {
                status,
                note: note ?? item.note,
                doneAt: status === 'PENDING' ? null : new Date(),
                doneByName: status === 'PENDING' ? null : ctx.userName ?? null
            }
        });
        if (key === 'IDCARD_SURRENDER' && status === 'DONE') await this.idcards.surrender(employeeId);
        await this.audit.record({
            action: 'employee.exit_checklist',
            entity: 'Employee',
            entityId: employeeId,
            meta: {
                key,
                status
            }
        });
        return this.exitCaseDto(employeeId);
    }
    async withdrawExit(id) {
        const e = await this.prisma.employee.findUnique({
            where: {
                id
            }
        });
        if (!e || e.status !== 'NOTICE_PERIOD') throw (0, _errors.conflict)('Only employees serving notice can withdraw', 'INVALID_STATUS');
        await this.prisma.exitCase.updateMany({
            where: {
                employeeId: id,
                status: 'OPEN'
            },
            data: {
                status: 'WITHDRAWN'
            }
        });
        await this.setStatus(id, e.status, 'ACTIVE', {
            noticeStartDate: null,
            exitDate: null,
            exitReason: null
        });
        await this.audit.record({
            action: 'employee.exit_withdrawn',
            entity: 'Employee',
            entityId: id
        });
        return {
            ok: true
        };
    }
    async completeExit(id, overrideReason) {
        const e = await this.prisma.employee.findUnique({
            where: {
                id
            }
        });
        if (!e || e.status !== 'NOTICE_PERIOD') throw (0, _errors.conflict)('Start the exit before completing it', 'INVALID_STATUS');
        const dto = await this.exitCaseDto(id);
        if (!dto) throw (0, _errors.notFound)('Exit case');
        const assetsHeld = await this.prisma.asset.count({
            where: {
                currentAssigneeId: id,
                status: 'ASSIGNED',
                deletedAt: null
            }
        });
        if (dto.blockers.length) {
            const overridable = [
                'ABSCONDING',
                'TERMINATION'
            ].includes(dto.exitType) && !!overrideReason && assetsHeld === 0;
            if (!overridable) throw new _errors.AppError(409, 'EXIT_BLOCKED', `Complete these first: ${dto.blockers.join(', ')}`, dto.blockers);
        }
        const reports = await this.prisma.employee.count({
            where: {
                managerId: id,
                status: {
                    not: 'EXITED'
                }
            }
        });
        if (reports) throw new _errors.AppError(409, 'REPORTS_ASSIGNED', `Reassign ${reports} direct report${reports === 1 ? '' : 's'} before completing the exit`);
        await this.prisma.exitCase.update({
            where: {
                id: dto.id
            },
            data: {
                status: 'COMPLETED',
                completedAt: new Date()
            }
        });
        await this.prisma.exitChecklistItem.updateMany({
            where: {
                exitCaseId: dto.id,
                key: 'ACCESS_REVOKE'
            },
            data: {
                status: 'DONE',
                doneAt: new Date(),
                doneByName: 'System'
            }
        });
        await this.setStatus(id, e.status, 'EXITED', {
            exitDate: (0, _peopleutil.toDbDate)(dto.lastWorkingDay)
        });
        if (e.userId) {
            await this.prisma.user.update({
                where: {
                    id: e.userId
                },
                data: {
                    status: 'DISABLED'
                }
            });
            await this.prisma.refreshToken.updateMany({
                where: {
                    userId: e.userId,
                    revokedAt: null
                },
                data: {
                    revokedAt: new Date()
                }
            });
        }
        await this.idcards.revokeForExit(id);
        await this.vcard.disablePublic(id);
        await this.audit.record({
            action: 'employee.exited',
            entity: 'Employee',
            entityId: id,
            meta: {
                overrideReason: overrideReason ?? null
            }
        });
        return {
            ok: true
        };
    }
    async convertIntern(id, effectiveDate, designationId) {
        const e = await this.prisma.employee.findUnique({
            where: {
                id
            }
        });
        if (!e) throw (0, _errors.notFound)('Employee');
        if (e.employmentType !== 'INTERN' || e.status === 'EXITED') throw (0, _errors.conflict)('Only active interns can be converted', 'INVALID_STATUS');
        if (!await this.prisma.designation.findUnique({
            where: {
                id: designationId
            }
        })) throw (0, _errors.badRequest)('Pick a designation');
        const newCode = await this.nextEmpCode('FULL_TIME');
        await this.prisma.employee.update({
            where: {
                id
            },
            data: {
                employmentType: 'FULL_TIME',
                empCode: newCode,
                designationId,
                confirmationDate: null
            }
        });
        await this.audit.record({
            action: 'employee.converted',
            entity: 'Employee',
            entityId: id,
            meta: {
                oldCode: e.empCode,
                newCode,
                effectiveDate
            }
        });
        await this.idcards.reissue(id, 'DATA_CHANGE');
        this.events.emit('employee.updated', {
            employeeId: id,
            changed: {
                employmentType: [
                    'INTERN',
                    'FULL_TIME'
                ],
                empCode: [
                    e.empCode,
                    newCode
                ]
            },
            effectiveFrom: effectiveDate
        });
        return {
            empCode: newCode,
            previousCode: e.empCode
        };
    }
    /** Daily 00:05 IST: joiners become ACTIVE on their joining date; HR is told if onboarding is incomplete. */ async dailyLifecycle() {
        const today = (0, _peopleutil.toDbDate)((0, _peopleutil.todayKey)());
        const due = await this.prisma.employee.findMany({
            where: {
                status: 'ONBOARDING',
                joiningDate: {
                    lte: today
                }
            }
        });
        const hr = await this.notify.usersWithPermission('onboarding.manage');
        for (const e of due){
            await this.setStatus(e.id, 'ONBOARDING', 'ACTIVE');
            const ob = await this.prisma.onboarding.findUnique({
                where: {
                    employeeId: e.id
                }
            });
            if (ob && ob.status !== 'COMPLETED' && ob.status !== 'SUBMITTED') {
                await this.notify.notify({
                    userIds: hr,
                    type: 'people.onboardingIncomplete',
                    title: `Onboarding incomplete for ${e.fullName}`,
                    body: `${e.empCode} joined today with onboarding still open.`,
                    link: `/onboarding?employee=${e.id}`,
                    from: 'System',
                    email: true
                });
            }
        }
        return due.length;
    }
    // ── CSV import ───────────────────────────────────────────────────────────
    templateCsv() {
        return [
            _shared.EMPLOYEE_CSV_HEADERS.join(','),
            'Aditya Kulkarni,aditya.kulkarni@lexisora.com,+91 98250 11111,Development,React Developer,neha.kapoor@lexisora.com,Full-time,Remote,2026-10-12,aditya.k@gmail.com,Ahmedabad',
            'Tanvi Shah,tanvi.shah@lexisora.com,+91 98250 22222,Design,Intern,vikram.joshi@lexisora.com,Intern,Office,12-10-2026,,Pune'
        ].join('\n');
    }
    async validateImport(file, createMissingMasters) {
        if (!file) throw (0, _errors.badRequest)('Attach a CSV file');
        if (file.buffer.length > 5 * 1024 * 1024) throw (0, _errors.badRequest)('CSV files are limited to 5 MB', 'FILE_TOO_LARGE');
        let raw;
        try {
            raw = parseCsv(file.buffer, {
                columns: (h)=>h.map((x)=>x.trim().toLowerCase().replace(/[\s-]+/g, '_')),
                skip_empty_lines: true,
                trim: true,
                bom: true,
                relax_column_count: true
            });
        } catch (e) {
            throw (0, _errors.badRequest)(`Could not read the CSV: ${e.message}`, 'CSV_INVALID');
        }
        if (!raw.length) throw (0, _errors.badRequest)('The CSV has no data rows', 'CSV_EMPTY');
        if (raw.length > 5000) throw (0, _errors.badRequest)('Import at most 5,000 rows at a time', 'CSV_TOO_LARGE');
        const [depts, desigs, branches, emps] = await Promise.all([
            this.prisma.department.findMany(),
            this.prisma.designation.findMany(),
            this.prisma.branch.findMany(),
            this.prisma.employee.findMany({
                select: {
                    id: true,
                    officialEmail: true,
                    status: true
                }
            })
        ]);
        const { valid, errors } = (0, _peoplerules.validateCsvRows)(raw, {
            departments: new Map(depts.map((d)=>[
                    d.name.toLowerCase(),
                    d.id
                ])),
            designations: new Map(desigs.map((d)=>[
                    d.name.toLowerCase(),
                    d.id
                ])),
            branches: new Map(branches.map((d)=>[
                    d.name.toLowerCase(),
                    d.id
                ])),
            managersByEmail: new Map(emps.filter((e)=>e.status !== 'EXITED').map((e)=>[
                    e.officialEmail.toLowerCase(),
                    e.id
                ])),
            existingEmails: new Set(emps.map((e)=>e.officialEmail.toLowerCase())),
            createMissingMasters,
            today: (0, _peopleutil.todayKey)()
        });
        const imp = await this.prisma.employeeImport.create({
            data: {
                filename: file.originalname,
                options: {
                    createMissingMasters,
                    raw: raw.slice(0, 200).map((r, i)=>({
                            row: i + 1,
                            fullName: r.full_name ?? '',
                            officialEmail: r.official_email ?? '',
                            department: r.department ?? '',
                            employmentType: r.employment_type ?? ''
                        }))
                },
                totalRows: raw.length,
                validRows: valid.length,
                rows: valid,
                rowErrors: errors,
                createdByUserId: (0, _requestcontext.requireContext)().userId ?? null
            }
        });
        await this.audit.record({
            action: 'employee.import_validated',
            entity: 'EmployeeImport',
            entityId: imp.id,
            meta: {
                total: raw.length,
                valid: valid.length
            }
        });
        return this.importDto(imp.id);
    }
    async importDto(id) {
        const imp = await this.prisma.employeeImport.findUnique({
            where: {
                id
            }
        });
        if (!imp) throw (0, _errors.notFound)('Import');
        const valid = imp.rows;
        const errors = imp.rowErrors;
        const errRows = new Set(errors.map((e)=>e.row));
        const preview = [
            ...valid.map((v)=>({
                    row: v.row,
                    fullName: v.fullName,
                    officialEmail: v.officialEmail,
                    department: v.department,
                    employmentType: v.employmentType,
                    ok: true
                })),
            ...[
                ...errRows
            ].map((row)=>{
                const r = (imp.options?.raw ?? []).find((x)=>x.row === row);
                return {
                    row,
                    fullName: r?.fullName ?? '',
                    officialEmail: r?.officialEmail ?? '',
                    department: r?.department ?? '',
                    employmentType: r?.employmentType ?? '',
                    ok: false
                };
            })
        ].sort((a, b)=>a.row - b.row);
        return {
            id: imp.id,
            filename: imp.filename,
            totalRows: imp.totalRows,
            validRows: imp.validRows,
            errors,
            preview: preview.slice(0, 200),
            status: imp.status,
            importedRows: imp.importedRows
        };
    }
    async commitImport(id, opts) {
        const imp = await this.prisma.employeeImport.findUnique({
            where: {
                id
            }
        });
        if (!imp) throw (0, _errors.notFound)('Import');
        if (imp.status === 'DONE') return this.importDto(id); // idempotent re-commit
        const rows = (0, _peoplerules.orderByManager)(imp.rows);
        const createdByEmail = new Map();
        const extraErrors = [];
        let imported = 0;
        for (const r of rows){
            try {
                if (await this.prisma.employee.findFirst({
                    where: {
                        officialEmail: r.officialEmail
                    },
                    select: {
                        id: true
                    }
                })) {
                    imported++; // already imported by an earlier partial run
                    continue;
                }
                const departmentId = r.departmentId ?? (opts.createMissingMasters ? await this.ensureMaster('department', r.department) : null);
                const designationId = r.designationId ?? (opts.createMissingMasters ? await this.ensureMaster('designation', r.designation) : null);
                const branchId = r.branchId ?? (r.branch && opts.createMissingMasters ? await this.ensureMaster('branch', r.branch) : null);
                if (!departmentId || !designationId) throw new Error('Department or designation missing');
                const managerId = r.managerId ?? (r.managerEmail ? createdByEmail.get(r.managerEmail) ?? null : null);
                const res = await this.create({
                    fullName: r.fullName,
                    officialEmail: r.officialEmail,
                    personalEmail: r.personalEmail,
                    phone: r.phone,
                    departmentId,
                    designationId,
                    branchId,
                    managerId,
                    employmentType: r.employmentType,
                    workMode: r.workMode,
                    joiningDate: r.joiningDate,
                    skipOnboarding: r.joiningDate < (0, _peopleutil.todayKey)(),
                    sendInvite: opts.sendInvites
                });
                createdByEmail.set(r.officialEmail, res.employee.id);
                imported++;
            } catch (e) {
                extraErrors.push({
                    row: r.row,
                    message: e.message
                });
            }
        }
        const allErrors = [
            ...imp.rowErrors,
            ...extraErrors
        ].sort((a, b)=>a.row - b.row);
        await this.prisma.employeeImport.update({
            where: {
                id
            },
            data: {
                status: 'DONE',
                importedRows: imported,
                committedAt: new Date(),
                rowErrors: allErrors
            }
        });
        await this.audit.record({
            action: 'employee.imported',
            entity: 'EmployeeImport',
            entityId: id,
            meta: {
                imported
            }
        });
        return this.importDto(id);
    }
    async importErrorsCsv(id) {
        const imp = await this.prisma.employeeImport.findUnique({
            where: {
                id
            }
        });
        if (!imp) throw (0, _errors.notFound)('Import');
        const errors = imp.rowErrors;
        return [
            'row,field,message',
            ...errors.map((e)=>[
                    e.row,
                    e.field ?? '',
                    e.message
                ].map(_peoplerules.csvEscape).join(','))
        ].join('\n');
    }
    async ensureMaster(kind, name) {
        const m = this.prisma[kind];
        const found = await m.findFirst({
            where: {
                name: {
                    equals: name,
                    mode: 'insensitive'
                }
            }
        });
        if (found) return found.id;
        const created = await m.create({
            data: {
                name
            }
        });
        await this.audit.record({
            action: 'master.created',
            entity: kind,
            entityId: created.id,
            meta: {
                name,
                via: 'import'
            }
        });
        return created.id;
    }
};
EmployeesService = _ts_decorate([
    (0, _common.Injectable)(),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _prismaservice.PrismaService === "undefined" ? Object : _prismaservice.PrismaService,
        typeof _sequenceservice.SequenceService === "undefined" ? Object : _sequenceservice.SequenceService,
        typeof _mailservice.MailService === "undefined" ? Object : _mailservice.MailService,
        typeof _notificationsservice.NotificationsService === "undefined" ? Object : _notificationsservice.NotificationsService,
        typeof _auditservice.AuditService === "undefined" ? Object : _auditservice.AuditService,
        typeof _eventsservice.EventsService === "undefined" ? Object : _eventsservice.EventsService,
        typeof _peopleaccess.PeopleAccess === "undefined" ? Object : _peopleaccess.PeopleAccess,
        typeof _onboardingservice.OnboardingService === "undefined" ? Object : _onboardingservice.OnboardingService,
        typeof _idcardsservice.IdCardsService === "undefined" ? Object : _idcardsservice.IdCardsService,
        typeof _kitsservice.KitsService === "undefined" ? Object : _kitsservice.KitsService,
        typeof _vcardservice.VcardService === "undefined" ? Object : _vcardservice.VcardService
    ])
], EmployeesService);
function escapeHtml(s) {
    return s.replace(/[&<>"']/g, (c)=>({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;'
        })[c]);
}

//# sourceMappingURL=employees.service.js.map