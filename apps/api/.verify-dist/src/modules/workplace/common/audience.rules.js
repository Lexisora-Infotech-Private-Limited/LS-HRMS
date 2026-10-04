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
    get projectIdsByEmployee () {
        return projectIdsByEmployee;
    },
    get resolveAudience () {
        return resolveAudience;
    },
    get ruleMatches () {
        return ruleMatches;
    }
});
function ruleMatches(e, rules) {
    if (!rules.length) return true;
    return rules.some((r)=>{
        switch(r.type){
            case 'ALL':
                return true;
            case 'DEPARTMENT':
                return !!r.refId && e.departmentId === r.refId;
            case 'BRANCH':
                return !!r.refId && e.branchId === r.refId;
            case 'EMPLOYEE':
                return !!r.refId && r.refId === e.id;
            case 'EMPLOYMENT_TYPE':
                return !!r.refId && r.refId === e.employmentType;
            case 'PROJECT':
                return !!r.refId && e.projectIds.includes(r.refId);
            default:
                return false;
        }
    });
}
function resolveAudience(pop, rules) {
    return pop.filter((e)=>ruleMatches(e, rules)).map((e)=>e.id);
}
function projectIdsByEmployee(members, projects) {
    const byEmp = new Map();
    const add = (emp, project)=>{
        let s = byEmp.get(emp);
        if (!s) byEmp.set(emp, s = new Set());
        s.add(project);
    };
    for (const m of members)add(m.employeeId, m.projectId);
    for (const p of projects)if (p.leadEmployeeId) add(p.leadEmployeeId, p.id);
    return byEmp;
}

//# sourceMappingURL=audience.rules.js.map