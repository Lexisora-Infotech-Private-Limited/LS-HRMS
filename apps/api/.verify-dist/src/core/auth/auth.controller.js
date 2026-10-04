"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "AuthController", {
    enumerable: true,
    get: function() {
        return AuthController;
    }
});
const _common = require("@nestjs/common");
const _zod = require("zod");
const _shared = require("@lexisora/shared");
const _env = require("../../config/env");
const _zodpipe = require("../http/zod.pipe");
const _errors = require("../http/errors");
const _requestcontext = require("../context/request-context");
const _authservice = require("./auth.service");
const _decorators = require("./decorators");
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
const COOKIE = 'lx_rt';
const cookieOpts = ()=>({
        httpOnly: true,
        sameSite: 'lax',
        secure: _env.env.COOKIE_SECURE ? _env.env.COOKIE_SECURE === 'true' : _env.env.NODE_ENV === 'production',
        path: '/api/v1/auth',
        maxAge: _env.env.REFRESH_TOKEN_TTL_DAYS * 86400_000
    });
const meta = (req)=>({
        ip: req.ip,
        userAgent: req.headers['user-agent']
    });
let AuthController = class AuthController {
    auth;
    constructor(auth){
        this.auth = auth;
    }
    async login(dto, req, res) {
        const r = await this.auth.login(dto, meta(req));
        // Browser clients keep the refresh token in an httpOnly cookie; native clients get it in the body.
        if (dto.client === 'web') {
            res.cookie(COOKIE, r.refreshToken, cookieOpts());
            const { refreshToken: _omit, ...rest } = r;
            return rest;
        }
        return r;
    }
    async refresh(req, res, body) {
        const token = req.cookies?.[COOKIE] ?? body?.refreshToken;
        if (!token) throw new _errors.AppError(401, 'SESSION_EXPIRED', 'Please sign in again');
        const r = await this.auth.refresh(token, meta(req));
        if (req.cookies?.[COOKIE]) {
            res.cookie(COOKIE, r.refreshToken, cookieOpts());
            const { refreshToken: _omit, ...rest } = r;
            return rest;
        }
        return r;
    }
    async logout(req, res, body) {
        await this.auth.logout(req.cookies?.[COOKIE] ?? body?.refreshToken);
        res.clearCookie(COOKIE, {
            path: '/api/v1/auth'
        });
    }
    me() {
        return this.auth.sessionUser((0, _requestcontext.requireContext)().userId);
    }
    async forgot(dto) {
        await this.auth.forgotPassword(dto.workspace, dto.email);
    }
    async reset(dto) {
        await this.auth.resetPassword(dto.token, dto.password);
    }
    async change(dto) {
        await this.auth.changePassword((0, _requestcontext.requireContext)().userId, dto.currentPassword, dto.newPassword);
    }
    async acceptInvite(dto, req, res) {
        const r = await this.auth.acceptInvite(dto.token, dto.password, meta(req));
        res.cookie(COOKIE, r.refreshToken, cookieOpts());
        const { refreshToken: _omit, ...rest } = r;
        return rest;
    }
    /** "Use SSO" on the login screen. SAML/OIDC is configured per tenant (adapter); until then, explain. */ async ssoStart(dto) {
        const t = await this.auth.resolveTenant(dto.workspace);
        throw new _errors.AppError(501, 'SSO_NOT_CONFIGURED', `Single sign-on is not configured for ${t.domain}. Ask your admin to enable it.`);
    }
};
_ts_decorate([
    (0, _decorators.Public)(),
    (0, _common.Post)('login'),
    (0, _common.HttpCode)(200),
    _ts_param(0, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.loginSchema))),
    _ts_param(1, (0, _common.Req)()),
    _ts_param(2, (0, _common.Res)({
        passthrough: true
    })),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof LoginInput === "undefined" ? Object : LoginInput,
        typeof Request === "undefined" ? Object : Request,
        typeof Response === "undefined" ? Object : Response
    ]),
    _ts_metadata("design:returntype", Promise)
], AuthController.prototype, "login", null);
_ts_decorate([
    (0, _decorators.Public)(),
    (0, _common.Post)('refresh'),
    (0, _common.HttpCode)(200),
    _ts_param(0, (0, _common.Req)()),
    _ts_param(1, (0, _common.Res)({
        passthrough: true
    })),
    _ts_param(2, (0, _common.Body)()),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof Request === "undefined" ? Object : Request,
        typeof Response === "undefined" ? Object : Response,
        Object
    ]),
    _ts_metadata("design:returntype", Promise)
], AuthController.prototype, "refresh", null);
_ts_decorate([
    (0, _decorators.Public)(),
    (0, _common.Post)('logout'),
    (0, _common.HttpCode)(204),
    _ts_param(0, (0, _common.Req)()),
    _ts_param(1, (0, _common.Res)({
        passthrough: true
    })),
    _ts_param(2, (0, _common.Body)()),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof Request === "undefined" ? Object : Request,
        typeof Response === "undefined" ? Object : Response,
        Object
    ]),
    _ts_metadata("design:returntype", Promise)
], AuthController.prototype, "logout", null);
_ts_decorate([
    (0, _common.Get)('me'),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", []),
    _ts_metadata("design:returntype", void 0)
], AuthController.prototype, "me", null);
_ts_decorate([
    (0, _decorators.Public)(),
    (0, _common.Post)('forgot-password'),
    (0, _common.HttpCode)(204),
    _ts_param(0, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.forgotPasswordSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _zod.z === "undefined" || typeof _zod.z.infer === "undefined" ? Object : _zod.z.infer
    ]),
    _ts_metadata("design:returntype", Promise)
], AuthController.prototype, "forgot", null);
_ts_decorate([
    (0, _decorators.Public)(),
    (0, _common.Post)('reset-password'),
    (0, _common.HttpCode)(204),
    _ts_param(0, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.resetPasswordSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _zod.z === "undefined" || typeof _zod.z.infer === "undefined" ? Object : _zod.z.infer
    ]),
    _ts_metadata("design:returntype", Promise)
], AuthController.prototype, "reset", null);
_ts_decorate([
    (0, _common.Post)('change-password'),
    (0, _common.HttpCode)(204),
    _ts_param(0, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.changePasswordSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _zod.z === "undefined" || typeof _zod.z.infer === "undefined" ? Object : _zod.z.infer
    ]),
    _ts_metadata("design:returntype", Promise)
], AuthController.prototype, "change", null);
_ts_decorate([
    (0, _decorators.Public)(),
    (0, _common.Post)('accept-invite'),
    (0, _common.HttpCode)(200),
    _ts_param(0, (0, _common.Body)(new _zodpipe.ZodPipe(_zod.z.object({
        token: _zod.z.string().min(10),
        password: _zod.z.string().min(8, 'At least 8 characters')
    })))),
    _ts_param(1, (0, _common.Req)()),
    _ts_param(2, (0, _common.Res)({
        passthrough: true
    })),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        Object,
        typeof Request === "undefined" ? Object : Request,
        typeof Response === "undefined" ? Object : Response
    ]),
    _ts_metadata("design:returntype", Promise)
], AuthController.prototype, "acceptInvite", null);
_ts_decorate([
    (0, _decorators.Public)(),
    (0, _common.Post)('sso/start'),
    (0, _common.HttpCode)(200),
    _ts_param(0, (0, _common.Body)(new _zodpipe.ZodPipe(_zod.z.object({
        workspace: _zod.z.string().min(1)
    })))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        Object
    ]),
    _ts_metadata("design:returntype", Promise)
], AuthController.prototype, "ssoStart", null);
AuthController = _ts_decorate([
    (0, _common.Controller)('auth'),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _authservice.AuthService === "undefined" ? Object : _authservice.AuthService
    ])
], AuthController);

//# sourceMappingURL=auth.controller.js.map