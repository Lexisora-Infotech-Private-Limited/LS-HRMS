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
    get SEAT_STATUSES () {
        return SEAT_STATUSES;
    },
    get istEnd () {
        return istEnd;
    },
    get istStart () {
        return istStart;
    },
    get openedLabel () {
        return openedLabel;
    },
    get platformActorName () {
        return platformActorName;
    },
    get platformAdminUserIds () {
        return platformAdminUserIds;
    },
    get platformTenantId () {
        return platformTenantId;
    },
    get recordPlatformAccess () {
        return recordPlatformAccess;
    },
    get renewalLabel () {
        return renewalLabel;
    }
});
const _shared = require("@lexisora/shared");
function istStart(key) {
    return new Date(`${key}T00:00:00+05:30`);
}
function istEnd(key) {
    return new Date(`${key}T23:59:59.999+05:30`);
}
function openedLabel(d, now = new Date()) {
    if ((0, _shared.istDateKey)(d) === (0, _shared.istDateKey)(now)) return `Today, ${(0, _shared.formatTime)(d)}`;
    const y = new Date(now.getTime() - 86400_000);
    if ((0, _shared.istDateKey)(d) === (0, _shared.istDateKey)(y)) return `Yesterday, ${(0, _shared.formatTime)(d)}`;
    return (0, _shared.formatDayMonth)(d);
}
function renewalLabel(end, now = new Date()) {
    if (!end) return '—';
    const days = (end.getTime() - now.getTime()) / 86400_000;
    if (days <= 60) return (0, _shared.formatDayMonth)(end);
    return (0, _shared.formatMonthYear)(end);
}
let cachedPlatformTenant = null;
async function platformTenantId(raw) {
    if (cachedPlatformTenant) return cachedPlatformTenant;
    const u = await raw.user.findFirst({
        where: {
            isPlatformAdmin: true
        },
        orderBy: {
            createdAt: 'asc'
        },
        select: {
            tenantId: true
        }
    });
    const t = u ? {
        id: u.tenantId
    } : await raw.tenant.findFirst({
        where: {
            slug: 'lexisora'
        },
        select: {
            id: true
        }
    });
    if (!t) throw new Error('Platform tenant not found');
    cachedPlatformTenant = t.id;
    return t.id;
}
async function platformAdminUserIds(raw) {
    const rows = await raw.user.findMany({
        where: {
            isPlatformAdmin: true,
            status: 'ACTIVE'
        },
        select: {
            id: true
        }
    });
    return rows.map((r)=>r.id);
}
const SEAT_STATUSES = [
    'ACTIVE',
    'INVITED'
];
function platformActorName(userName, team = 'Lexisora platform') {
    return userName ? `${team} · ${userName}` : team;
}
async function recordPlatformAccess(raw, tenantId, a) {
    await raw.auditLog.create({
        data: {
            tenantId,
            actorUserId: null,
            actorName: a.actorName,
            ip: a.ip ?? null,
            action: a.action.startsWith('platform.') ? a.action : `platform.${a.action}`,
            entity: a.entity,
            entityId: a.entityId ?? null,
            meta: a.meta
        }
    });
}

//# sourceMappingURL=platform.util.js.map