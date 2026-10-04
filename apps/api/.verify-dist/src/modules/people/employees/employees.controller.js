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
    get EmployeesController () {
        return EmployeesController;
    },
    get MastersController () {
        return MastersController;
    },
    get ProfileController () {
        return ProfileController;
    }
});
const _common = require("@nestjs/common");
const _platformexpress = require("@nestjs/platform-express");
const _multer = require("multer");
const _zod = require("zod");
const _shared = require("@lexisora/shared");
const _decorators = require("../../../core/auth/decorators");
const _errors = require("../../../core/http/errors");
const _zodpipe = require("../../../core/http/zod.pipe");
const _mastersservice = require("../masters/masters.service");
const _peopleaccess = require("../people.access");
const _employeesservice = require("./employees.service");
const _profileservice = require("./profile.service");
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
function _ts_param(paramIndex, decorator) {
    return function(target, key) {
        decorator(target, key, paramIndex);
    };
}
const sendCsv = (res, name, csv)=>{
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
    res.send('﻿' + csv);
};
let EmployeesController = class EmployeesController {
    employees;
    access;
    constructor(employees, access){
        this.employees = employees;
        this.access = access;
    }
    list(q) {
        return this.employees.list(q);
    }
    counts() {
        return this.employees.counts();
    }
    async export(q, res) {
        sendCsv(res, 'employees.csv', await this.employees.exportCsv(q));
    }
    create(dto) {
        return this.employees.create(dto);
    }
    // ── CSV import ──
    template(res) {
        sendCsv(res, 'employee-import-template.csv', this.employees.templateCsv());
    }
    validateImport(file, cmm) {
        return this.employees.validateImport(file, cmm === 'true' || cmm === '1');
    }
    importDto(id) {
        return this.employees.importDto(id);
    }
    commit(id, dto) {
        return this.employees.commitImport(id, dto);
    }
    async importErrors(id, res) {
        sendCsv(res, 'import-errors.csv', await this.employees.importErrorsCsv(id));
    }
    // ── Edit & lifecycle ──
    updateSelf(dto) {
        return this.employees.updateSelf(dto);
    }
    update(id, dto) {
        return this.employees.update(id, dto);
    }
    resendInvite(id) {
        return this.employees.resendInvite(id);
    }
    startExit(id, dto) {
        return this.employees.startExit(id, dto);
    }
    async exitCase(id) {
        const rid = this.access.resolveId(id);
        await this.access.assertCanView(rid);
        return this.employees.exitCaseDto(rid);
    }
    updateChecklist(id, key, dto) {
        return this.employees.updateChecklist(id, key, dto.status, dto.note);
    }
    withdrawExit(id) {
        return this.employees.withdrawExit(id);
    }
    completeExit(id, dto) {
        return this.employees.completeExit(id, dto.overrideReason);
    }
    convert(id, dto) {
        return this.employees.convertIntern(id, dto.effectiveDate, dto.designationId);
    }
};
_ts_decorate([
    (0, _common.Get)(),
    (0, _decorators.RequirePerm)('employees.view', 'employees.manage'),
    _ts_param(0, (0, _common.Query)(new _zodpipe.ZodPipe(_shared.employeeListQuery))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof EmployeeListQuery === "undefined" ? Object : EmployeeListQuery
    ]),
    _ts_metadata("design:returntype", void 0)
], EmployeesController.prototype, "list", null);
_ts_decorate([
    (0, _common.Get)('counts'),
    (0, _decorators.RequirePerm)('employees.view', 'employees.manage'),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", []),
    _ts_metadata("design:returntype", void 0)
], EmployeesController.prototype, "counts", null);
_ts_decorate([
    (0, _common.Get)('export'),
    (0, _decorators.RequirePerm)('employees.view', 'employees.manage'),
    _ts_param(0, (0, _common.Query)(new _zodpipe.ZodPipe(_shared.employeeListQuery))),
    _ts_param(1, (0, _common.Res)()),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof EmployeeListQuery === "undefined" ? Object : EmployeeListQuery,
        typeof Response === "undefined" ? Object : Response
    ]),
    _ts_metadata("design:returntype", Promise)
], EmployeesController.prototype, "export", null);
_ts_decorate([
    (0, _common.Post)(),
    (0, _decorators.RequirePerm)('employees.manage'),
    _ts_param(0, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.createEmployeeSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof CreateEmployeeInput === "undefined" ? Object : CreateEmployeeInput
    ]),
    _ts_metadata("design:returntype", void 0)
], EmployeesController.prototype, "create", null);
_ts_decorate([
    (0, _common.Get)('import/template'),
    (0, _decorators.RequirePerm)('employees.manage'),
    _ts_param(0, (0, _common.Res)()),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof Response === "undefined" ? Object : Response
    ]),
    _ts_metadata("design:returntype", void 0)
], EmployeesController.prototype, "template", null);
_ts_decorate([
    (0, _common.Post)('import'),
    (0, _decorators.RequirePerm)('employees.manage'),
    (0, _common.UseInterceptors)((0, _platformexpress.FileInterceptor)('file', {
        storage: (0, _multer.memoryStorage)(),
        limits: {
            fileSize: 5 * 1024 * 1024
        }
    })),
    _ts_param(0, (0, _common.UploadedFile)()),
    _ts_param(1, (0, _common.Body)('createMissingMasters')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        Object,
        String
    ]),
    _ts_metadata("design:returntype", void 0)
], EmployeesController.prototype, "validateImport", null);
_ts_decorate([
    (0, _common.Get)('import/:id'),
    (0, _decorators.RequirePerm)('employees.manage'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String
    ]),
    _ts_metadata("design:returntype", void 0)
], EmployeesController.prototype, "importDto", null);
_ts_decorate([
    (0, _common.Post)('import/:id/commit'),
    (0, _decorators.RequirePerm)('employees.manage'),
    (0, _common.HttpCode)(200),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_param(1, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.importCommitSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        typeof _zod.z === "undefined" || typeof _zod.z.infer === "undefined" ? Object : _zod.z.infer
    ]),
    _ts_metadata("design:returntype", void 0)
], EmployeesController.prototype, "commit", null);
_ts_decorate([
    (0, _common.Get)('import/:id/errors.csv'),
    (0, _decorators.RequirePerm)('employees.manage'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_param(1, (0, _common.Res)()),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        typeof Response === "undefined" ? Object : Response
    ]),
    _ts_metadata("design:returntype", Promise)
], EmployeesController.prototype, "importErrors", null);
_ts_decorate([
    (0, _common.Patch)('me'),
    _ts_param(0, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.updateSelfSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof UpdateSelfInput === "undefined" ? Object : UpdateSelfInput
    ]),
    _ts_metadata("design:returntype", void 0)
], EmployeesController.prototype, "updateSelf", null);
_ts_decorate([
    (0, _common.Patch)(':id'),
    (0, _decorators.RequirePerm)('employees.manage'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_param(1, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.updateEmployeeSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        typeof UpdateEmployeeInput === "undefined" ? Object : UpdateEmployeeInput
    ]),
    _ts_metadata("design:returntype", void 0)
], EmployeesController.prototype, "update", null);
_ts_decorate([
    (0, _common.Post)(':id/invite'),
    (0, _decorators.RequirePerm)('employees.manage'),
    (0, _common.HttpCode)(200),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String
    ]),
    _ts_metadata("design:returntype", void 0)
], EmployeesController.prototype, "resendInvite", null);
_ts_decorate([
    (0, _common.Post)(':id/exit'),
    (0, _decorators.RequirePerm)('employees.manage'),
    (0, _common.HttpCode)(200),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_param(1, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.startExitSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        typeof StartExitInput === "undefined" ? Object : StartExitInput
    ]),
    _ts_metadata("design:returntype", void 0)
], EmployeesController.prototype, "startExit", null);
_ts_decorate([
    (0, _common.Get)(':id/exit'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String
    ]),
    _ts_metadata("design:returntype", Promise)
], EmployeesController.prototype, "exitCase", null);
_ts_decorate([
    (0, _common.Put)(':id/exit/checklist/:key'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_param(1, (0, _common.Param)('key')),
    _ts_param(2, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.exitStatusSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        String,
        typeof _zod.z === "undefined" || typeof _zod.z.infer === "undefined" ? Object : _zod.z.infer
    ]),
    _ts_metadata("design:returntype", void 0)
], EmployeesController.prototype, "updateChecklist", null);
_ts_decorate([
    (0, _common.Post)(':id/exit/withdraw'),
    (0, _decorators.RequirePerm)('employees.manage'),
    (0, _common.HttpCode)(200),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String
    ]),
    _ts_metadata("design:returntype", void 0)
], EmployeesController.prototype, "withdrawExit", null);
_ts_decorate([
    (0, _common.Post)(':id/exit/complete'),
    (0, _decorators.RequirePerm)('employees.manage'),
    (0, _common.HttpCode)(200),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_param(1, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.completeExitSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        typeof _zod.z === "undefined" || typeof _zod.z.infer === "undefined" ? Object : _zod.z.infer
    ]),
    _ts_metadata("design:returntype", void 0)
], EmployeesController.prototype, "completeExit", null);
_ts_decorate([
    (0, _common.Post)(':id/convert'),
    (0, _decorators.RequirePerm)('employees.manage'),
    (0, _common.HttpCode)(200),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_param(1, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.convertInternSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        typeof _zod.z === "undefined" || typeof _zod.z.infer === "undefined" ? Object : _zod.z.infer
    ]),
    _ts_metadata("design:returntype", void 0)
], EmployeesController.prototype, "convert", null);
EmployeesController = _ts_decorate([
    (0, _common.Controller)('employees'),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _employeesservice.EmployeesService === "undefined" ? Object : _employeesservice.EmployeesService,
        typeof _peopleaccess.PeopleAccess === "undefined" ? Object : _peopleaccess.PeopleAccess
    ])
], EmployeesController);
let ProfileController = class ProfileController {
    profile;
    constructor(profile){
        this.profile = profile;
    }
    get(id) {
        return this.profile.profile(id);
    }
    documents(id) {
        return this.profile.documents(id);
    }
    assets(id) {
        return this.profile.assetsTab(id);
    }
    pay(id) {
        return this.profile.pay(id);
    }
    attendance(id) {
        return this.profile.attendance(id);
    }
};
_ts_decorate([
    (0, _common.Get)(':id'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String
    ]),
    _ts_metadata("design:returntype", void 0)
], ProfileController.prototype, "get", null);
_ts_decorate([
    (0, _common.Get)(':id/documents'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String
    ]),
    _ts_metadata("design:returntype", void 0)
], ProfileController.prototype, "documents", null);
_ts_decorate([
    (0, _common.Get)(':id/assets'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String
    ]),
    _ts_metadata("design:returntype", void 0)
], ProfileController.prototype, "assets", null);
_ts_decorate([
    (0, _common.Get)(':id/pay'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String
    ]),
    _ts_metadata("design:returntype", void 0)
], ProfileController.prototype, "pay", null);
_ts_decorate([
    (0, _common.Get)(':id/attendance'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String
    ]),
    _ts_metadata("design:returntype", void 0)
], ProfileController.prototype, "attendance", null);
ProfileController = _ts_decorate([
    (0, _common.Controller)('profile'),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _profileservice.ProfileService === "undefined" ? Object : _profileservice.ProfileService
    ])
], ProfileController);
const kindParam = _zod.z.enum([
    'departments',
    'designations',
    'branches'
]);
const KIND = {
    departments: 'department',
    designations: 'designation',
    branches: 'branch'
};
let MastersController = class MastersController {
    masters;
    constructor(masters){
        this.masters = masters;
    }
    async all() {
        const [departments, designations, branches, rounds, assetCategories] = await Promise.all([
            this.masters.departments(),
            this.masters.designations(),
            this.masters.branches(),
            this.masters.rounds(),
            this.masters.assetCategories()
        ]);
        return {
            departments,
            designations,
            branches,
            rounds,
            assetCategories
        };
    }
    createDept(dto) {
        return this.masters.createDepartment(dto);
    }
    updateDept(id, dto) {
        return this.masters.updateDepartment(id, dto);
    }
    createDesig(dto) {
        return this.masters.createDesignation(dto);
    }
    updateDesig(id, dto) {
        return this.masters.updateDesignation(id, dto);
    }
    createBranch(dto) {
        return this.masters.createBranch(dto);
    }
    updateBranch(id, dto) {
        return this.masters.updateBranch(id, dto);
    }
    remove(kind, id) {
        const k = kindParam.safeParse(kind);
        if (!k.success) throw (0, _errors.forbidden)('Unknown master');
        return this.masters.remove(KIND[k.data], id);
    }
};
_ts_decorate([
    (0, _common.Get)(),
    (0, _decorators.RequirePerm)('masters.manage', 'employees.manage', 'jobs.manage'),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", []),
    _ts_metadata("design:returntype", Promise)
], MastersController.prototype, "all", null);
_ts_decorate([
    (0, _common.Post)('departments'),
    (0, _decorators.RequirePerm)('masters.manage'),
    _ts_param(0, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.departmentSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _zod.z === "undefined" || typeof _zod.z.infer === "undefined" ? Object : _zod.z.infer
    ]),
    _ts_metadata("design:returntype", void 0)
], MastersController.prototype, "createDept", null);
_ts_decorate([
    (0, _common.Put)('departments/:id'),
    (0, _decorators.RequirePerm)('masters.manage'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_param(1, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.departmentSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        typeof _zod.z === "undefined" || typeof _zod.z.infer === "undefined" ? Object : _zod.z.infer
    ]),
    _ts_metadata("design:returntype", void 0)
], MastersController.prototype, "updateDept", null);
_ts_decorate([
    (0, _common.Post)('designations'),
    (0, _decorators.RequirePerm)('masters.manage', 'jobs.manage'),
    _ts_param(0, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.designationSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _zod.z === "undefined" || typeof _zod.z.infer === "undefined" ? Object : _zod.z.infer
    ]),
    _ts_metadata("design:returntype", void 0)
], MastersController.prototype, "createDesig", null);
_ts_decorate([
    (0, _common.Put)('designations/:id'),
    (0, _decorators.RequirePerm)('masters.manage'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_param(1, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.designationSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        typeof _zod.z === "undefined" || typeof _zod.z.infer === "undefined" ? Object : _zod.z.infer
    ]),
    _ts_metadata("design:returntype", void 0)
], MastersController.prototype, "updateDesig", null);
_ts_decorate([
    (0, _common.Post)('branches'),
    (0, _decorators.RequirePerm)('masters.manage'),
    _ts_param(0, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.branchSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _zod.z === "undefined" || typeof _zod.z.infer === "undefined" ? Object : _zod.z.infer
    ]),
    _ts_metadata("design:returntype", void 0)
], MastersController.prototype, "createBranch", null);
_ts_decorate([
    (0, _common.Put)('branches/:id'),
    (0, _decorators.RequirePerm)('masters.manage'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_param(1, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.branchSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        typeof _zod.z === "undefined" || typeof _zod.z.infer === "undefined" ? Object : _zod.z.infer
    ]),
    _ts_metadata("design:returntype", void 0)
], MastersController.prototype, "updateBranch", null);
_ts_decorate([
    (0, _common.Delete)(':kind/:id'),
    (0, _decorators.RequirePerm)('masters.manage'),
    _ts_param(0, (0, _common.Param)('kind')),
    _ts_param(1, (0, _common.Param)('id')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        String
    ]),
    _ts_metadata("design:returntype", void 0)
], MastersController.prototype, "remove", null);
MastersController = _ts_decorate([
    (0, _common.Controller)('masters'),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _mastersservice.MastersService === "undefined" ? Object : _mastersservice.MastersService
    ])
], MastersController);

//# sourceMappingURL=employees.controller.js.map