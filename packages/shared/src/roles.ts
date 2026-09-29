/** The five default roles seeded into every tenant. Tenants may add custom roles. */
export const ROLE_KEYS = ['employee', 'lead', 'manager', 'hr', 'admin'] as const;
export type RoleKey = (typeof ROLE_KEYS)[number];

export const ROLE_LABELS: Record<RoleKey, string> = {
  employee: 'Employee',
  lead: 'Team / Project Lead',
  manager: 'Reporting Manager',
  hr: 'HR',
  admin: 'Admin / CEO',
};

/** Short labels used in the roles & access matrix header. */
export const ROLE_SHORT_LABELS: Record<RoleKey, string> = {
  employee: 'Employee',
  lead: 'Team Lead',
  manager: 'Rep. Manager',
  hr: 'HR',
  admin: 'Admin / CEO',
};
