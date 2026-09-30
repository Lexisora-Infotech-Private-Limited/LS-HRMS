import { z } from 'zod';
import { paginationQuery } from '../api';
import { istDateKey } from '../format';
import { NAV, canSee } from '../nav';
import { PERMISSIONS, type PermissionKey } from '../permissions';

/**
 * Platform domain contracts: Roles & access, Audit log, Subscription & billing, Branding,
 * Tenants, Data privacy and Lexisora support. Zod schemas validate API input; the
 * constants and pure helpers are shared by the API (authoritative) and the web (preview).
 */

// ── Plans & pricing ──────────────────────────────────────────────────────────

export const PLAN_CODES = ['FREE', 'GROWTH', 'ENTERPRISE', 'INTERNAL'] as const;
export type PlanCode = (typeof PLAN_CODES)[number];
export const BILLING_CYCLES = ['MONTHLY', 'YEARLY'] as const;
export type BillingCycleKey = (typeof BILLING_CYCLES)[number];

/** First 10 users are free on every plan. */
export const FREE_SEATS = 10;
/** Growth price per chargeable seat per month, in paise. */
export const GROWTH_PRICE_PAISE: Record<BillingCycleKey, number> = { MONTHLY: 17900, YEARLY: 14900 };
/** "Yearly · save 17%". */
export const YEARLY_SAVINGS_PCT = Math.round((1 - GROWTH_PRICE_PAISE.YEARLY / GROWTH_PRICE_PAISE.MONTHLY) * 100);

export const PLAN_CARDS: { code: 'FREE' | 'GROWTH' | 'ENTERPRISE'; name: string; unit: string; feats: string[] }[] = [
  { code: 'FREE', name: 'Free', unit: 'up to 10 users', feats: ['Attendance & leave', 'Projects & tasks', 'Community support'] },
  { code: 'GROWTH', name: 'Growth', unit: 'per user / month', feats: ['Everything in Free', 'Payroll, ledger & GST', 'Desktop tracker', 'White-label theme'] },
  { code: 'ENTERPRISE', name: 'Enterprise', unit: '200+ users', feats: ['Dedicated database', 'CCTV & biometric integrations', '24/7 priority support'] },
];

export const PLAN_LABELS: Record<PlanCode, string> = { FREE: 'Free', GROWTH: 'Growth', ENTERPRISE: 'Enterprise', INTERNAL: 'Internal' };

/** Plan rank used for feature gating. INTERNAL (the operator's own tenant) has everything. */
export const PLAN_RANK: Record<PlanCode, number> = { FREE: 0, GROWTH: 1, ENTERPRISE: 2, INTERNAL: 3 };

/**
 * Permissions that need a paid plan (tenants on Free see these toggles disabled with a
 * "Growth" tag, and the API answers 402 FEATURE_NOT_IN_PLAN).
 */
export const PERMISSION_MIN_PLAN: Partial<Record<PermissionKey, 'GROWTH' | 'ENTERPRISE'>> = {
  'payroll.manage': 'GROWTH',
  'ledger.manage': 'GROWTH',
  'ledger.hrvoucher': 'GROWTH',
  'invoices.manage': 'GROWTH',
  'purchases.manage': 'GROWTH',
  'filing.manage': 'GROWTH',
  'branding.manage': 'GROWTH',
  'candidates.manage': 'GROWTH',
  'jobs.manage': 'GROWTH',
  'appraisal.manage': 'GROWTH',
  'assets.manage': 'GROWTH',
  'welcomekit.manage': 'GROWTH',
  'idcard.manage': 'GROWTH',
  'lms.manage': 'GROWTH',
  'kudos.eotm': 'GROWTH',
  'facility.manage': 'GROWTH',
};

/**
 * Permission dependencies: enabling a key also enables what it requires; disabling a key
 * that another enabled key requires is refused unless cascaded.
 */
export const PERMISSION_REQUIRES: Partial<Record<PermissionKey, PermissionKey[]>> = {
  'payroll.manage': ['employees.compensation'],
  'employees.compensation': ['employees.view'],
  'employees.manage': ['employees.view'],
  'onboarding.manage': ['employees.view'],
  'candidates.manage': ['candidates.view'],
  'appraisal.manage': ['appraisal.view'],
  'projects.manage': ['projects.view'],
  'tasks.viewAllBoards': ['tasks.board'],
  'kudos.eotm': ['kudos.give'],
  'kudos.give': ['kudos.view'],
  'helpdesk.agent': ['helpdesk.use'],
  'lms.manage': ['lms.view'],
  'policies.manage': ['policies.view'],
  'facility.manage': ['facility.use'],
  'notices.publish.global': ['notices.view'],
  'notices.publish.team': ['notices.view'],
};

/** Matrix rows / keys that ask for confirmation before changing. */
export const HIGH_RISK_KEYS: PermissionKey[] = ['mobile.access', 'payroll.manage', 'ledger.manage', 'cctv.view', 'roles.manage'];

/** Brand palette presets (wireframe PALS). */
export const BRAND_PRESETS = [
  { key: 'lexisora-pink-blue', name: 'Lexisora · pink & blue', primary: '#d6457a', secondary: '#2f5fb3' },
  { key: 'acme-red-black', name: 'Acme · red & black', primary: '#c62828', secondary: '#1c1c1c' },
  { key: 'default-gold-ink', name: 'Default · gold & ink', primary: '#b68235', secondary: '#2d2b2b' },
] as const;

// ── Pure helpers shared with the web preview ────────────────────────────────

/** Paise for one seat over a whole period (monthly 17900, yearly 178800). */
export function seatPeriodPaise(cycle: BillingCycleKey, unitPaise = GROWTH_PRICE_PAISE[cycle]): number {
  return cycle === 'YEARLY' ? unitPaise * 12 : unitPaise;
}

export function chargeableSeats(quantity: number, freeSeats = FREE_SEATS): number {
  return Math.max(0, quantity - freeSeats);
}

/** WCAG relative luminance contrast ratio between two #rrggbb colours. */
export function contrastRatio(a: string, b: string): number {
  const lum = (hex: string) => {
    const n = hex.replace('#', '');
    const ch = [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * ch[0]! + 0.7152 * ch[1]! + 0.0722 * ch[2]!;
  };
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p) as [number, number];
  return Math.round(((x + 0.05) / (y + 0.05)) * 100) / 100;
}

export const HEX_RE = /^#[0-9a-fA-F]{6}$/;
/** Hostname such as acme.hrms.app or hr.acme.com. */
export const HOST_RE = /^(?=.{4,100}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/;

// ── Roles & access ──────────────────────────────────────────────────────────

export const createRoleSchema = z.object({
  name: z.string().trim().min(2, 'Role name needs at least 2 characters').max(40, 'Role name is too long'),
  copyFromRoleId: z
    .string()
    .nullish()
    .transform((v) => (v ? v : null)),
  description: z.string().trim().max(200).nullish(),
});
export type CreateRoleInput = z.infer<typeof createRoleSchema>;

export const updateRoleSchema = z.object({
  name: z.string().trim().min(2).max(40).optional(),
  description: z.string().trim().max(200).nullish(),
});
export type UpdateRoleInput = z.infer<typeof updateRoleSchema>;

export const setPermissionSchema = z.object({
  enabled: z.boolean(),
  cascade: z.boolean().optional(),
});
export type SetPermissionInput = z.infer<typeof setPermissionSchema>;

export const setMatrixRowSchema = z.object({
  row: z.string().min(1),
  enabled: z.boolean(),
});
export type SetMatrixRowInput = z.infer<typeof setMatrixRowSchema>;

export const roleMembersSchema = z.object({ userIds: z.array(z.string().min(1)).min(1, 'Pick at least one person') });
export type RoleMembersInput = z.infer<typeof roleMembersSchema>;

/**
 * Replace a role's whole permission set (used by "Undo" and the per-role editor's group "Turn all
 * on / off"). Requires are auto-added. `group` names the permission group of a bulk edit (audit copy).
 */
export const setRolePermissionsSchema = z.object({
  permissions: z.array(z.string().min(1)).max(500),
  reason: z.enum(['undo', 'group']).optional(),
  group: z.string().trim().max(60).optional(),
});
export type SetRolePermissionsInput = z.infer<typeof setRolePermissionsSchema>;

/** Audit context for a whole-set replace: "undo" / "group “People”". */
export function setAllContext(input: Pick<SetRolePermissionsInput, 'reason' | 'group'>): string {
  if (input.reason === 'group' && input.group) return `group “${input.group}”`;
  return input.reason === 'group' ? 'group edit' : 'undo';
}

export type MatrixCellState = 'all' | 'some' | 'none';

/**
 * Matrix rows whose keys are alternatives rather than a bundle: "Approve timesheets" covers
 * Level 1 (Project Lead) and Level 2 (Reporting Manager); approvers only see steps routed to them,
 * so holding either level shows the row as on (wireframe: Team Lead ✓, Rep. Manager ✓).
 */
export const MATRIX_ANY_OF_ROWS: readonly string[] = ['Approve timesheets'];

/** Cell state for a role on a matrix row: every key → all, some keys → some (half fill), none → none. */
export function matrixCell(perms: Iterable<string>, row: { label: string; keys: readonly string[] }): MatrixCellState {
  const set = new Set(perms);
  const held = row.keys.filter((k) => set.has(k)).length;
  if (held === 0) return 'none';
  if (held === row.keys.length || MATRIX_ANY_OF_ROWS.includes(row.label)) return 'all';
  return 'some';
}

export type RoleDto = {
  id: string;
  key: string;
  name: string;
  shortName: string;
  description: string | null;
  isSystem: boolean;
  permissions: string[];
  memberCount: number;
  isMine: boolean;
};

export type RolesResponse = {
  roles: RoleDto[];
  matrix: { label: string; keys: string[]; cells: Record<string, MatrixCellState> }[];
  groups: { group: string; items: { key: string; label: string; minPlan: 'GROWTH' | 'ENTERPRISE' | null; locked: boolean; requires: string[]; highRisk: boolean }[] }[];
  plan: PlanCode;
};

export type RoleChangeResult = { role: RoleDto; added: string[]; removed: string[] };

/**
 * Per-role editor group toggle: whether every togglable key of the group is on (→ "Turn all off")
 * and which keys the click changes. Plan-locked keys the role doesn't hold can't be turned on, and
 * an admin's own Roles & access is never part of a "Turn all off".
 */
export function groupBulkKeys(
  role: Pick<RoleDto, 'permissions' | 'isMine'>,
  items: readonly { key: string; locked: boolean }[],
): { allOn: boolean; keys: string[] } {
  const held = new Set(role.permissions);
  const togglable = items.filter((i) => !i.locked || held.has(i.key));
  const allOn = togglable.length > 0 && togglable.every((i) => held.has(i.key));
  const keys = allOn
    ? togglable.filter((i) => !(i.key === 'roles.manage' && role.isMine)).map((i) => i.key)
    : items.filter((i) => !i.locked && !held.has(i.key)).map((i) => i.key);
  return { allOn, keys };
}

export type RoleMemberDto = {
  userId: string;
  name: string;
  email: string;
  empCode: string | null;
  department: string | null;
  status: string;
  /** When the person was moved into this role (last `rbac.member.added`), else when their login was created. */
  since: string;
  assignedBy: string | null;
};

/** Toast copy for dependency auto-enables: "Also enabled: People › View compensation". */
export function alsoEnabledCopy(added: readonly string[], toggled: readonly string[]): string | null {
  const order = Object.keys(PERMISSIONS);
  const extra = added.filter((k) => !toggled.includes(k)).sort((a, b) => order.indexOf(a) - order.indexOf(b));
  if (!extra.length) return null;
  const defs = PERMISSIONS as Record<string, { label: string; group: string }>;
  return `Also enabled: ${extra.map((k) => (defs[k] ? `${defs[k]!.group} › ${defs[k]!.label}` : k)).join(', ')}`;
}

/** Mobile access is meant for top-level roles only (wireframe note). */
export const TOP_LEVEL_ROLE_KEYS = ['hr', 'admin'] as const;

// ── Alerts (core /notifications, rendered by the platform Alerts screen) ──────

export const ALERT_TABS = ['all', 'unread', 'approvals', 'reminders'] as const;
export type AlertTab = (typeof ALERT_TABS)[number];
export type AlertCategory = 'approval' | 'reminder' | 'info';

/** Buckets free-form notification types for the Alerts tabs. */
export function alertCategory(type: string, link?: string | null, title?: string | null): AlertCategory {
  const t = type.toLowerCase();
  const ttl = (title ?? '').toLowerCase();
  if ((link ?? '').startsWith('/approvals') || /approv|request|submitted|claim|pending|awaiting_decision/.test(t) || /awaiting your (approval|decision)|needs your approval/.test(ttl)) return 'approval';
  if (/remind|due|acknowledg|birthday|anniversar|expir|incomplete|missing|renewal/.test(t) || /^(reminder|acknowledge|birthday)|awaiting your submission|due (today|tomorrow)/.test(ttl)) return 'reminder';
  return 'info';
}

/** "Today" / "Yesterday" / "26 Sep" / "26 Sep 2025" — business days in IST. */
export function alertWhenLabel(at: Date | string, now: Date = new Date()): string {
  const d = new Date(at);
  const key = istDateKey(d);
  if (key === istDateKey(now)) return 'Today';
  if (key === istDateKey(new Date(now.getTime() - 86_400_000))) return 'Yesterday';
  // Anything else — including a future date such as an upcoming birthday — shows the date.
  // Built from the IST date key so every runtime prints "Sep" (some ICU builds say "Sept").
  const [y, m, day] = key.split('-');
  const label = `${Number(day)} ${MONTH_SHORT[Number(m) - 1]}`;
  return y === istDateKey(now).slice(0, 4) ? label : `${label} ${y}`;
}
const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "29 Sep 2026" (IST business day) — independent of the runtime's ICU month names ("Sept"). */
export function dayMonthYear(at: Date | string): string {
  const [y, m, d] = istDateKey(new Date(at)).split('-');
  return `${Number(d)} ${MONTH_SHORT[Number(m) - 1]} ${y}`;
}

export type AlertDto = {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  fromLabel: string;
  readAt: string | null;
  createdAt: string;
  when?: string;
};

// ── Global search (core /search, rendered by the platform header component) ──

export type SearchGroupDto = { type: string; hits: { type: string; id: string; title: string; subtitle?: string; link: string }[] };

const SEARCH_TYPE_LABELS: Record<string, string> = {
  people: 'People',
  tasks: 'Tasks',
  projects: 'Projects',
  documents: 'Documents',
  notices: 'Notices & posts',
  tickets: 'Tickets',
  candidates: 'Candidates',
  payslips: 'Payslips',
  goto: 'Go to',
};
/**
 * Display order of result groups in the header dropdown (spec M8): People, Tasks, Documents, Projects,
 * Notices & posts, Tickets, Candidates; other domains' types follow alphabetically; "Go to" is last.
 */
export const SEARCH_TYPE_ORDER = ['people', 'tasks', 'documents', 'projects', 'notices', 'tickets', 'candidates', 'payslips'];

export function searchTypeLabel(type: string): string {
  const k = type.toLowerCase();
  return SEARCH_TYPE_LABELS[k] ?? type.charAt(0).toUpperCase() + type.slice(1).replace(/[-_]/g, ' ');
}

export function sortSearchGroups<T extends { type: string }>(groups: T[]): T[] {
  const rank = (t: string) => {
    const k = t.toLowerCase();
    if (k === 'goto') return SEARCH_TYPE_ORDER.length + 1;
    const i = SEARCH_TYPE_ORDER.indexOf(k);
    return i === -1 ? SEARCH_TYPE_ORDER.length : i;
  };
  return [...groups].sort((a, b) => rank(a.type) - rank(b.type) || a.type.localeCompare(b.type));
}

/** "Go to" results: sidebar screens the user can open whose label matches every word of the query. */
export function navMatches(q: string, granted: ReadonlySet<string>, limit = 5): { id: string; label: string; path: string; group: string }[] {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const out: { id: string; label: string; path: string; group: string }[] = [];
  for (const g of NAV) {
    for (const it of g.items) {
      if (!canSee(it, granted)) continue;
      const hay = `${it.label} ${g.group}`.toLowerCase();
      if (words.every((w) => hay.includes(w))) out.push({ id: it.id, label: it.label, path: it.path, group: g.group });
    }
  }
  // Label-prefix matches first ("rol" → Roles & access before Payroll).
  out.sort((a, b) => Number(!a.label.toLowerCase().startsWith(words[0]!)) - Number(!b.label.toLowerCase().startsWith(words[0]!)));
  return out.slice(0, limit);
}

// ── Audit log ───────────────────────────────────────────────────────────────

export const AUDIT_TABS = ['all', 'security', 'access', 'platform'] as const;
export const AUDIT_RESULTS = ['success', 'denied', 'failure'] as const;
export type AuditResult = (typeof AUDIT_RESULTS)[number];
export const auditQuerySchema = paginationQuery.extend({
  tab: z.enum(AUDIT_TABS).default('all'),
  actor: z.string().optional(),
  action: z.string().optional(),
  module: z.string().regex(/^[a-zA-Z0-9_-]+$/).optional(),
  result: z.enum(AUDIT_RESULTS).optional(),
  entity: z.string().optional(),
  entityId: z.string().optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});
export type AuditQuery = z.infer<typeof auditQuerySchema>;

/** Result column: denials (RBAC, blocked punches, rejected syncs) and failures (failed sign-ins, errors). */
export function auditResultOf(action: string): AuditResult {
  const a = action.toLowerCase();
  if (/(^|\.)(denied|blocked|forbidden)$/.test(a) || a === 'punch.rejected' || a === 'tracker.sync.rejected') return 'denied';
  if (/fail|error/.test(a)) return 'failure';
  return 'success';
}

export type AuditRowDto = {
  id: string;
  createdAt: string;
  actorUserId: string | null;
  actorName: string;
  action: string;
  module: string;
  entity: string;
  entityId: string | null;
  summary: string;
  ip: string | null;
  meta: unknown;
  platform: boolean;
  result: AuditResult;
};

export type AuditFacets = { actors: { value: string; label: string }[]; entities: string[]; modules: string[] };

export type AuditChangeRow = { field: string; before: string; after: string };

/**
 * Before/after pairs for the audit drawer, from whichever shape the producer used:
 * `{from, to}`, `{before: {…}, after: {…}}` or `{changes: {field: {from, to} | [before, after] | "[redacted]"}}`.
 * A bare value under `changes` (e.g. a redacted field) shows as changed with no before value.
 */
export function auditChangeRows(meta: unknown): AuditChangeRow[] {
  const obj = (v: unknown) => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
  const fmt = (v: unknown) => (v === null || v === undefined || v === '' ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v));
  const m = obj(meta);
  if (!m) return [];
  const rows: AuditChangeRow[] = [];
  if ('from' in m || 'to' in m) rows.push({ field: 'Change', before: fmt(m.from), after: fmt(m.to) });
  const b = obj(m.before);
  const a = obj(m.after);
  if (b || a) for (const k of new Set([...Object.keys(b ?? {}), ...Object.keys(a ?? {})])) rows.push({ field: k, before: fmt(b?.[k]), after: fmt(a?.[k]) });
  const ch = obj(m.changes);
  if (ch) {
    for (const [k, v] of Object.entries(ch)) {
      const pair = obj(v);
      if (Array.isArray(v) && v.length === 2) rows.push({ field: k, before: fmt(v[0]), after: fmt(v[1]) });
      else if (pair && ('from' in pair || 'to' in pair)) rows.push({ field: k, before: fmt(pair.from), after: fmt(pair.to) });
      else rows.push({ field: k, before: '—', after: fmt(v) });
    }
  }
  return rows;
}

// ── Subscription & billing ─────────────────────────────────────────────────

export const quoteSchema = z.object({
  planCode: z.literal('GROWTH'),
  cycle: z.enum(BILLING_CYCLES),
  quantity: z.coerce.number().int().min(FREE_SEATS + 1, 'Growth needs at least 11 seats').max(100000),
});
export type QuoteInput = z.infer<typeof quoteSchema>;
export const checkoutSchema = quoteSchema;
export type CheckoutInput = QuoteInput;

export const seatsSchema = z.object({ quantity: z.coerce.number().int().min(1).max(100000) });
export const promoSchema = z.object({ code: z.string().trim().min(2, 'Enter a promo code').max(40).transform((s) => s.toUpperCase()) });
export const contactSalesSchema = z.object({
  name: z.string().trim().min(2, 'Name is required'),
  email: z.string().trim().email('Enter a valid email'),
  phone: z.string().trim().max(20).nullish(),
  seats: z.coerce.number().int().min(1).nullish(),
  message: z.string().trim().max(2000).nullish(),
});
export type ContactSalesInput = z.infer<typeof contactSalesSchema>;
export const confirmPaymentSchema = z.object({ outcome: z.enum(['success', 'fail']) });

export type QuoteLine = { kind: 'SEATS' | 'PRORATION' | 'DISCOUNT'; description: string; quantity: number; unitPaise: number; amountPaise: number };
export type QuoteDto = {
  lines: QuoteLine[];
  subtotalPaise: number;
  discountPaise: number;
  taxablePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  roundOffPaise: number;
  totalPaise: number;
  placeOfSupply: string;
  periodStart: string;
  periodEnd: string;
  promo: string | null;
};

export type BillingOverview = {
  planCode: PlanCode;
  planName: string;
  cycle: BillingCycleKey | null;
  status: string;
  quantity: number;
  seatsUsed: number;
  freeSeats: number;
  prices: Record<BillingCycleKey, number>;
  savingsPct: number;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  pendingChange: { quantity?: number; cycle?: BillingCycleKey } | null;
  pastDueSince: string | null;
  graceEndsAt: string | null;
  promo: { code: string; description: string } | null;
  gateway: 'MOCK' | 'RAZORPAY';
  billingState: string | null;
};

export type SaasInvoiceDto = {
  id: string;
  number: string | null;
  issueDate: string | null;
  periodStart: string;
  periodEnd: string;
  description: string;
  amountPaise: number;
  gstPaise: number;
  totalPaise: number;
  status: string;
};

export type CheckoutDto = {
  orderId: string;
  gateway: 'MOCK' | 'RAZORPAY';
  amountPaise: number;
  checkoutPath: string;
  keyId?: string;
};

export type CheckoutDetailDto = {
  orderId: string;
  status: string;
  gateway: string;
  amountPaise: number;
  tenantName: string;
  description: string;
  quote: QuoteDto;
};

// ── Branding ────────────────────────────────────────────────────────────────

export const publishBrandingSchema = z.object({
  presetKey: z.string().nullish(),
  primaryHex: z.string().regex(HEX_RE, 'Use a colour like #c62828'),
  secondaryHex: z.string().regex(HEX_RE, 'Use a colour like #1c1c1c'),
  logoFileId: z.string().nullish(),
  productName: z.string().trim().max(40, 'Keep the product name under 40 characters').nullish(),
  domain: z
    .string()
    .trim()
    .toLowerCase()
    .regex(HOST_RE, 'Enter a domain like acme.hrms.app'),
});
export type PublishBrandingInput = z.infer<typeof publishBrandingSchema>;

export type BrandingDto = {
  presetKey: string | null;
  primaryHex: string;
  secondaryHex: string;
  logoFileId: string | null;
  logoUrl: string | null;
  productName: string | null;
  tenantName: string;
  domain: string;
  version: number | null;
  publishedAt: string | null;
  publishedByName: string | null;
  locked: boolean;
  planCode: PlanCode;
  versions: { id: string; version: number; status: string; presetKey: string | null; primaryHex: string; secondaryHex: string; publishedAt: string; publishedByName: string | null }[];
};

// ── Tenants (platform operators only) ──────────────────────────────────────

export const createTenantSchema = z.object({
  company: z.string().trim().min(2, 'Company name is required').max(120),
  domain: z
    .string()
    .trim()
    .toLowerCase()
    .min(2, 'Login domain is required')
    .max(100)
    .regex(/^[a-z0-9-]+(\.[a-z0-9-]+)*$/, 'Use letters, numbers and hyphens'),
  planCode: z.enum(['FREE', 'GROWTH', 'ENTERPRISE']),
  cycle: z.enum(BILLING_CYCLES).nullish(),
  seats: z.coerce.number().int().min(1).max(100000).nullish(),
  adminEmail: z.string().trim().toLowerCase().email('Enter the admin’s email'),
  adminName: z.string().trim().max(80).nullish(),
  stateCode: z.string().regex(/^\d{2}$/).nullish(),
});
export type CreateTenantInput = z.infer<typeof createTenantSchema>;

export const TENANT_TABS = ['all', 'paid', 'free', 'attention'] as const;
export const tenantsQuerySchema = paginationQuery.extend({ tab: z.enum(TENANT_TABS).default('all') });

export type TenantRowDto = {
  id: string;
  company: string;
  domain: string;
  planCode: PlanCode;
  planLabel: string;
  seats: string;
  seatsUsed: number;
  quantity: number;
  renewal: string;
  status: string;
  statusTone: 'accent' | 'outline' | 'neutral' | 'danger';
  tenantStatus: string;
  isOperator: boolean;
  createdAt: string;
};

export type TenantsResponse = {
  kpis: { tenants: number; freeTier: number; seatsBilled: number; seatsDelta: number; mrrPaise: number; mrrDeltaPct: number | null };
  items: TenantRowDto[];
  counts: Record<(typeof TENANT_TABS)[number], number>;
};

export type TenantDetailDto = TenantRowDto & {
  adminContacts: { name: string; email: string; status: string }[];
  activeUsers: number;
  subscription: { status: string; cycle: string | null; currentPeriodEnd: string | null; pastDueSince: string | null; graceEndsAt: string | null } | null;
  invoices: SaasInvoiceDto[];
  tickets: { id: string; code: string; subject: string; status: string; severity: string }[];
  platformAudit: { id: string; action: string; actorName: string; createdAt: string; summary: string }[];
};

// ── Data privacy ────────────────────────────────────────────────────────────

export type PrivacyOverview = {
  rows: { data: string; tenantAdmin: string; platformAdmin: string; platformTone: 'accent' | 'neutral'; encryption: string }[];
  controls: { title: string; detail: string }[];
  blockedModels: string[];
  key: { algorithm: string; provider: string; version: string };
  platformAccess: { id: string; action: string; actorName: string; createdAt: string; summary: string }[];
};

// ── Lexisora support ────────────────────────────────────────────────────────

export const SUPPORT_SEVERITIES = ['HIGH', 'MEDIUM', 'LOW'] as const;
export const SUPPORT_CATEGORIES = ['TECHNICAL', 'BILLING', 'ACCOUNT', 'FEATURE_REQUEST'] as const;
export const SUPPORT_STATUSES = ['OPEN', 'ENGINEER_ASSIGNED', 'IN_PROGRESS', 'WAITING_ON_CUSTOMER', 'RESOLVED', 'CLOSED'] as const;
export type SupportStatusKey = (typeof SUPPORT_STATUSES)[number];
export const SUPPORT_STATUS_LABELS: Record<SupportStatusKey, string> = {
  OPEN: 'Open',
  ENGINEER_ASSIGNED: 'Engineer assigned',
  IN_PROGRESS: 'In progress',
  WAITING_ON_CUSTOMER: 'Waiting on you',
  RESOLVED: 'Resolved',
  CLOSED: 'Closed',
};

export const createSupportTicketSchema = z.object({
  subject: z.string().trim().min(4, 'Add a short subject').max(160),
  severity: z.enum(SUPPORT_SEVERITIES).default('MEDIUM'),
  category: z.enum(SUPPORT_CATEGORIES).default('TECHNICAL'),
  description: z.string().trim().min(5, 'Describe the problem').max(8000),
});
export type CreateSupportTicketInput = z.infer<typeof createSupportTicketSchema>;

export const supportMessageSchema = z.object({
  body: z.string().trim().min(1, 'Write a reply').max(8000),
  internal: z.boolean().optional(),
});
export const supportUpdateSchema = z.object({
  status: z.enum(SUPPORT_STATUSES).optional(),
  assignToMe: z.boolean().optional(),
});
export const supportCsatSchema = z.object({ score: z.coerce.number().int().min(1).max(5) });
export const SUPPORT_TABS = ['open', 'resolved', 'all'] as const;
export const supportQuerySchema = paginationQuery.extend({
  tab: z.enum(SUPPORT_TABS).default('open'),
  scope: z.enum(['tenant', 'all']).default('tenant'),
});

export type SupportTicketRowDto = {
  id: string;
  code: string;
  subject: string;
  severity: string;
  category: string;
  status: SupportStatusKey;
  statusLabel: string;
  opened: string;
  createdAt: string;
  tenantName: string | null;
  assigneeName: string | null;
  slaDueAt: string;
  slaBreached: boolean;
};

export type SupportTicketDetailDto = SupportTicketRowDto & {
  description: string;
  openedByName: string;
  openedByEmail: string;
  planAtOpen: string;
  resolvedAt: string | null;
  csat: number | null;
  canReopen: boolean;
  isPlatformView: boolean;
  messages: { id: string; authorType: string; authorName: string; body: string; internal: boolean; createdAt: string }[];
};
