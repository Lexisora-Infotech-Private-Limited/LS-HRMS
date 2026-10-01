import type { PrivacyOverview } from '@lexisora/shared';
import { restrictedModels } from './privacy.guard';

type RoleLike = { key: string; name: string; isSystem: boolean; permissions: string[] };

const SYSTEM_SHORT: Record<string, string> = { hr: 'HR', admin: 'Admin', manager: 'Rep. Manager', lead: 'Team Lead', employee: 'Employee' };
const SYSTEM_ORDER = ['hr', 'admin', 'manager', 'lead', 'employee'];

/**
 * "Tenant admin" cell from the roles that currently hold any of `keys`: system roles as
 * "HR / Admin", custom roles appended as "+ Payroll clerk" (spec M12: derived from the real config).
 */
export function holdersLabel(roles: readonly RoleLike[], keys: readonly string[]): string {
  const holders = roles.filter((r) => r.permissions.includes('*') || keys.some((k) => r.permissions.includes(k)));
  const system = holders
    .filter((r) => r.isSystem && SYSTEM_SHORT[r.key])
    .sort((a, b) => SYSTEM_ORDER.indexOf(a.key) - SYSTEM_ORDER.indexOf(b.key))
    .map((r) => SYSTEM_SHORT[r.key]!);
  const custom = holders.filter((r) => !(r.isSystem && SYSTEM_SHORT[r.key])).map((r) => r.name).sort((a, b) => a.localeCompare(b));
  if (!system.length && !custom.length) return 'Nobody';
  return [system.join(' / '), ...custom].filter(Boolean).join(' + ');
}

/** The guarantee table (wireframe GEN "privacy"), derived from the tenant's current roles. */
export function privacyRows(roles: readonly RoleLike[]): PrivacyOverview['rows'] {
  return [
    { data: 'Chats & call recordings', tenantAdmin: 'Own users (participants)', platformAdmin: 'No access', platformTone: 'neutral', encryption: 'Isolated per tenant' },
    { data: 'Salaries & payslips', tenantAdmin: holdersLabel(roles, ['employees.compensation', 'payroll.manage']), platformAdmin: 'No access', platformTone: 'neutral', encryption: 'AES-256-GCM (salary structures)' },
    { data: 'Personal documents', tenantAdmin: holdersLabel(roles, ['onboarding.manage', 'employees.manage']), platformAdmin: 'No access', platformTone: 'neutral', encryption: 'AES-256-GCM (PAN, Aadhaar, bank)' },
    { data: 'Usage & billing metrics', tenantAdmin: holdersLabel(roles, ['billing.manage']), platformAdmin: 'Aggregated only', platformTone: 'accent', encryption: 'At rest' },
  ];
}

/** Controls that are enforced in code today (no toggles). */
export function enforcedControls(blockedCount: number): PrivacyOverview['controls'] {
  return [
    {
      title: 'Tenant-scoped data layer',
      detail: 'Every query runs through a tenant filter bound to the signed-in user’s workspace. A session for one workspace can’t read another’s rows.',
    },
    {
      title: 'Platform console can’t reach restricted tables',
      detail: `Lexisora’s cross-tenant endpoints (Tenants, billing, support queue) use a restricted reader that refuses ${blockedCount} chat, salary and personal-document tables and any raw SQL.`,
    },
    {
      title: 'No impersonation',
      detail: 'Lexisora staff have no sign-in to your workspace. Support works from your tickets and from metadata such as plan, seat counts and invoices.',
    },
    {
      title: 'Field encryption and masking',
      detail: 'PAN, Aadhaar, bank accounts and salary structures are stored encrypted (AES-256-GCM) and shown masked unless the viewer holds the right permission.',
    },
    {
      title: 'Every platform action is logged here',
      detail: 'Provisioning, suspensions, grace extensions and support replies by Lexisora staff are written to your audit log (Platform tab) and listed below.',
    },
  ];
}

export const UPCOMING_CONTROLS: PrivacyOverview['upcoming'] = [
  { title: 'Per-tenant keys & rotation', detail: 'A dedicated data key for your workspace, rotated on demand or brought from your own KMS (BYOK).' },
  { title: 'Temporary support access', detail: 'Grant Lexisora engineers time-boxed access to configuration and error logs for one ticket.' },
  { title: 'Full data export', detail: 'An encrypted archive of every record and file, downloadable for 7 days.' },
];

export function blockedModelList(): string[] {
  const r = restrictedModels();
  return [...r.CHAT, ...r.SALARY, ...r.PERSONAL_DOC].sort();
}
