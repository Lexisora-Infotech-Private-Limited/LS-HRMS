/**
 * Timesheet approval routing (spec-time K3 + audit G3), pure.
 *
 *  L1: one step per project that has minutes on the sheet, approver = project lead.
 *      - internal projects (INT stand-ups, training) have no L1 — the RM reviews them at L2
 *      - a project without a lead has no L1 (falls to L2)
 *      - when the lead is the employee: SKIPPED_SELF
 *  L2: approver = employee.managerId → fallback approver → any admin.
 *      - skipDuplicateApprover: when the RM already approved an L1 step this cycle → SKIPPED_DUPLICATE
 */ "use strict";
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
    get planL1 () {
        return planL1;
    },
    get planL2 () {
        return planL2;
    },
    get statusAfterL1 () {
        return statusAfterL1;
    },
    get submitMessage () {
        return submitMessage;
    }
});
function planL1(employeeId, lines, projects) {
    const minutesByProject = new Map();
    for (const l of lines){
        if (!l.projectId || l.minutes <= 0) continue;
        minutesByProject.set(l.projectId, (minutesByProject.get(l.projectId) ?? 0) + l.minutes);
    }
    const out = [];
    for (const projectId of minutesByProject.keys()){
        const p = projects.get(projectId);
        if (!p || p.isInternal || !p.leadEmployeeId) continue;
        out.push({
            projectId,
            projectName: p.name,
            approverEmployeeId: p.leadEmployeeId,
            status: p.leadEmployeeId === employeeId ? 'SKIPPED_SELF' : 'PENDING'
        });
    }
    return out.sort((a, b)=>a.projectName.localeCompare(b.projectName));
}
function planL2(p) {
    const candidates = [
        p.managerId,
        p.fallbackApproverId,
        ...p.adminEmployeeIds ?? []
    ].filter((x)=>!!x && x !== p.employeeId);
    const approver = candidates[0];
    if (!approver) return null;
    if (p.skipDuplicateApprover && p.l1ApprovedBy.includes(approver)) return {
        approverEmployeeId: approver,
        status: 'SKIPPED_DUPLICATE'
    };
    return {
        approverEmployeeId: approver,
        status: 'PENDING'
    };
}
function statusAfterL1(l1Statuses) {
    return l1Statuses.some((s)=>s === 'PENDING') ? 'SUBMITTED' : 'L2';
}
function submitMessage(pendingL1Names, l2Name, finalStatus) {
    if (pendingL1Names.length === 1) return `Timesheet sent to ${pendingL1Names[0]} (Project Lead)`;
    if (pendingL1Names.length > 1) return `Sent to ${pendingL1Names.length} Project Leads`;
    if (finalStatus === 'APPROVED') return 'Timesheet approved · sent to payroll';
    return l2Name ? `Timesheet sent to ${l2Name} (Reporting Manager)` : 'Timesheet submitted';
}

//# sourceMappingURL=routing.js.map