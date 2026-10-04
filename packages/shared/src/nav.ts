import type { PermissionKey } from './permissions';

export type NavItem = {
  /** Screen id from the wireframe (used in deep links `#screen=<id>`). */
  id: string;
  label: string;
  path: string;
  /** Visible when the user holds this permission (or any of them, for an array). */
  permission: PermissionKey | PermissionKey[];
};

export function canSee(item: Pick<NavItem, 'permission'>, granted: ReadonlySet<string>): boolean {
  const req = Array.isArray(item.permission) ? item.permission : [item.permission];
  return req.some((p) => granted.has(p));
}
export type NavGroup = { group: string; items: NavItem[] };

/** Sidebar navigation, in wireframe order. Visibility = user holds `permission`. */
export const NAV: NavGroup[] = [
  {
    group: 'Home',
    items: [
      { id: 'dashboard', label: 'Dashboard', path: '/dashboard', permission: 'dashboard.view' },
      { id: 'feed', label: 'Company feed', path: '/feed', permission: 'feed.view' },
      { id: 'notices', label: 'Notice board', path: '/notices', permission: 'notices.view' },
      { id: 'chat', label: 'Comms hub', path: '/chat', permission: 'chat.use' },
    ],
  },
  {
    group: 'Time',
    items: [
      { id: 'attendance', label: 'Attendance', path: '/attendance', permission: 'attendance.self' },
      { id: 'timesheet', label: 'My timesheet', path: '/timesheet', permission: 'timesheet.self' },
      { id: 'approvals', label: 'Timesheet approvals', path: '/approvals', permission: ['timesheet.approve.l1', 'timesheet.approve.l2', 'attendance.regularize.approve'] },
      { id: 'leave', label: 'Time off', path: '/leave', permission: 'leave.self' },
      { id: 'leaveAdmin', label: 'Leave setup', path: '/leave-setup', permission: 'leave.manage' },
      { id: 'idcompliance', label: 'ID card compliance', path: '/id-compliance', permission: 'idcompliance.manage' },
    ],
  },
  {
    group: 'Work',
    items: [
      { id: 'projects', label: 'Projects', path: '/projects', permission: 'projects.view' },
      { id: 'clients', label: 'Clients', path: '/clients', permission: 'clients.manage' },
      { id: 'kanban', label: 'Task board', path: '/board', permission: 'tasks.board' },
      { id: 'archive', label: 'Project archive', path: '/archive', permission: ['archive.view', 'projects.view'] },
      { id: 'interns', label: 'Intern task sheets', path: '/interns', permission: 'interns.manage' },
    ],
  },
  {
    group: 'People',
    items: [
      { id: 'employees', label: 'Employees', path: '/employees', permission: 'employees.view' },
      { id: 'onboarding', label: 'Paperless onboarding', path: '/onboarding', permission: 'onboarding.self' },
      { id: 'shifts', label: 'Shifts', path: '/shifts', permission: 'shifts.manage' },
      { id: 'locations', label: 'Work locations', path: '/locations', permission: 'locations.manage' },
      { id: 'appraisal', label: 'Appraisals', path: '/appraisals', permission: 'appraisal.view' },
      { id: 'jobs', label: 'Jobs', path: '/jobs', permission: 'jobs.manage' },
      { id: 'candidates', label: 'Candidates', path: '/candidates', permission: 'candidates.view' },
      { id: 'interviews', label: 'Interviews', path: '/interviews', permission: 'interviews.view' },
    ],
  },
  {
    group: 'Finance',
    items: [
      { id: 'payslips', label: 'My payslips', path: '/payslips', permission: 'payslips.self' },
      { id: 'payroll', label: 'Payroll run', path: '/payroll', permission: 'payroll.manage' },
      { id: 'ledger', label: 'Ledger', path: '/ledger', permission: ['ledger.manage', 'ledger.hrvoucher'] },
      { id: 'invoices', label: 'GST invoices', path: '/invoices', permission: 'invoices.manage' },
      { id: 'purchases', label: 'Purchases & input GST', path: '/purchases', permission: 'purchases.manage' },
      { id: 'filing', label: 'Filing cabinet', path: '/filing', permission: 'filing.manage' },
    ],
  },
  {
    group: 'Workplace',
    items: [
      { id: 'vault', label: 'My digital vault', path: '/vault', permission: 'vault.self' },
      { id: 'idcard', label: 'ID card designer', path: '/id-card', permission: 'idcard.manage' },
      { id: 'vcard', label: 'Visiting card', path: '/visiting-card', permission: 'vcard.self' },
      { id: 'assets', label: 'Assets', path: '/assets', permission: 'assets.manage' },
      { id: 'welcomekit', label: 'Welcome kits', path: '/welcome-kits', permission: 'welcomekit.manage' },
      { id: 'policies', label: 'Policies & rulebook', path: '/policies', permission: 'policies.view' },
      { id: 'helpdesk', label: 'Helpdesk', path: '/helpdesk', permission: 'helpdesk.use' },
      { id: 'lms', label: 'Learning', path: '/learning', permission: 'lms.view' },
      { id: 'kudos', label: 'Kudos & EOTM', path: '/kudos', permission: 'kudos.view' },
      { id: 'facility', label: 'Rooms & visitors', path: '/facility', permission: 'facility.use' },
      { id: 'cctv', label: 'CCTV', path: '/cctv', permission: 'cctv.view' },
      { id: 'wellness', label: 'Wellness games', path: '/wellness', permission: 'wellness.play' },
    ],
  },
  {
    group: 'Admin',
    items: [
      { id: 'roles', label: 'Roles & access', path: '/roles', permission: 'roles.manage' },
      { id: 'settings', label: 'Attendance policy', path: '/attendance-policy', permission: 'settings.attendance' },
      { id: 'audit', label: 'Audit log', path: '/audit', permission: 'audit.view' },
      { id: 'notif', label: 'Alerts', path: '/alerts', permission: 'alerts.view' },
    ],
  },
  {
    group: 'SaaS',
    items: [
      { id: 'billing', label: 'Subscription', path: '/billing', permission: 'billing.manage' },
      { id: 'whitelabel', label: 'Branding', path: '/branding', permission: 'branding.manage' },
      { id: 'tenants', label: 'Tenants', path: '/tenants', permission: 'tenants.manage' },
      { id: 'privacy', label: 'Data privacy', path: '/privacy', permission: 'privacy.view' },
      { id: 'support', label: 'Lexisora support', path: '/support', permission: 'support.use' },
    ],
  },
];

/** Screens reachable by deep link but not in the sidebar. */
export const EXTRA_ROUTES = {
  profile: '/employees/:id',
  myProfile: '/me',
  project: '/projects/:id',
} as const;

export function navItemById(id: string): NavItem | undefined {
  for (const g of NAV) for (const it of g.items) if (it.id === id) return it;
  return undefined;
}
