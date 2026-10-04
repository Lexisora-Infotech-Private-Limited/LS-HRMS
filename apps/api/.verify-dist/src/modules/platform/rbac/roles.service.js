"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "RolesService", {
    enumerable: true,
    get: function() {
        return RolesService;
    }
});
const _common = require("@nestjs/common");
const _shared = require("@lexisora/shared");
const _prismaservice = require("../../../core/prisma/prisma.service");
const _requestcontext = require("../../../core/context/request-context");
const _auditservice = require("../../../core/audit/audit.service");
const _notificationsservice = require("../../../core/notifications/notifications.service");
const _realtimegateway = require("../../../core/realtime/realtime.gateway");
const _errors = require("../../../core/http/errors");
const _rbaclogic = require("./rbac.logic");
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
let RolesService = class RolesService {
    prisma;
    audit;
    notifications;
    realtime;
    constructor(prisma, audit, notifications, realtime){
        this.prisma = prisma;
        this.audit = audit;
        this.notifications = notifications;
        this.realtime = realtime;
    }
    async tenantPlan() {
        const sub = await this.prisma.subscription.findFirst({
            select: {
                planCode: true,
                status: true
            }
        });
        return (0, _rbaclogic.effectivePlan)(sub);
    }
    async myRoleId() {
        const ctx = (0, _requestcontext.requireContext)();
        if (!ctx.userId) return null;
        const u = await this.prisma.user.findUnique({
            where: {
                id: ctx.userId
            },
            select: {
                roleId: true
            }
        });
        return u?.roleId ?? null;
    }
    /**
   * Every open Roles & access screen in the tenant refetches (two admins editing at once: last write
   * wins and both re-render). Members of the role additionally get `rbac.changed` to reload their session.
   */ broadcast(roleId) {
        this.realtime.toTenant((0, _requestcontext.requireContext)().tenantId, 'rbac.roles.changed', {
            roleId
        });
    }
    sortRoles(roles) {
        const order = (r)=>r.isSystem ? _shared.ROLE_KEYS.indexOf(r.key) : 100;
        return [
            ...roles
        ].sort((a, b)=>order(a) - order(b) || a.createdAt.getTime() - b.createdAt.getTime());
    }
    dto(r, myRoleId) {
        return {
            id: r.id,
            key: r.key,
            name: r.name,
            shortName: r.isSystem && r.key in _shared.ROLE_SHORT_LABELS ? _shared.ROLE_SHORT_LABELS[r.key] : r.name,
            description: r.description,
            isSystem: r.isSystem,
            permissions: r.permissions,
            memberCount: r._count.users,
            isMine: r.id === myRoleId
        };
    }
    async list() {
        const [rows, myRoleId, plan] = await Promise.all([
            this.prisma.role.findMany({
                include: {
                    _count: {
                        select: {
                            users: true
                        }
                    }
                }
            }),
            this.myRoleId(),
            this.tenantPlan()
        ]);
        const roles = this.sortRoles(rows).map((r)=>this.dto(r, myRoleId));
        const matrix = _shared.ROLE_MATRIX_ROWS.map((row)=>({
                label: row.label,
                keys: row.keys,
                cells: Object.fromEntries(roles.map((r)=>[
                        r.id,
                        (0, _shared.matrixCell)(r.permissions, row)
                    ]))
            }));
        const groups = [];
        for (const key of _shared.PERMISSION_KEYS){
            const def = _shared.PERMISSIONS[key];
            let g = groups.find((x)=>x.group === def.group);
            if (!g) groups.push(g = {
                group: def.group,
                items: []
            });
            g.items.push({
                key,
                label: def.label,
                minPlan: _shared.PERMISSION_MIN_PLAN[key] ?? null,
                locked: !(0, _rbaclogic.planAllows)(plan, key),
                requires: _shared.PERMISSION_REQUIRES[key] ?? [],
                highRisk: _shared.HIGH_RISK_KEYS.includes(key)
            });
        }
        return {
            roles,
            matrix,
            groups,
            plan
        };
    }
    async load(id) {
        const r = await this.prisma.role.findUnique({
            where: {
                id
            },
            include: {
                _count: {
                    select: {
                        users: true
                    }
                }
            }
        });
        if (!r) throw (0, _errors.notFound)('Role');
        return r;
    }
    async assertNameFree(name, exceptId) {
        const clash = await this.prisma.role.findFirst({
            where: {
                name: {
                    equals: name,
                    mode: 'insensitive'
                },
                ...exceptId ? {
                    NOT: {
                        id: exceptId
                    }
                } : {}
            }
        });
        if (clash) throw (0, _errors.conflict)(`A role named “${clash.name}” already exists`, 'ROLE_NAME_TAKEN');
    }
    async create(input) {
        await this.assertNameFree(input.name);
        const existing = await this.prisma.role.findMany({
            select: {
                key: true
            }
        });
        let permissions = [];
        let copiedFrom = null;
        if (input.copyFromRoleId) {
            const src = await this.prisma.role.findUnique({
                where: {
                    id: input.copyFromRoleId
                }
            });
            if (!src) throw (0, _errors.badRequest)('The role to copy from no longer exists');
            permissions = [
                ...src.permissions
            ];
            copiedFrom = src.name;
        }
        // Never copy keys the plan doesn't include (they'd be inert anyway).
        const plan = await this.tenantPlan();
        permissions = permissions.filter((k)=>(0, _rbaclogic.planAllows)(plan, k));
        const role = await this.prisma.role.create({
            data: {
                key: (0, _rbaclogic.roleKeyFor)(input.name, existing.map((e)=>e.key)),
                name: input.name,
                description: input.description ?? null,
                isSystem: false,
                permissions
            },
            include: {
                _count: {
                    select: {
                        users: true
                    }
                }
            }
        });
        await this.audit.record({
            action: 'rbac.role.created',
            entity: 'Role',
            entityId: role.id,
            meta: {
                summary: `Created role ${role.name}${copiedFrom ? ` (copied from ${copiedFrom})` : ''}`,
                copiedFrom,
                permissions: permissions.length
            }
        });
        this.broadcast(role.id);
        return this.dto(role, await this.myRoleId());
    }
    async update(id, input) {
        const role = await this.load(id);
        if (input.name && input.name !== role.name) await this.assertNameFree(input.name, id);
        // An emptied description is stored as null (the screen then shows "System role" / "Custom role").
        const description = input.description === undefined ? undefined : input.description || null;
        const updated = await this.prisma.role.update({
            where: {
                id
            },
            data: {
                name: input.name ?? undefined,
                description
            },
            include: {
                _count: {
                    select: {
                        users: true
                    }
                }
            }
        });
        if (input.name && input.name !== role.name) {
            await this.audit.record({
                action: 'rbac.role.renamed',
                entity: 'Role',
                entityId: id,
                meta: {
                    summary: `Renamed ${role.name} → ${updated.name}`,
                    from: role.name,
                    to: updated.name
                }
            });
        }
        if (description !== undefined && description !== role.description) {
            await this.audit.record({
                action: 'rbac.role.described',
                entity: 'Role',
                entityId: id,
                meta: {
                    summary: `Updated the description of ${updated.name}`,
                    from: role.description,
                    to: updated.description
                }
            });
        }
        this.broadcast(id);
        return this.dto(updated, await this.myRoleId());
    }
    async remove(id) {
        const role = await this.load(id);
        if (role.isSystem) throw (0, _errors.conflict)('System roles can’t be deleted. You can rename them or change their permissions.', 'SYSTEM_ROLE');
        if (role._count.users > 0) throw (0, _errors.conflict)(`Reassign the ${role._count.users} member(s) of ${role.name} to another role first`, 'ROLE_HAS_MEMBERS');
        await this.prisma.role.delete({
            where: {
                id
            }
        });
        await this.audit.record({
            action: 'rbac.role.deleted',
            entity: 'Role',
            entityId: id,
            meta: {
                summary: `Deleted role ${role.name}`
            }
        });
        this.broadcast(id);
    }
    /** Users (other than those in `exceptRoleId`) who would still hold roles.manage. */ async otherAdminsCount(exceptRoleId, exceptUserIds = []) {
        const roles = await this.prisma.role.findMany({
            where: {
                permissions: {
                    has: 'roles.manage'
                },
                NOT: {
                    id: exceptRoleId
                }
            },
            select: {
                id: true
            }
        });
        return this.prisma.user.count({
            where: {
                roleId: {
                    in: roles.map((r)=>r.id)
                },
                status: 'ACTIVE',
                NOT: {
                    id: {
                        in: exceptUserIds
                    }
                }
            }
        });
    }
    async guardRolesManageRemoval(role) {
        const myRoleId = await this.myRoleId();
        if (role.id === myRoleId) {
            throw (0, _errors.conflict)('You can’t remove Roles & access from your own role — ask another admin to do it.', 'SELF_LOCKOUT');
        }
        if (await this.otherAdminsCount(role.id) === 0) {
            throw (0, _errors.conflict)('At least one active person must keep Roles & access.', 'LAST_ADMIN');
        }
    }
    async commit(role, next, added, removed, context) {
        if (!added.length && !removed.length) return {
            role: this.dto(role, await this.myRoleId()),
            added,
            removed
        };
        if (removed.includes('roles.manage')) await this.guardRolesManageRemoval(role);
        const plan = await this.tenantPlan();
        const blocked = (0, _rbaclogic.lockedKeys)(plan, added);
        if (blocked.length) {
            const min = _shared.PERMISSION_MIN_PLAN[blocked[0]] ?? 'GROWTH';
            throw new _errors.AppError(402, 'FEATURE_NOT_IN_PLAN', `${(0, _rbaclogic.label)(blocked[0])} needs the ${min === 'ENTERPRISE' ? 'Enterprise' : 'Growth'} plan`, {
                keys: blocked
            });
        }
        const updated = await this.prisma.role.update({
            where: {
                id: role.id
            },
            data: {
                permissions: next
            },
            include: {
                _count: {
                    select: {
                        users: true
                    }
                }
            }
        });
        for (const [action, keys] of [
            [
                'rbac.permission.granted',
                added
            ],
            [
                'rbac.permission.revoked',
                removed
            ]
        ]){
            if (!keys.length) continue;
            await this.audit.record({
                action,
                entity: 'Role',
                entityId: role.id,
                meta: {
                    summary: `${action.endsWith('granted') ? 'Granted' : 'Revoked'} ${keys.map(_rbaclogic.label).join(', ')} ${action.endsWith('granted') ? 'to' : 'from'} ${role.name}${context ? ` · ${context}` : ''}`,
                    role: role.name,
                    keys
                }
            });
        }
        await this.announce(role.id, added, removed);
        this.broadcast(role.id);
        return {
            role: this.dto(updated, await this.myRoleId()),
            added,
            removed
        };
    }
    /**
   * People who no longer hold `mobile.access` are signed out of the mobile app: their mobile refresh
   * tokens expire now (expiring rather than revoking avoids tripping refresh-token reuse detection,
   * which would also end their web sessions). The access token lapses within its 15-minute TTL.
   */ async endMobileSessions(userIds, reason) {
        if (!userIds.length) return;
        const now = new Date();
        const r = await this.prisma.refreshToken.updateMany({
            where: {
                userId: {
                    in: userIds
                },
                client: 'mobile',
                revokedAt: null,
                expiresAt: {
                    gt: now
                }
            },
            data: {
                expiresAt: now
            }
        });
        if (r.count) {
            await this.audit.record({
                action: 'security.sessions.revoked',
                entity: 'User',
                entityId: userIds.length === 1 ? userIds[0] : null,
                meta: {
                    summary: `Signed out ${r.count} mobile session(s) · ${reason}`,
                    client: 'mobile',
                    users: userIds.length
                }
            });
        }
    }
    /** Alert + live refresh for everyone holding the role. */ async announce(roleId, added, removed) {
        const members = await this.prisma.user.findMany({
            where: {
                roleId,
                status: {
                    not: 'DISABLED'
                }
            },
            select: {
                id: true
            }
        });
        if (removed.includes('mobile.access')) await this.endMobileSessions(members.map((m)=>m.id), 'Mobile app access was turned off for their role');
        const ids = members.map((m)=>m.id).filter((id)=>id !== (0, _requestcontext.requireContext)().userId);
        this.realtime.toUsers(members.map((m)=>m.id), 'rbac.changed', {
            roleId
        });
        if (ids.length) {
            await this.notifications.notify({
                userIds: ids,
                type: 'rbac.role_changed',
                title: `Your access was updated: ${(0, _rbaclogic.accessChangeSummary)(added, removed)}`,
                link: '/dashboard',
                from: 'Admin'
            });
        }
    }
    async setPermission(id, key, enabled, cascade = false) {
        if (!(0, _rbaclogic.isPermissionKey)(key)) throw (0, _errors.badRequest)(`Unknown permission ${key}`, 'UNKNOWN_PERMISSION');
        const role = await this.load(id);
        try {
            const r = (0, _rbaclogic.applyToggle)(role.permissions, [
                key
            ], enabled, cascade);
            return await this.commit(role, r.next, r.added, r.removed, '');
        } catch (e) {
            if (e instanceof _rbaclogic.DependencyError) throw new _errors.AppError(409, 'PERMISSION_REQUIRED_BY', e.message, {
                dependents: e.dependents,
                labels: e.dependents.map(_rbaclogic.label)
            });
            throw e;
        }
    }
    async setMatrixRow(id, rowLabel, enabled) {
        const row = (0, _rbaclogic.matrixRow)(rowLabel);
        if (!row) throw (0, _errors.badRequest)('Unknown matrix row');
        const role = await this.load(id);
        // Rows toggle as a unit: disabling also removes keys that depend on the row's keys.
        const r = (0, _rbaclogic.applyToggle)(role.permissions, row.keys, enabled, true);
        return this.commit(role, r.next, r.added, r.removed, `matrix row “${row.label}”`);
    }
    /**
   * Replace the whole permission set (the screen's "Undo", bulk edits). Unknown keys are refused;
   * everything a key requires is added; legacy keys already on the role are kept.
   */ async setAll(id, permissions, context = 'undo') {
        const role = await this.load(id);
        // Legacy keys already on the role may come back from the screen (they're kept as they are).
        const unknown = permissions.filter((k)=>!(0, _rbaclogic.isPermissionKey)(k) && !role.permissions.includes(k));
        if (unknown.length) throw (0, _errors.badRequest)(`Unknown permission ${unknown[0]}`, 'UNKNOWN_PERMISSION');
        const r = (0, _rbaclogic.replacePermissions)(role.permissions, permissions);
        return this.commit(role, r.next, r.added, r.removed, context);
    }
    async members(id) {
        await this.load(id);
        const users = await this.prisma.user.findMany({
            where: {
                roleId: id
            },
            include: {
                employee: {
                    select: {
                        empCode: true,
                        department: {
                            select: {
                                name: true
                            }
                        }
                    }
                }
            },
            orderBy: {
                name: 'asc'
            }
        });
        // "Assigned on / by" = the latest move into a role for each member (seeded users have none).
        const moves = users.length ? await this.prisma.auditLog.findMany({
            where: {
                action: 'rbac.member.added',
                entity: 'User',
                entityId: {
                    in: users.map((u)=>u.id)
                }
            },
            orderBy: {
                createdAt: 'desc'
            },
            select: {
                entityId: true,
                actorName: true,
                createdAt: true
            }
        }) : [];
        const lastMove = new Map();
        for (const m of moves)if (m.entityId && !lastMove.has(m.entityId)) lastMove.set(m.entityId, m);
        return users.map((u)=>{
            const mv = lastMove.get(u.id);
            return {
                userId: u.id,
                name: u.name,
                email: u.email,
                empCode: u.employee?.empCode ?? null,
                department: u.employee?.department?.name ?? null,
                status: u.status,
                since: (mv?.createdAt ?? u.createdAt).toISOString(),
                assignedBy: mv ? mv.actorName ?? 'System' : null
            };
        });
    }
    /** People who can be moved into a role (everyone in the tenant, with their current role). */ async assignable() {
        const users = await this.prisma.user.findMany({
            where: {
                status: {
                    not: 'DISABLED'
                }
            },
            include: {
                role: {
                    select: {
                        name: true
                    }
                }
            },
            orderBy: {
                name: 'asc'
            }
        });
        return users.map((u)=>({
                value: u.id,
                label: `${u.name} · ${u.role.name}`,
                roleName: u.role.name
            }));
    }
    async addMembers(id, userIds) {
        const role = await this.load(id);
        const ctx = (0, _requestcontext.requireContext)();
        const users = await this.prisma.user.findMany({
            where: {
                id: {
                    in: userIds
                }
            },
            include: {
                role: true
            }
        });
        if (!users.length) throw (0, _errors.badRequest)('Pick at least one person');
        const losing = users.filter((u)=>u.role.permissions.includes('roles.manage') && !role.permissions.includes('roles.manage'));
        if (losing.some((u)=>u.id === ctx.userId)) throw (0, _errors.conflict)('Moving yourself to this role would remove your own Roles & access.', 'SELF_LOCKOUT');
        if (losing.length) {
            const remaining = await this.prisma.role.findMany({
                where: {
                    permissions: {
                        has: 'roles.manage'
                    }
                },
                select: {
                    id: true
                }
            });
            const left = await this.prisma.user.count({
                where: {
                    roleId: {
                        in: remaining.map((r)=>r.id)
                    },
                    status: 'ACTIVE',
                    NOT: {
                        id: {
                            in: losing.map((u)=>u.id)
                        }
                    }
                }
            });
            if (left === 0) throw (0, _errors.conflict)('At least one active person must keep Roles & access.', 'LAST_ADMIN');
        }
        const moving = users.filter((u)=>u.roleId !== id);
        for (const u of moving){
            await this.prisma.user.update({
                where: {
                    id: u.id
                },
                data: {
                    roleId: id
                }
            });
            await this.audit.record({
                action: 'rbac.member.added',
                entity: 'User',
                entityId: u.id,
                meta: {
                    summary: `${u.name}: ${u.role.name} → ${role.name}`,
                    from: u.role.name,
                    to: role.name
                }
            });
        }
        if (moving.length) {
            if (!role.permissions.includes('mobile.access')) {
                await this.endMobileSessions(moving.filter((u)=>u.role.permissions.includes('mobile.access')).map((u)=>u.id), `moved to ${role.name}`);
            }
            this.realtime.toUsers(moving.map((u)=>u.id), 'rbac.changed', {
                roleId: id
            });
            await this.notifications.notify({
                userIds: moving.map((u)=>u.id).filter((x)=>x !== ctx.userId),
                type: 'rbac.role_changed',
                title: `Your role is now ${role.name}`,
                link: '/dashboard',
                from: 'Admin'
            });
            this.broadcast(id);
        }
        return this.members(id);
    }
    /** Remove a member from a role = move them back to the Employee role. */ async removeMember(id, userId) {
        const role = await this.load(id);
        if (role.key === 'employee' && role.isSystem) throw (0, _errors.badRequest)('Everyone needs a role — move this person to another role instead');
        const fallback = await this.prisma.role.findFirst({
            where: {
                key: 'employee'
            }
        });
        if (!fallback) throw (0, _errors.badRequest)('The Employee role is missing');
        const u = await this.prisma.user.findFirst({
            where: {
                id: userId,
                roleId: id
            }
        });
        if (!u) throw (0, _errors.notFound)('Member');
        if (role.permissions.includes('roles.manage')) {
            if (u.id === (0, _requestcontext.requireContext)().userId) throw (0, _errors.conflict)('You can’t remove yourself from a role that gives you Roles & access.', 'SELF_LOCKOUT');
            if (await this.otherAdminsCount(id) + await this.prisma.user.count({
                where: {
                    roleId: id,
                    status: 'ACTIVE',
                    NOT: {
                        id: u.id
                    }
                }
            }) === 0) {
                throw (0, _errors.conflict)('At least one active person must keep Roles & access.', 'LAST_ADMIN');
            }
        }
        await this.prisma.user.update({
            where: {
                id: u.id
            },
            data: {
                roleId: fallback.id
            }
        });
        await this.audit.record({
            action: 'rbac.member.removed',
            entity: 'User',
            entityId: u.id,
            meta: {
                summary: `${u.name}: ${role.name} → ${fallback.name}`,
                from: role.name,
                to: fallback.name
            }
        });
        if (role.permissions.includes('mobile.access') && !fallback.permissions.includes('mobile.access')) await this.endMobileSessions([
            u.id
        ], `moved to ${fallback.name}`);
        this.realtime.toUser(u.id, 'rbac.changed', {
            roleId: fallback.id
        });
        await this.notifications.notify({
            userIds: [
                u.id
            ],
            type: 'rbac.role_changed',
            title: `Your role is now ${fallback.name}`,
            link: '/dashboard',
            from: 'Admin'
        });
        this.broadcast(id);
        return this.members(id);
    }
};
RolesService = _ts_decorate([
    (0, _common.Injectable)(),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _prismaservice.PrismaService === "undefined" ? Object : _prismaservice.PrismaService,
        typeof _auditservice.AuditService === "undefined" ? Object : _auditservice.AuditService,
        typeof _notificationsservice.NotificationsService === "undefined" ? Object : _notificationsservice.NotificationsService,
        typeof _realtimegateway.RealtimeGateway === "undefined" ? Object : _realtimegateway.RealtimeGateway
    ])
], RolesService);

//# sourceMappingURL=roles.service.js.map