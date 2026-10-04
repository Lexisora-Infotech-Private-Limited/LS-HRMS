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
    get platformReader () {
        return platformReader;
    },
    get restrictedCategoryOf () {
        return restrictedCategoryOf;
    },
    get restrictedDataError () {
        return restrictedDataError;
    },
    get restrictedModels () {
        return restrictedModels;
    }
});
const _client = require("@prisma/client");
const _errors = require("../../../core/http/errors");
const RULES = [
    {
        category: 'CHAT',
        re: /^(Chat|Call)[A-Z]/
    },
    {
        category: 'SALARY',
        re: /^(EmployeeSalary|EmployeePayrollProfile|Salary[A-Z]|Payroll|Payslip|BankTransfer)/
    },
    {
        category: 'PERSONAL_DOC',
        re: /^(Employee|EmployeeDocument|EmployeeImport|Esign[A-Z]\w*|Onboarding\w*|IdCard|FileObject|Screenshot|Candidate|Vault\w*)$/
    }
];
function restrictedCategoryOf(model) {
    for (const r of RULES)if (r.re.test(model)) return r.category;
    return null;
}
function restrictedModels(models = _client.Prisma.dmmf.datamodel.models.map((m)=>m.name)) {
    const out = {
        CHAT: [],
        SALARY: [],
        PERSONAL_DOC: []
    };
    for (const m of models){
        const c = restrictedCategoryOf(m);
        if (c) out[c].push(m);
    }
    return out;
}
const RAW_SQL = new Set([
    '$queryRaw',
    '$queryRawUnsafe',
    '$executeRaw',
    '$executeRawUnsafe',
    '$runCommandRaw'
]);
function restrictedDataError(what) {
    return new _errors.AppError(403, 'RESTRICTED_DATA', `Lexisora platform staff can’t read chats, salaries or personal documents (${what})`);
}
/** Model name of a Prisma client delegate property ("payslip" → "Payslip"). */ const modelOf = (prop)=>prop.charAt(0).toUpperCase() + prop.slice(1);
function platformReader(client) {
    return new Proxy(client, {
        get (target, prop, receiver) {
            if (typeof prop === 'string') {
                if (RAW_SQL.has(prop)) {
                    return ()=>{
                        throw restrictedDataError('raw SQL');
                    };
                }
                if (!prop.startsWith('$') && restrictedCategoryOf(modelOf(prop))) throw restrictedDataError(modelOf(prop));
                if (prop === '$transaction') {
                    const tx = Reflect.get(target, prop, receiver);
                    return (arg, ...rest)=>typeof arg === 'function' ? tx.call(target, (inner)=>arg(platformReader(inner)), ...rest) : tx.call(target, arg, ...rest);
                }
            }
            const v = Reflect.get(target, prop, receiver);
            return typeof v === 'function' ? v.bind(target) : v;
        }
    });
}

//# sourceMappingURL=privacy.guard.js.map