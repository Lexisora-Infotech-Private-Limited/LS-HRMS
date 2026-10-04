"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "AuthService", {
    enumerable: true,
    get: function() {
        return AuthService;
    }
});
const _common = require("@nestjs/common");
const _bcryptjs = /*#__PURE__*/ _interop_require_default(require("bcryptjs"));
const _shared = require("@lexisora/shared");
const _env = require("../../config/env");
const _prismaservice = require("../prisma/prisma.service");
const _errors = require("../http/errors");
const _mailservice = require("../mail/mail.service");
const _auditservice = require("../audit/audit.service");
const _tokenservice = require("./token.service");
function _interop_require_default(obj) {
    return obj && obj.__esModule ? obj : {
        default: obj
    };
}
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
let AuthService = class AuthService {
    prisma;
    tokens;
    mail;
    audit;
    log = new _common.Logger('Auth');
    constructor(prisma, tokens, mail, audit){
        this.prisma = prisma;
        this.tokens = tokens;
        this.mail = mail;
        this.audit = audit;
    }
    /** Accepts "lexisora.hrms.app", "lexisora" or a custom domain. */ async resolveTenant(workspace) {
        const w = workspace.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
        const t = await this.prisma.raw.tenant.findFirst({
            where: {
                OR: [
                    {
                        domain: w
                    },
                    {
                        slug: w
                    },
                    {
                        slug: w.split('.')[0]
                    }
                ]
            }
        });
        if (!t) throw new _errors.AppError(404, 'WORKSPACE_NOT_FOUND', 'No workspace found at that address');
        if (t.status === 'SUSPENDED') throw new _errors.AppError(403, 'WORKSPACE_SUSPENDED', 'This workspace is suspended');
        return t;
    }
    async login(input, meta) {
        const tenant = await this.resolveTenant(input.workspace);
        const user = await this.prisma.raw.user.findUnique({
            where: {
                tenantId_email: {
                    tenantId: tenant.id,
                    email: input.email
                }
            },
            include: {
                role: true,
                employee: true
            }
        });
        const ok = user?.passwordHash && await _bcryptjs.default.compare(input.password, user.passwordHash);
        if (!user || !ok) throw new _errors.AppError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect');
        if (user.status === 'DISABLED') throw new _errors.AppError(403, 'ACCOUNT_DISABLED', 'Your account is disabled');
        if (user.employee?.status === 'EXITED') throw new _errors.AppError(403, 'ACCOUNT_EXITED', 'Your employment has ended');
        // Wireframe rule: mobile access is enabled only for top-level roles (CEO/Admin/HR by default).
        if (input.client === 'mobile' && !user.role.permissions.includes('mobile.access')) {
            throw new _errors.AppError(403, 'MOBILE_NOT_ALLOWED', 'Mobile access is enabled only for CEO, Admin and HR roles');
        }
        await this.prisma.raw.user.update({
            where: {
                id: user.id
            },
            data: {
                lastLoginAt: new Date(),
                status: 'ACTIVE'
            }
        });
        const refreshToken = await this.issueRefresh(user.id, tenant.id, input.client, meta);
        await this.audit.recordRaw(tenant.id, {
            actorUserId: user.id,
            actorName: user.name,
            action: 'auth.login',
            entity: 'User',
            entityId: user.id,
            meta: {
                client: input.client
            },
            ip: meta.ip
        });
        return {
            accessToken: this.tokens.signAccess(user.id, tenant.id),
            expiresIn: _env.env.ACCESS_TOKEN_TTL_SEC,
            refreshToken,
            user: await this.sessionUser(user.id)
        };
    }
    async issueRefresh(userId, tenantId, client, meta) {
        const token = (0, _tokenservice.randomToken)(48);
        await this.prisma.raw.refreshToken.create({
            data: {
                tenantId,
                userId,
                tokenHash: (0, _tokenservice.sha256)(token),
                client,
                ip: meta.ip,
                userAgent: meta.userAgent?.slice(0, 250),
                expiresAt: new Date(Date.now() + _env.env.REFRESH_TOKEN_TTL_DAYS * 86400_000)
            }
        });
        return token;
    }
    /** Rotating refresh: old token is revoked; reuse of a revoked token revokes the whole family. */ async refresh(token, meta) {
        const row = await this.prisma.raw.refreshToken.findUnique({
            where: {
                tokenHash: (0, _tokenservice.sha256)(token)
            }
        });
        if (!row || row.expiresAt < new Date()) throw new _errors.AppError(401, 'SESSION_EXPIRED', 'Please sign in again');
        if (row.revokedAt) {
            await this.prisma.raw.refreshToken.updateMany({
                where: {
                    userId: row.userId,
                    revokedAt: null
                },
                data: {
                    revokedAt: new Date()
                }
            });
            this.log.warn(`Refresh token reuse detected for user ${row.userId}`);
            throw new _errors.AppError(401, 'SESSION_EXPIRED', 'Please sign in again');
        }
        const user = await this.prisma.raw.user.findUnique({
            where: {
                id: row.userId
            }
        });
        if (!user || user.status === 'DISABLED') throw new _errors.AppError(401, 'SESSION_EXPIRED', 'Please sign in again');
        const next = await this.issueRefresh(row.userId, row.tenantId, row.client, meta);
        await this.prisma.raw.refreshToken.update({
            where: {
                id: row.id
            },
            data: {
                revokedAt: new Date(),
                replacedBy: (0, _tokenservice.sha256)(next)
            }
        });
        return {
            accessToken: this.tokens.signAccess(row.userId, row.tenantId),
            expiresIn: _env.env.ACCESS_TOKEN_TTL_SEC,
            refreshToken: next,
            user: await this.sessionUser(row.userId)
        };
    }
    async logout(token) {
        if (!token) return;
        await this.prisma.raw.refreshToken.updateMany({
            where: {
                tokenHash: (0, _tokenservice.sha256)(token),
                revokedAt: null
            },
            data: {
                revokedAt: new Date()
            }
        });
    }
    async sessionUser(userId) {
        const u = await this.prisma.raw.user.findUniqueOrThrow({
            where: {
                id: userId
            },
            include: {
                role: true,
                employee: {
                    include: {
                        designation: true,
                        department: true
                    }
                }
            }
        });
        const t = await this.prisma.raw.tenant.findUniqueOrThrow({
            where: {
                id: u.tenantId
            }
        });
        const e = u.employee;
        const name = e?.fullName ?? u.name;
        const title = e ? [
            e.designation?.name,
            e.department?.name
        ].filter(Boolean).join(' · ') || null : null;
        return {
            id: u.id,
            tenantId: t.id,
            tenantName: t.brandName ?? t.name,
            tenantDomain: t.domain,
            employeeId: e?.id ?? null,
            email: u.email,
            name,
            firstName: e?.firstName ?? name.split(' ')[0],
            initials: (0, _shared.initialsOf)(name),
            title,
            roleKey: u.role.key,
            roleName: u.role.name,
            permissions: u.role.permissions,
            isPlatformAdmin: u.isPlatformAdmin,
            workMode: e?.workMode ?? null,
            branding: {
                accent: t.brandAccent,
                accent2: t.brandAccent2,
                logoUrl: t.logoFileId ? `/api/v1/files/${t.logoFileId}/public` : null
            }
        };
    }
    async forgotPassword(workspace, email) {
        const tenant = await this.resolveTenant(workspace).catch(()=>null);
        if (!tenant) return; // do not reveal whether the workspace/user exists
        const user = await this.prisma.raw.user.findUnique({
            where: {
                tenantId_email: {
                    tenantId: tenant.id,
                    email
                }
            }
        });
        if (!user) return;
        const token = (0, _tokenservice.randomToken)(32);
        await this.prisma.raw.passwordResetToken.create({
            data: {
                tenantId: tenant.id,
                userId: user.id,
                tokenHash: (0, _tokenservice.sha256)(token),
                expiresAt: new Date(Date.now() + 3600_000)
            }
        });
        const link = `${_env.env.WEB_ORIGIN}/reset-password?token=${token}`;
        await this.mail.send({
            to: user.email,
            subject: 'Reset your Lexisora HRMS password',
            text: `Hi ${user.name},\n\nUse this link within one hour to set a new password:\n${link}\n\nIf you did not ask for this, ignore this email.`
        });
    }
    async resetPassword(token, password) {
        const row = await this.prisma.raw.passwordResetToken.findUnique({
            where: {
                tokenHash: (0, _tokenservice.sha256)(token)
            }
        });
        if (!row || row.usedAt || row.expiresAt < new Date()) throw (0, _errors.badRequest)('This reset link is invalid or has expired', 'RESET_INVALID');
        await this.prisma.raw.$transaction([
            this.prisma.raw.user.update({
                where: {
                    id: row.userId
                },
                data: {
                    passwordHash: await _bcryptjs.default.hash(password, 10),
                    status: 'ACTIVE'
                }
            }),
            this.prisma.raw.passwordResetToken.update({
                where: {
                    id: row.id
                },
                data: {
                    usedAt: new Date()
                }
            }),
            this.prisma.raw.refreshToken.updateMany({
                where: {
                    userId: row.userId,
                    revokedAt: null
                },
                data: {
                    revokedAt: new Date()
                }
            })
        ]);
    }
    async changePassword(userId, current, next) {
        const u = await this.prisma.raw.user.findUniqueOrThrow({
            where: {
                id: userId
            }
        });
        if (!u.passwordHash || !await _bcryptjs.default.compare(current, u.passwordHash)) {
            throw (0, _errors.badRequest)('Current password is incorrect', 'INVALID_PASSWORD');
        }
        await this.prisma.raw.user.update({
            where: {
                id: userId
            },
            data: {
                passwordHash: await _bcryptjs.default.hash(next, 10)
            }
        });
    }
    /** Invited users (Add employee → onboarding invite) set their password here. */ async acceptInvite(token, password, meta) {
        const u = await this.prisma.raw.user.findUnique({
            where: {
                inviteToken: token
            },
            include: {
                role: true
            }
        });
        if (!u || u.inviteExpiresAt && u.inviteExpiresAt < new Date()) throw (0, _errors.badRequest)('This invite link is invalid or has expired', 'INVITE_INVALID');
        await this.prisma.raw.user.update({
            where: {
                id: u.id
            },
            data: {
                passwordHash: await _bcryptjs.default.hash(password, 10),
                inviteToken: null,
                inviteExpiresAt: null,
                status: 'ACTIVE',
                lastLoginAt: new Date()
            }
        });
        const refreshToken = await this.issueRefresh(u.id, u.tenantId, 'web', meta);
        return {
            accessToken: this.tokens.signAccess(u.id, u.tenantId),
            expiresIn: _env.env.ACCESS_TOKEN_TTL_SEC,
            refreshToken,
            user: await this.sessionUser(u.id)
        };
    }
    static hashPassword(p) {
        return _bcryptjs.default.hash(p, 10);
    }
};
AuthService = _ts_decorate([
    (0, _common.Injectable)(),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _prismaservice.PrismaService === "undefined" ? Object : _prismaservice.PrismaService,
        typeof _tokenservice.TokenService === "undefined" ? Object : _tokenservice.TokenService,
        typeof _mailservice.MailService === "undefined" ? Object : _mailservice.MailService,
        typeof _auditservice.AuditService === "undefined" ? Object : _auditservice.AuditService
    ])
], AuthService);

//# sourceMappingURL=auth.service.js.map