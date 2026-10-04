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
    get Ctx () {
        return Ctx;
    },
    get IS_PUBLIC () {
        return IS_PUBLIC;
    },
    get PLATFORM_ONLY () {
        return PLATFORM_ONLY;
    },
    get PlatformOnly () {
        return PlatformOnly;
    },
    get Public () {
        return Public;
    },
    get REQUIRED_PERMS () {
        return REQUIRED_PERMS;
    },
    get RequirePerm () {
        return RequirePerm;
    },
    get hasPerm () {
        return hasPerm;
    }
});
const _common = require("@nestjs/common");
const _requestcontext = require("../context/request-context");
const IS_PUBLIC = 'isPublic';
const REQUIRED_PERMS = 'requiredPerms';
const PLATFORM_ONLY = 'platformOnly';
const Public = ()=>(0, _common.SetMetadata)(IS_PUBLIC, true);
const RequirePerm = (...perms)=>(0, _common.SetMetadata)(REQUIRED_PERMS, perms);
const PlatformOnly = ()=>(0, _common.SetMetadata)(PLATFORM_ONLY, true);
const Ctx = (0, _common.createParamDecorator)((_, _ec)=>(0, _requestcontext.requireContext)());
function hasPerm(ctx, perm) {
    return ctx.permissions.has('*') || ctx.permissions.has(perm);
}

//# sourceMappingURL=decorators.js.map