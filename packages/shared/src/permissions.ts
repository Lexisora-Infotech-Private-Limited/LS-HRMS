import type { RoleKey } from './roles';

const ALL: RoleKey[] = ['employee', 'lead', 'manager', 'hr', 'admin'];
const HRA: RoleKey[] = ['hr', 'admin'];
const ADM: RoleKey[] = ['admin'];
const MGMT: RoleKey[] = ['lead', 'manager', 'hr', 'admin'];

type PermissionDef = { label: string; group: string; roles: RoleKey[] };

/**
 * Permission catalogue. Keys are `module.action`. `roles` are the default grants
 * seeded for every new tenant; tenants can change them on the Roles & access screen.
 * Defaults follow the wireframe's NAV visibility and roles matrix.
 */
export const PERMISSIONS = {
  // Home
  'dashboard.view': { label: 'View dashboard', group: 'Home', roles: ALL },
  'feed.view': { label: 'View company feed', group: 'Home', roles: ALL },
  'feed.publish': { label: 'Publish feed posts', group: 'Home', roles: HRA },
  'notices.view': { label: 'View notice board', group: 'Home', roles: ALL },
  'notices.publish.global': { label: 'Publish global notices', group: 'Home', roles: HRA },
  'notices.publish.team': { label: 'Publish team notices', group: 'Home', roles: MGMT },
  'chat.use': { label: 'Use comms hub', group: 'Home', roles: ALL },
  'quotes.manage': { label: 'Manage thought of the day', group: 'Home', roles: HRA },

  // Time
  'attendance.self': { label: 'Own attendance & punch', group: 'Time', roles: ALL },
  'attendance.team': { label: 'View team attendance', group: 'Time', roles: ['lead', 'manager', 'hr', 'admin'] },
  'attendance.manage': { label: 'Manage attendance & regularize', group: 'Time', roles: HRA },
  'timesheet.self': { label: 'Own timesheet', group: 'Time', roles: ALL },
  'timesheet.approve.l1': { label: 'Approve timesheets (Level 1 · Project Lead)', group: 'Time', roles: ['lead', 'admin'] },
  // Leads can be Reporting Managers too (wireframe: Vikram reports to Arjun). Approvers only
  // ever see steps routed to them (project lead → L1, employee.managerId → L2); admin sees all.
  'timesheet.approve.l2': { label: 'Approve timesheets (Level 2 · Reporting Manager)', group: 'Time', roles: ['lead', 'manager', 'admin'] },
  'attendance.regularize.approve': { label: 'Approve attendance regularizations', group: 'Time', roles: ['lead', 'manager', 'hr', 'admin'] },
  'attendance.lock': { label: 'Lock attendance periods', group: 'Time', roles: HRA },
  'screenshots.view': { label: 'View tracker screenshots of reports', group: 'Time', roles: ['lead', 'manager', 'admin'] },
  'leave.self': { label: 'Apply time off', group: 'Time', roles: ALL },
  'leave.approve': { label: 'Approve time off', group: 'Time', roles: ['manager', 'hr', 'admin'] },
  'leave.manage': { label: 'Leave setup & credits', group: 'Time', roles: HRA },
  'idcompliance.manage': { label: 'ID card compliance checks', group: 'Time', roles: HRA },
  'holidays.manage': { label: 'Manage holiday calendar', group: 'Time', roles: HRA },

  // Work
  'projects.view': { label: 'View projects', group: 'Work', roles: ALL },
  'projects.manage': { label: 'Create & manage projects', group: 'Work', roles: ['lead', 'manager', 'admin'] },
  'tasks.board': { label: 'Use own team task boards', group: 'Work', roles: ALL },
  'tasks.manage': { label: 'Create & assign tasks', group: 'Work', roles: ALL },
  'tasks.viewAllBoards': { label: 'View all task boards', group: 'Work', roles: ['manager', 'admin'] },
  'archive.view': { label: 'Project archive & client vault', group: 'Work', roles: ['lead', 'manager', 'admin'] },
  'archive.manage': { label: 'Archive projects & change archive access', group: 'Work', roles: ['manager', 'admin'] },
  'interns.manage': { label: 'Intern task sheets', group: 'Work', roles: ['lead', 'hr', 'admin'] },
  'interns.viewAll': { label: 'All interns (not only mentees)', group: 'Work', roles: ['hr', 'admin'] },
  'clients.manage': { label: 'Manage clients', group: 'Work', roles: ['lead', 'manager', 'admin'] },
  'git.manage': { label: 'GitLab integration settings', group: 'Work', roles: ADM },

  // People
  'employees.view': { label: 'View employee directory', group: 'People', roles: ['manager', 'hr', 'admin'] },
  'employees.manage': { label: 'Add & edit employees', group: 'People', roles: HRA },
  'employees.compensation': { label: 'View compensation', group: 'People', roles: HRA },
  'onboarding.self': { label: 'Complete own onboarding', group: 'People', roles: ALL },
  'onboarding.manage': { label: 'Manage onboarding & verify documents', group: 'People', roles: HRA },
  'shifts.manage': { label: 'Shifts', group: 'People', roles: HRA },
  'locations.manage': { label: 'Work locations', group: 'People', roles: HRA },
  'appraisal.view': { label: 'View appraisals', group: 'People', roles: ['manager', 'hr', 'admin'] },
  'appraisal.manage': { label: 'Manage appraisal cycles', group: 'People', roles: HRA },
  'jobs.manage': { label: 'Jobs', group: 'People', roles: HRA },
  'candidates.view': { label: 'View candidates', group: 'People', roles: ['lead', 'hr', 'admin'] },
  'candidates.manage': { label: 'Recruitment', group: 'People', roles: ['lead', 'hr', 'admin'] },
  'interviews.view': { label: 'Interviews', group: 'People', roles: ['lead', 'manager', 'hr', 'admin'] },
  'masters.manage': { label: 'Departments, designations & branches', group: 'People', roles: HRA },

  // Finance
  'payslips.self': { label: 'Own payslips', group: 'Finance', roles: ALL },
  'payroll.manage': { label: 'Payroll run', group: 'Finance', roles: HRA },
  'ledger.manage': { label: 'Ledger & vouchers', group: 'Finance', roles: ADM },
  'ledger.hrvoucher': { label: 'Raise HR vouchers', group: 'Finance', roles: HRA },
  'invoices.manage': { label: 'GST invoices', group: 'Finance', roles: ADM },
  'purchases.manage': { label: 'Purchases & input GST', group: 'Finance', roles: ADM },
  'filing.manage': { label: 'Filing cabinet', group: 'Finance', roles: ADM },

  // Workplace
  'vault.self': { label: 'Own digital vault', group: 'Workplace', roles: ALL },
  'idcard.manage': { label: 'ID card designer', group: 'Workplace', roles: HRA },
  'vcard.self': { label: 'Visiting card', group: 'Workplace', roles: ALL },
  'assets.manage': { label: 'Assets & inventory', group: 'Workplace', roles: HRA },
  'welcomekit.manage': { label: 'Welcome kits', group: 'Workplace', roles: HRA },
  'policies.view': { label: 'Read policies', group: 'Workplace', roles: ALL },
  'policies.manage': { label: 'Publish policies', group: 'Workplace', roles: HRA },
  'helpdesk.use': { label: 'Raise helpdesk tickets', group: 'Workplace', roles: ALL },
  'helpdesk.agent': { label: 'Work helpdesk tickets', group: 'Workplace', roles: HRA },
  'lms.view': { label: 'Take courses', group: 'Workplace', roles: ALL },
  'lms.manage': { label: 'Publish courses', group: 'Workplace', roles: HRA },
  'kudos.view': { label: 'View kudos', group: 'Workplace', roles: ALL },
  'kudos.give': { label: 'Give kudos', group: 'Workplace', roles: MGMT },
  'kudos.eotm': { label: 'Announce Employee of the Month', group: 'Workplace', roles: HRA },
  'facility.use': { label: 'Book rooms & register visitors', group: 'Workplace', roles: ALL },
  'facility.manage': { label: 'Manage rooms', group: 'Workplace', roles: HRA },
  'cctv.view': { label: 'CCTV feeds', group: 'Workplace', roles: ADM },
  'cctv.manage': { label: 'Manage CCTV cameras', group: 'Workplace', roles: ADM },
  'wellness.play': { label: 'Wellness games', group: 'Workplace', roles: ALL },

  // Admin
  'roles.manage': { label: 'Roles & access', group: 'Admin', roles: ADM },
  'settings.attendance': { label: 'Attendance policy', group: 'Admin', roles: HRA },
  'alerts.view': { label: 'Alerts', group: 'Admin', roles: ALL },
  'audit.view': { label: 'Audit log', group: 'Admin', roles: ADM },
  'devices.manage': { label: 'Manage tracker devices', group: 'Admin', roles: HRA },
  'mobile.access': { label: 'Mobile app access', group: 'Admin', roles: HRA },

  // SaaS
  'billing.manage': { label: 'Subscription & billing', group: 'SaaS', roles: ADM },
  'branding.manage': { label: 'Branding', group: 'SaaS', roles: ADM },
  'tenants.manage': { label: 'Tenants (platform)', group: 'SaaS', roles: ADM },
  'privacy.view': { label: 'Data privacy', group: 'SaaS', roles: ADM },
  'support.use': { label: 'Lexisora support', group: 'SaaS', roles: ADM },
} satisfies Record<string, PermissionDef>;

export type PermissionKey = keyof typeof PERMISSIONS;
export const PERMISSION_KEYS = Object.keys(PERMISSIONS) as PermissionKey[];

export function defaultPermissionsFor(role: RoleKey): PermissionKey[] {
  return PERMISSION_KEYS.filter((k) => (PERMISSIONS[k].roles as RoleKey[]).includes(role));
}

/**
 * Rows shown on the Roles & access matrix (the wireframe's curated list), each
 * mapped to the permission keys it toggles together.
 */
export const ROLE_MATRIX_ROWS: { label: string; keys: PermissionKey[] }[] = [
  { label: 'Mobile app access', keys: ['mobile.access'] },
  { label: 'Approve timesheets', keys: ['timesheet.approve.l1', 'timesheet.approve.l2'] },
  { label: 'View all task boards', keys: ['tasks.viewAllBoards'] },
  { label: 'Payroll & ledger', keys: ['payroll.manage', 'ledger.manage'] },
  { label: 'Publish global notices', keys: ['notices.publish.global'] },
  { label: 'Publish team notices', keys: ['notices.publish.team'] },
  { label: 'Recruitment', keys: ['candidates.manage'] },
  { label: 'CCTV feeds', keys: ['cctv.view'] },
];
