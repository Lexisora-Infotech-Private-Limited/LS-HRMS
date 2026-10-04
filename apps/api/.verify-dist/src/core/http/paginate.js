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
    get pageArgs () {
        return pageArgs;
    },
    get paginated () {
        return paginated;
    }
});
function pageArgs(q) {
    return {
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize
    };
}
function paginated(items, total, q) {
    return {
        items,
        total,
        page: q.page,
        pageSize: q.pageSize
    };
}

//# sourceMappingURL=paginate.js.map