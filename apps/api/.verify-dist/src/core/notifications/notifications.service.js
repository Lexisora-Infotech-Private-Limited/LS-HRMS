"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "NotificationsService", {
    enumerable: true,
    get: function() {
        return NotificationsService;
    }
});
const _common = require("@nestjs/common");
const _prismaservice = require("../prisma/prisma.service");
const _requestcontext = require("../context/request-context");
const _mailservice = require("../mail/mail.service");
const _realtimegateway = require("../realtime/realtime.gateway");
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
let NotificationsService = class NotificationsService {
    prisma;
    realtime;
    mail;
    constructor(prisma, realtime, mail){
        this.prisma = prisma;
        this.realtime = realtime;
        this.mail = mail;
    }
    async notify(n) {
        const ids = [
            ...new Set(n.userIds.filter(Boolean))
        ];
        if (!ids.length) return;
        const tenantId = (0, _requestcontext.requireContext)().tenantId;
        await this.prisma.notification.createMany({
            data: ids.map((userId)=>({
                    tenantId,
                    userId,
                    type: n.type,
                    title: n.title,
                    body: n.body,
                    link: n.link,
                    fromLabel: n.from ?? 'System'
                }))
        });
        this.realtime.toUsers(ids, 'notification', {
            type: n.type,
            title: n.title,
            body: n.body,
            link: n.link
        });
        if (n.email) {
            const users = await this.prisma.user.findMany({
                where: {
                    id: {
                        in: ids
                    }
                },
                select: {
                    email: true,
                    name: true
                }
            });
            await Promise.all(users.map((u)=>this.mail.send({
                    to: u.email,
                    subject: n.title,
                    text: `Hi ${u.name},\n\n${n.body ?? n.title}\n\n— Lexisora HRMS`
                })));
        }
    }
    /** Map employee ids → their user ids (skips employees without a login). */ async usersForEmployees(employeeIds) {
        const ids = employeeIds.filter((x)=>!!x);
        if (!ids.length) return [];
        const rows = await this.prisma.employee.findMany({
            where: {
                id: {
                    in: ids
                }
            },
            select: {
                userId: true
            }
        });
        return rows.map((r)=>r.userId).filter((x)=>!!x);
    }
    /** User ids of everyone holding a permission (e.g. all HR for a new onboarding). */ async usersWithPermission(perm) {
        const roles = await this.prisma.role.findMany({
            where: {
                permissions: {
                    has: perm
                }
            },
            select: {
                id: true
            }
        });
        const users = await this.prisma.user.findMany({
            where: {
                roleId: {
                    in: roles.map((r)=>r.id)
                },
                status: 'ACTIVE'
            },
            select: {
                id: true
            }
        });
        return users.map((u)=>u.id);
    }
    list(userId, take = 50) {
        return this.prisma.notification.findMany({
            where: {
                userId
            },
            orderBy: {
                createdAt: 'desc'
            },
            take
        });
    }
    unreadCount(userId) {
        return this.prisma.notification.count({
            where: {
                userId,
                readAt: null
            }
        });
    }
    async markRead(userId, id) {
        await this.prisma.notification.updateMany({
            where: {
                userId,
                readAt: null,
                ...id ? {
                    id
                } : {}
            },
            data: {
                readAt: new Date()
            }
        });
    }
};
NotificationsService = _ts_decorate([
    (0, _common.Injectable)(),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _prismaservice.PrismaService === "undefined" ? Object : _prismaservice.PrismaService,
        typeof _realtimegateway.RealtimeGateway === "undefined" ? Object : _realtimegateway.RealtimeGateway,
        typeof _mailservice.MailService === "undefined" ? Object : _mailservice.MailService
    ])
], NotificationsService);

//# sourceMappingURL=notifications.service.js.map