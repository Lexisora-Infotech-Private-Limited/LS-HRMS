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
    get currentTenantId () {
        return currentTenantId;
    },
    get getContext () {
        return getContext;
    },
    get requireContext () {
        return requireContext;
    },
    get runAsTenant () {
        return runAsTenant;
    },
    get runWithContext () {
        return runWithContext;
    }
});
const _nodeasync_hooks = require("node:async_hooks");
const als = new _nodeasync_hooks.AsyncLocalStorage();
function getContext() {
    return als.getStore();
}
function requireContext() {
    const c = als.getStore();
    if (!c) throw new Error('No request context (tenant) is active');
    return c;
}
function currentTenantId() {
    return requireContext().tenantId;
}
function runWithContext(ctx, fn) {
    return als.run(ctx, fn);
}
function runAsTenant(tenantId, fn) {
    return als.run({
        tenantId,
        permissions: new Set([
            '*'
        ])
    }, fn);
}

//# sourceMappingURL=request-context.js.map