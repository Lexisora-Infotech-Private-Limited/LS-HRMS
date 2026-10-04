"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "LeavepayModule", {
    enumerable: true,
    get: function() {
        return LeavepayModule;
    }
});
const _common = require("@nestjs/common");
const _timemodule = require("../time/time.module");
const _prismaservice = require("../../core/prisma/prisma.service");
const _lookups = require("../../core/lookups/lookups");
const _registries = require("../../core/registry/registries");
const _eventsservice = require("../../core/registry/events.service");
const _requestcontext = require("../../core/context/request-context");
const _filescontroller = require("../../core/storage/files.controller");
const _calendarservice = require("./common/calendar.service");
const _leaveledgerservice = require("./leave/leave-ledger.service");
const _leaverequestsservice = require("./leave/leave-requests.service");
const _leaveadminservice = require("./leave/leave-admin.service");
const _leavecontroller = require("./leave/leave.controller");
const _leavejobs = require("./leave/leave.jobs");
const _salaryservice = require("./payroll/salary.service");
const _payrollengineservice = require("./payroll/payroll-engine.service");
const _payrollservice = require("./payroll/payroll.service");
const _payslipservice = require("./payroll/payslip.service");
const _periodlockport = require("./payroll/period-lock.port");
const _payrollcontroller = require("./payroll/payroll.controller");
const _dates = require("./common/dates");
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
let LeavepayModule = class LeavepayModule {
    prisma;
    lookups;
    approvals;
    search;
    events;
    requests;
    admin;
    payroll;
    constructor(prisma, lookups, approvals, search, events, requests, admin, payroll){
        this.prisma = prisma;
        this.lookups = lookups;
        this.approvals = approvals;
        this.search = search;
        this.events = events;
        this.requests = requests;
        this.admin = admin;
        this.payroll = payroll;
    }
    onModuleInit() {
        this.lookups.register('leaveTypes', async ()=>{
            const ctx = (0, _requestcontext.getContext)();
            const hr = !!ctx && (ctx.permissions.has('*') || ctx.permissions.has('leave.manage'));
            const rows = await this.prisma.leaveType.findMany({
                where: {
                    active: true,
                    ...hr ? {} : {
                        hidden: false
                    }
                },
                orderBy: [
                    {
                        displayOrder: 'asc'
                    },
                    {
                        name: 'asc'
                    }
                ]
            });
            return rows.map((t)=>({
                    value: t.id,
                    label: t.name
                }));
        });
        // Dashboard "Awaiting your approval" → "Time-off requests N".
        this.approvals.register(async (ctx)=>{
            if (!ctx.employeeId) return null;
            const can = ctx.permissions.has('leave.approve') || ctx.permissions.has('leave.manage');
            const count = await this.requests.pendingCountFor(ctx.employeeId);
            if (!can && !count) return null;
            return {
                key: 'leave',
                label: 'Time-off requests',
                count,
                link: '/leave?tab=team'
            };
        });
        this.search.register('Payslips', async (q, ctx)=>{
            if (!ctx.employeeId || !/payslip|salary|pay/i.test(q)) return [];
            const rows = await this.prisma.payslip.findMany({
                where: {
                    employeeId: ctx.employeeId,
                    status: 'PUBLISHED'
                },
                orderBy: [
                    {
                        periodYear: 'desc'
                    },
                    {
                        periodMonth: 'desc'
                    }
                ],
                take: 3
            });
            return rows.map((p)=>({
                    type: 'Payslips',
                    id: p.id,
                    title: `Payslip · ${(0, _dates.periodLabel)(p.period)}`,
                    subtitle: 'My payslips',
                    link: '/payslips'
                }));
        });
        // Private files this domain references: payslip PDFs (owner or payroll), bank files (payroll), leave attachments (approver/HR).
        _filescontroller.fileAccessCheckers.push(async (fileId)=>{
            const ctx = (0, _requestcontext.requireContext)();
            const payroll = ctx.permissions.has('payroll.manage');
            const slip = await this.prisma.payslip.findFirst({
                where: {
                    fileId
                },
                select: {
                    employeeId: true,
                    status: true
                }
            });
            if (slip) return payroll || slip.employeeId === ctx.employeeId && slip.status === 'PUBLISHED';
            if (payroll && await this.prisma.bankTransferFile.count({
                where: {
                    fileId
                }
            })) return true;
            const req = await this.prisma.leaveRequest.findFirst({
                where: {
                    attachmentFileId: fileId
                },
                select: {
                    employeeId: true,
                    approverEmployeeId: true
                }
            });
            if (req) return ctx.permissions.has('leave.manage') || req.employeeId === ctx.employeeId || req.approverEmployeeId === ctx.employeeId;
            return false;
        });
        this.events.on('employee.created', async (p)=>this.admin.onEmployeeCreated(p.employeeId));
        this.events.on('timesheet.approved', async (p)=>{
            const wk = typeof p.weekStart === 'string' ? p.weekStart.slice(0, 10) : p.weekStart.toISOString().slice(0, 10);
            await this.payroll.onTimesheetApproved(p.employeeId, wk);
        });
    }
};
LeavepayModule = _ts_decorate([
    (0, _common.Module)({
        imports: [
            _timemodule.TimeModule
        ],
        controllers: [
            _leavecontroller.LeaveController,
            _payrollcontroller.PayrollController,
            _payrollcontroller.PayslipsController,
            _payrollcontroller.SalaryController
        ],
        providers: [
            _calendarservice.WorkCalendarService,
            _leaveledgerservice.LeaveLedgerService,
            _leaverequestsservice.LeaveRequestsService,
            _leaveadminservice.LeaveAdminService,
            _leavejobs.LeaveJobs,
            _salaryservice.SalaryService,
            _payrollengineservice.PayrollEngineService,
            _payrollservice.PayrollService,
            _payslipservice.PayslipService,
            _periodlockport.PeriodLockPort
        ],
        exports: [
            _leaverequestsservice.LeaveRequestsService,
            _salaryservice.SalaryService
        ]
    }),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _prismaservice.PrismaService === "undefined" ? Object : _prismaservice.PrismaService,
        typeof _lookups.LookupsService === "undefined" ? Object : _lookups.LookupsService,
        typeof _registries.ApprovalCountsService === "undefined" ? Object : _registries.ApprovalCountsService,
        typeof _registries.SearchService === "undefined" ? Object : _registries.SearchService,
        typeof _eventsservice.EventsService === "undefined" ? Object : _eventsservice.EventsService,
        typeof _leaverequestsservice.LeaveRequestsService === "undefined" ? Object : _leaverequestsservice.LeaveRequestsService,
        typeof _leaveadminservice.LeaveAdminService === "undefined" ? Object : _leaveadminservice.LeaveAdminService,
        typeof _payrollservice.PayrollService === "undefined" ? Object : _payrollservice.PayrollService
    ])
], LeavepayModule);

//# sourceMappingURL=leavepay.module.js.map