"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "toCard", {
    enumerable: true,
    get: function() {
        return toCard;
    }
});
const _workrules = require("../work.rules");
const _workutil = require("../work.util");
function toCard(t, names, rights, me) {
    const assigneeName = t.assigneeEmployeeId ? names.get(t.assigneeEmployeeId) ?? null : null;
    const due = (0, _workutil.dateKey)(t.dueDate);
    return {
        id: t.id,
        key: t.key,
        title: t.title,
        moduleName: t.moduleName,
        status: t.status,
        assigneeEmployeeId: t.assigneeEmployeeId,
        assigneeName,
        assigneeShort: (0, _workrules.shortName)(assigneeName),
        estimatedMinutes: t.estimatedMinutes,
        loggedMinutes: t.loggedMinutes,
        dueDate: due,
        overdue: !!due && due < (0, _workutil.todayKey)() && t.status !== 'DONE' && t.status !== 'CANCELLED',
        gitBranch: t.gitBranch,
        gitMrUrl: t.gitMrUrl,
        gitMrIid: t.gitMrIid,
        gitMrState: t.gitMrState,
        gitSyncStatus: t.gitSyncStatus,
        version: t.version,
        canMove: (0, _workrules.canMoveTask)({
            canManage: rights.canManage,
            canView: rights.canView,
            assigneeEmployeeId: t.assigneeEmployeeId,
            me
        })
    };
}

//# sourceMappingURL=task-mapper.js.map