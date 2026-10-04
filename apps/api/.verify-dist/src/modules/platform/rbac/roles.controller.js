"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "RolesController", {
    enumerable: true,
    get: function() {
        return RolesController;
    }
});
const _common = require("@nestjs/common");
const _shared = require("@lexisora/shared");
const _decorators = require("../../../core/auth/decorators");
const _zodpipe = require("../../../core/http/zod.pipe");
const _rolesservice = require("./roles.service");
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
let RolesController = class RolesController {
    roles;
    constructor(roles){
        this.roles = roles;
    }
    list() {
        return this.roles.list();
    }
    assignable() {
        return this.roles.assignable();
    }
    create(dto) {
        return this.roles.create(dto);
    }
    update(id, dto) {
        return this.roles.update(id, dto);
    }
    async remove(id) {
        await this.roles.remove(id);
    }
    setPermission(id, key, dto) {
        return this.roles.setPermission(id, key, dto.enabled, dto.cascade);
    }
    setMatrixRow(id, dto) {
        return this.roles.setMatrixRow(id, dto.row, dto.enabled);
    }
    setAll(id, dto) {
        return this.roles.setAll(id, dto.permissions, (0, _shared.setAllContext)(dto));
    }
    members(id) {
        return this.roles.members(id);
    }
    addMembers(id, dto) {
        return this.roles.addMembers(id, dto.userIds);
    }
    removeMember(id, userId) {
        return this.roles.removeMember(id, userId);
    }
};
_ts_decorate([
    (0, _common.Get)(),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", []),
    _ts_metadata("design:returntype", void 0)
], RolesController.prototype, "list", null);
_ts_decorate([
    (0, _common.Get)('assignable'),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", []),
    _ts_metadata("design:returntype", void 0)
], RolesController.prototype, "assignable", null);
_ts_decorate([
    (0, _common.Post)(),
    _ts_param(0, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.createRoleSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof CreateRoleInput === "undefined" ? Object : CreateRoleInput
    ]),
    _ts_metadata("design:returntype", void 0)
], RolesController.prototype, "create", null);
_ts_decorate([
    (0, _common.Patch)(':id'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_param(1, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.updateRoleSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        typeof UpdateRoleInput === "undefined" ? Object : UpdateRoleInput
    ]),
    _ts_metadata("design:returntype", void 0)
], RolesController.prototype, "update", null);
_ts_decorate([
    (0, _common.Delete)(':id'),
    (0, _common.HttpCode)(204),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String
    ]),
    _ts_metadata("design:returntype", Promise)
], RolesController.prototype, "remove", null);
_ts_decorate([
    (0, _common.Put)(':id/permissions/:key'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_param(1, (0, _common.Param)('key')),
    _ts_param(2, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.setPermissionSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        String,
        typeof SetPermissionInput === "undefined" ? Object : SetPermissionInput
    ]),
    _ts_metadata("design:returntype", void 0)
], RolesController.prototype, "setPermission", null);
_ts_decorate([
    (0, _common.Put)(':id/matrix'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_param(1, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.setMatrixRowSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        typeof SetMatrixRowInput === "undefined" ? Object : SetMatrixRowInput
    ]),
    _ts_metadata("design:returntype", void 0)
], RolesController.prototype, "setMatrixRow", null);
_ts_decorate([
    (0, _common.Put)(':id/permissions'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_param(1, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.setRolePermissionsSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        typeof SetRolePermissionsInput === "undefined" ? Object : SetRolePermissionsInput
    ]),
    _ts_metadata("design:returntype", void 0)
], RolesController.prototype, "setAll", null);
_ts_decorate([
    (0, _common.Get)(':id/members'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String
    ]),
    _ts_metadata("design:returntype", void 0)
], RolesController.prototype, "members", null);
_ts_decorate([
    (0, _common.Post)(':id/members'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_param(1, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.roleMembersSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        typeof RoleMembersInput === "undefined" ? Object : RoleMembersInput
    ]),
    _ts_metadata("design:returntype", void 0)
], RolesController.prototype, "addMembers", null);
_ts_decorate([
    (0, _common.Delete)(':id/members/:userId'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_param(1, (0, _common.Param)('userId')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        String
    ]),
    _ts_metadata("design:returntype", void 0)
], RolesController.prototype, "removeMember", null);
RolesController = _ts_decorate([
    (0, _common.Controller)('roles'),
    (0, _decorators.RequirePerm)('roles.manage'),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _rolesservice.RolesService === "undefined" ? Object : _rolesservice.RolesService
    ])
], RolesController);

//# sourceMappingURL=roles.controller.js.map