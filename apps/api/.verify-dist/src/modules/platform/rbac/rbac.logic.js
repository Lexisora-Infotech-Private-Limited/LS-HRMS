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
    get DependencyError () {
        return DependencyError;
    },
    get accessChangeSummary () {
        return accessChangeSummary;
    },
    get applyToggle () {
        return applyToggle;
    },
    get dependentsOf () {
        return dependentsOf;
    },
    get effectivePlan () {
        return effectivePlan;
    },
    get isPermissionKey () {
        return isPermissionKey;
    },
    get label () {
        return label;
    },
    get lockedKeys () {
        return lockedKeys;
    },
    get matrixCellState () {
        return matrixCellState;
    },
    get matrixRow () {
        return matrixRow;
    },
    get planAllows () {
        return planAllows;
    },
    get replacePermissions () {
        return replacePermissions;
    },
    get requiresClosure () {
        return requiresClosure;
    },
    get roleKeyFor () {
        return roleKeyFor;
    }
});
const _shared = require("@lexisora/shared");
const isPermissionKey = (k)=>_shared.PERMISSION_KEYS.includes(k);
function matrixCellState(perms, rowKeys, rowLabel = '') {
    return (0, _shared.matrixCell)(perms, {
        label: rowLabel,
        keys: rowKeys
    });
}
function matrixRow(label) {
    return _shared.ROLE_MATRIX_ROWS.find((r)=>r.label === label);
}
function requiresClosure(keys) {
    const out = new Set();
    const stack = [
        ...keys
    ];
    while(stack.length){
        const k = stack.pop();
        if (out.has(k)) continue;
        out.add(k);
        for (const r of _shared.PERMISSION_REQUIRES[k] ?? [])stack.push(r);
    }
    return out;
}
function dependentsOf(key, enabled) {
    const set = new Set(enabled);
    const out = new Set();
    let frontier = [
        key
    ];
    while(frontier.length){
        const next = [];
        for (const k of set){
            if (out.has(k) || k === key) continue;
            const req = _shared.PERMISSION_REQUIRES[k] ?? [];
            if (req.some((r)=>frontier.includes(r))) {
                out.add(k);
                next.push(k);
            }
        }
        frontier = next;
    }
    return [
        ...out
    ];
}
let DependencyError = class DependencyError extends Error {
    key;
    dependents;
    constructor(key, dependents){
        super(`${label(key)} is needed by ${dependents.map(label).join(', ')}`), this.key = key, this.dependents = dependents;
    }
};
const label = (k)=>_shared.PERMISSIONS[k]?.label ?? k;
function applyToggle(current, keys, enabled, cascade = false) {
    const set = new Set(current);
    const added = [];
    const removed = [];
    if (enabled) {
        for (const k of requiresClosure(keys)){
            if (!set.has(k)) {
                set.add(k);
                added.push(k);
            }
        }
    } else {
        const toRemove = new Set(keys.filter((k)=>set.has(k)));
        for (const k of [
            ...toRemove
        ]){
            const deps = dependentsOf(k, set).filter((d)=>!toRemove.has(d));
            if (deps.length && !cascade) throw new DependencyError(k, deps);
            for (const d of deps)toRemove.add(d);
        }
        for (const k of toRemove){
            set.delete(k);
            removed.push(k);
        }
    }
    // Catalogue order first, then any unknown/legacy keys (kept so nothing is silently dropped).
    const ordered = _shared.PERMISSION_KEYS.filter((k)=>set.has(k));
    return {
        next: ordered.concat([
            ...set
        ].filter((k)=>!isPermissionKey(k))),
        added,
        removed
    };
}
function replacePermissions(current, wanted) {
    const closure = requiresClosure(wanted.filter(isPermissionKey));
    const cur = new Set(current);
    const ordered = _shared.PERMISSION_KEYS.filter((k)=>closure.has(k));
    const added = ordered.filter((k)=>!cur.has(k));
    const removed = current.filter((k)=>isPermissionKey(k) && !closure.has(k));
    const legacy = current.filter((k)=>!isPermissionKey(k));
    return {
        next: ordered.concat(legacy),
        added,
        removed
    };
}
function effectivePlan(sub) {
    if (!sub) return 'INTERNAL';
    if (sub.status === 'CANCELLED') return 'FREE';
    return sub.planCode in _shared.PLAN_RANK ? sub.planCode : 'FREE';
}
function planAllows(plan, key) {
    const min = _shared.PERMISSION_MIN_PLAN[key];
    if (!min) return true;
    return _shared.PLAN_RANK[plan] >= _shared.PLAN_RANK[min];
}
function lockedKeys(plan, keys) {
    return [
        ...keys
    ].filter((k)=>!planAllows(plan, k));
}
function roleKeyFor(name, existing) {
    const base = name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 36) || 'role';
    const taken = new Set(existing);
    if (!taken.has(base)) return base;
    for(let i = 2;; i++)if (!taken.has(`${base}-${i}`)) return `${base}-${i}`;
}
function accessChangeSummary(added, removed) {
    const parts = [
        ...added.map((k)=>`+${label(k)}`),
        ...removed.map((k)=>`−${label(k)}`)
    ];
    return parts.slice(0, 4).join(', ') + (parts.length > 4 ? ` and ${parts.length - 4} more` : '');
}

//# sourceMappingURL=rbac.logic.js.map