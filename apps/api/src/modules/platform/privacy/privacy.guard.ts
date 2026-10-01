import { Prisma } from '@prisma/client';
import { AppError } from '../../../core/http/errors';

/**
 * Data-privacy enforcement for Lexisora platform (cross-tenant) endpoints.
 *
 * Platform administrators manage tenants, subscriptions and support tickets across every
 * workspace, so those endpoints use the unscoped Prisma client. They must never be able to read a
 * tenant's chats, salaries or personal documents. `platformReader()` wraps the client handed to
 * platform code: touching a restricted model, or issuing raw SQL (which could name any table),
 * throws `403 RESTRICTED_DATA` before a query is built. The restricted set is derived from the
 * Prisma schema at startup, so models other domains add later (e.g. a new `Chat…` or `Payroll…`
 * table) are covered automatically.
 */

export type RestrictedCategory = 'CHAT' | 'SALARY' | 'PERSONAL_DOC';

const RULES: { category: RestrictedCategory; re: RegExp }[] = [
  { category: 'CHAT', re: /^(Chat|Call)[A-Z]/ },
  { category: 'SALARY', re: /^(EmployeeSalary|EmployeePayrollProfile|Salary[A-Z]|Payroll|Payslip|BankTransfer)/ },
  { category: 'PERSONAL_DOC', re: /^(Employee|EmployeeDocument|EmployeeImport|Esign[A-Z]\w*|Onboarding\w*|IdCard|FileObject|Screenshot|Candidate|Vault\w*)$/ },
];

/** Which restricted category a Prisma model belongs to (null = platform staff may read it). */
export function restrictedCategoryOf(model: string): RestrictedCategory | null {
  for (const r of RULES) if (r.re.test(model)) return r.category;
  return null;
}

/** Restricted models present in the current schema, by category. */
export function restrictedModels(models: readonly string[] = Prisma.dmmf.datamodel.models.map((m) => m.name)): Record<RestrictedCategory, string[]> {
  const out: Record<RestrictedCategory, string[]> = { CHAT: [], SALARY: [], PERSONAL_DOC: [] };
  for (const m of models) {
    const c = restrictedCategoryOf(m);
    if (c) out[c].push(m);
  }
  return out;
}

const RAW_SQL = new Set(['$queryRaw', '$queryRawUnsafe', '$executeRaw', '$executeRawUnsafe', '$runCommandRaw']);

export function restrictedDataError(what: string): AppError {
  return new AppError(403, 'RESTRICTED_DATA', `Lexisora platform staff can’t read chats, salaries or personal documents (${what})`);
}

/** Model name of a Prisma client delegate property ("payslip" → "Payslip"). */
const modelOf = (prop: string) => prop.charAt(0).toUpperCase() + prop.slice(1);

/**
 * A Prisma client (or transaction client) that refuses restricted models and raw SQL.
 * Interactive transactions hand the callback a wrapped transaction client as well.
 */
export function platformReader<T extends object>(client: T): T {
  return new Proxy(client, {
    get(target, prop, receiver) {
      if (typeof prop === 'string') {
        if (RAW_SQL.has(prop)) {
          return () => {
            throw restrictedDataError('raw SQL');
          };
        }
        if (!prop.startsWith('$') && restrictedCategoryOf(modelOf(prop))) throw restrictedDataError(modelOf(prop));
        if (prop === '$transaction') {
          const tx = Reflect.get(target, prop, receiver) as (...a: unknown[]) => unknown;
          return (arg: unknown, ...rest: unknown[]) =>
            typeof arg === 'function'
              ? tx.call(target, (inner: object) => (arg as (c: object) => unknown)(platformReader(inner)), ...rest)
              : tx.call(target, arg, ...rest);
        }
      }
      const v = Reflect.get(target, prop, receiver);
      return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(target) : v;
    },
  });
}
