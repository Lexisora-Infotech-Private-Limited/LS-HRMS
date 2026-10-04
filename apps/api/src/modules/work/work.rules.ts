/**
 * Pure business rules for the work domain (unit-tested in work.rules.spec.ts):
 * progress, project health, task transitions + git side effects, board access, intern aggregates.
 */

export type TaskStatus = 'OPEN' | 'ALLOTTED' | 'WIP' | 'DEV_COMPLETED' | 'QA' | 'DONE' | 'CANCELLED';
export type ProjectStatus = 'PLANNING' | 'ACTIVE' | 'ON_HOLD' | 'COMPLETED' | 'ARCHIVED' | 'CANCELLED';
export type ProjectHealth = 'NA' | 'ON_TRACK' | 'AT_RISK' | 'OFF_TRACK';

export const COLUMN_ORDER: TaskStatus[] = ['OPEN', 'ALLOTTED', 'WIP', 'DEV_COMPLETED', 'QA', 'DONE'];
export const STATUS_LABEL: Record<TaskStatus, string> = {
  OPEN: 'Open',
  ALLOTTED: 'Alloted',
  WIP: 'WIP',
  DEV_COMPLETED: 'Dev Completed',
  QA: 'QA',
  DONE: 'Done',
  CANCELLED: 'Cancelled',
};

/** Weight of each status towards project progress (TenantWorkSettings defaults). */
export const PROGRESS_WEIGHTS: Record<TaskStatus, number> = {
  OPEN: 0,
  ALLOTTED: 0,
  WIP: 0.25,
  DEV_COMPLETED: 0.7,
  QA: 0.9,
  DONE: 1,
  CANCELLED: 0,
};

export const DAY_MS = 86_400_000;

// ── Progress ───────────────────────────────────────────────────────────────

/**
 * Progress % = Σ(taskEstimate × weight[status]) / Σ taskEstimate over non-cancelled, non-standing tasks.
 * If the project budget is larger than the tasks broken down so far, the un-broken-down budget counts
 * as not started (denominator = max(Σ estimates, budget)). With no estimates at all, a count-based
 * fraction with the same weights is used. Rounded half-up to an integer.
 */
export function computeProgress(
  tasks: { status: TaskStatus; estimatedMinutes: number | null; isStanding?: boolean }[],
  budgetMinutes = 0,
): number {
  const live = tasks.filter((t) => t.status !== 'CANCELLED' && !t.isStanding);
  if (!live.length) return 0;
  const sumEst = live.reduce((s, t) => s + (t.estimatedMinutes ?? 0), 0);
  if (sumEst <= 0) {
    const w = live.reduce((s, t) => s + PROGRESS_WEIGHTS[t.status], 0);
    return Math.round((w / live.length) * 100);
  }
  const earned = live.reduce((s, t) => s + (t.estimatedMinutes ?? 0) * PROGRESS_WEIGHTS[t.status], 0);
  const denom = Math.max(sumEst, budgetMinutes || 0);
  return Math.min(100, Math.round((earned / denom) * 100 + 1e-9));
}

// ── Health ─────────────────────────────────────────────────────────────────

export type HealthOptions = {
  /** AT_RISK when burn − progress exceeds this (0.15 = logged 15 points ahead of progress). */
  burnGap: number;
  /** AT_RISK when the deadline is within this many days and progress is below `nearProgressPct`. */
  nearDays: number;
  nearProgressPct: number;
  /** AT_RISK when time elapsed − progress exceeds this and the deadline is ≤ 30 days away. */
  elapsedGap: number;
};
export const DEFAULT_HEALTH: HealthOptions = { burnGap: 0.15, nearDays: 14, nearProgressPct: 80, elapsedGap: 0.15 };

export function computeHealth(
  p: { status: ProjectStatus; estimatedMinutes: number; loggedMinutes: number; progressPct: number; startDate: Date | null; deadline: Date | null },
  today: Date,
  opts: HealthOptions = DEFAULT_HEALTH,
): { health: ProjectHealth; reason: string | null } {
  if (p.status !== 'ACTIVE') return { health: 'NA', reason: null };
  const progress = p.progressPct / 100;
  const burn = p.estimatedMinutes > 0 ? p.loggedMinutes / p.estimatedMinutes : null;
  const daysLeft = p.deadline ? Math.round((p.deadline.getTime() - today.getTime()) / DAY_MS) : null;
  const pct = (x: number) => `${Math.round(x * 100)}%`;

  if (daysLeft !== null && daysLeft < 0 && p.progressPct < 100) {
    return { health: 'OFF_TRACK', reason: `Deadline passed ${-daysLeft} day${daysLeft === -1 ? '' : 's'} ago at ${p.progressPct}% progress` };
  }
  if (burn !== null && burn > 1 && progress < 0.9) {
    return { health: 'OFF_TRACK', reason: `Logged ${pct(burn)} of estimate vs ${p.progressPct}% progress` };
  }
  if (burn !== null && burn - progress > opts.burnGap + 1e-9) {
    return { health: 'AT_RISK', reason: `Logged ${pct(burn)} of estimate vs ${p.progressPct}% progress` };
  }
  if (daysLeft !== null && daysLeft <= opts.nearDays && p.progressPct < opts.nearProgressPct) {
    return { health: 'AT_RISK', reason: `Deadline in ${daysLeft} day${daysLeft === 1 ? '' : 's'} with ${p.progressPct}% progress` };
  }
  if (p.startDate && p.deadline && daysLeft !== null && daysLeft <= 30) {
    const span = p.deadline.getTime() - p.startDate.getTime();
    if (span > 0) {
      const elapsed = Math.min(1, Math.max(0, (today.getTime() - p.startDate.getTime()) / span));
      if (elapsed - progress > opts.elapsedGap + 1e-9) {
        return { health: 'AT_RISK', reason: `${pct(elapsed)} of the schedule elapsed vs ${p.progressPct}% progress` };
      }
    }
  }
  return { health: 'ON_TRACK', reason: null };
}

/** Wireframe "Status" column: health when active, else the lifecycle status. */
export function projectStatusLabel(status: ProjectStatus, health: ProjectHealth): string {
  if (status === 'ACTIVE') {
    if (health === 'AT_RISK') return 'At risk';
    if (health === 'OFF_TRACK') return 'Off track';
    return 'On track';
  }
  return { PLANNING: 'Planning', ON_HOLD: 'On hold', COMPLETED: 'Completed', ARCHIVED: 'Archived', CANCELLED: 'Cancelled', ACTIVE: 'Active' }[status];
}

// ── Git naming ─────────────────────────────────────────────────────────────

/** "feature/{key}" + "AT-101" → "feature/at-101" (lowercased, slug-safe, ≤ 100 chars). */
export function branchName(key: string, pattern = 'feature/{key}'): string {
  const raw = pattern.replace(/\{key\}/g, key.toLowerCase()).replace(/\{KEY\}/g, key.toLowerCase());
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9._/-]+/g, '-')
    .replace(/\/{2,}/g, '/')
    .replace(/^[-/]+|[-/]+$/g, '')
    .slice(0, 100);
}

export function mrTitle(key: string, title: string, pattern = '{KEY}: {title}'): string {
  return pattern.replace(/\{KEY\}/g, key).replace(/\{key\}/g, key.toLowerCase()).replace(/\{title\}/g, title).slice(0, 255);
}

/** Task keys mentioned in a commit message or branch name ("AT-101 fix pdf", "feature/at-101"). */
export function taskKeysIn(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/\b([A-Za-z]{2,6})-(\d{1,6})\b/g)) out.add(`${m[1]!.toUpperCase()}-${m[2]}`);
  return [...out];
}

// ── Transitions ────────────────────────────────────────────────────────────

export type TransitionPlan = {
  /** Git side effect to run after the status change commits. */
  git: 'branch' | 'mr' | 'none';
  /** Field changes besides status. */
  set: {
    startedAt?: Date;
    devCompletedAt?: Date;
    qaAt?: Date;
    doneAt?: Date | null;
    assigneeEmployeeId?: string | null;
  };
  backward: boolean;
};

/**
 * What happens when a card moves `from` → `to`:
 *  - to WIP: create the feature branch from the target branch (GitLab adapter)
 *  - to DEV_COMPLETED: ensure the branch and open (or reuse) a merge request
 *  - to OPEN: the card is unassigned; leaving OPEN without an assignee assigns the mover
 *  - status timestamps are stamped; leaving DONE clears doneAt
 */
export function planTransition(input: {
  from: TaskStatus;
  to: TaskStatus;
  hasRepo: boolean;
  assigneeEmployeeId: string | null;
  moverEmployeeId: string | null;
  startedAt: Date | null;
  now: Date;
}): TransitionPlan {
  const { from, to, now } = input;
  const set: TransitionPlan['set'] = {};
  if (to === 'WIP' && !input.startedAt) set.startedAt = now;
  if (to === 'DEV_COMPLETED') set.devCompletedAt = now;
  if (to === 'QA') set.qaAt = now;
  if (to === 'DONE') set.doneAt = now;
  if (from === 'DONE' && to !== 'DONE') set.doneAt = null;
  if (to === 'OPEN') set.assigneeEmployeeId = null;
  else if (!input.assigneeEmployeeId && input.moverEmployeeId) set.assigneeEmployeeId = input.moverEmployeeId;

  let git: TransitionPlan['git'] = 'none';
  if (input.hasRepo && from !== to) {
    if (to === 'WIP' && from !== 'DEV_COMPLETED' && from !== 'QA' && from !== 'DONE') git = 'branch';
    else if (to === 'DEV_COMPLETED') git = 'mr';
  }
  const backward = COLUMN_ORDER.indexOf(to) < COLUMN_ORDER.indexOf(from);
  return { git, set, backward };
}

/** Toast copy for a move (wireframe: "AT-102 → Dev Completed · pushed to GitLab (feature/at-102)", "AT-106 closed"). */
export function moveMessage(key: string, to: TaskStatus, git: { action: 'branch' | 'mr' | 'none'; status: string; branch?: string | null; targetBranch?: string }): string {
  if (to === 'DONE') return `${key} closed`;
  if (git.action === 'mr') {
    if (git.status === 'SYNCED') return `${key} → Dev Completed · pushed to GitLab (${git.branch})`;
    if (git.status === 'FAILED') return `${key} → Dev Completed · GitLab sync failed, retry from the card`;
  }
  if (git.action === 'branch' && git.status === 'SYNCED') return `${key} → WIP · branch ${git.branch} created from ${git.targetBranch ?? 'develop'}`;
  return `${key} → ${STATUS_LABEL[to]}`;
}

// ── Board access ───────────────────────────────────────────────────────────

export type BoardAccessInput = {
  /** Holds tasks.viewAllBoards (manager, admin). */
  viewAll: boolean;
  /** Department.leadEmployeeId === me for the board's department. */
  isDeptLead: boolean;
  /** Allocated by the department lead (BoardMember row). */
  isAllocated: boolean;
  /** Project lead (manages tasks on boards they can see; no implicit access to other departments). */
  isProjectLead: boolean;
};

export function boardAccess(a: BoardAccessInput): { canView: boolean; canManage: boolean; canAllocate: boolean } {
  const canView = a.viewAll || a.isDeptLead || a.isAllocated;
  return {
    canView,
    canManage: a.viewAll || a.isDeptLead || (a.isProjectLead && canView),
    canAllocate: a.viewAll || a.isDeptLead,
  };
}

/** Members may move their own cards or pick up unassigned ones; board managers move anything. */
export function canMoveTask(input: { canManage: boolean; canView: boolean; assigneeEmployeeId: string | null; me: string | null }): boolean {
  if (!input.canView) return false;
  if (input.canManage) return true;
  if (!input.me) return false;
  return input.assigneeEmployeeId === null || input.assigneeEmployeeId === input.me;
}

// ── Formatting helpers ─────────────────────────────────────────────────────

/** "Priya Sharma" → "Priya S." */
export function shortName(full: string | null | undefined): string {
  if (!full) return '—';
  const [first, ...rest] = full.trim().split(/\s+/);
  const last = rest.pop();
  return last ? `${first} ${last[0]!.toUpperCase()}.` : first!;
}

/** Suggest a project key from its name: "Atlas CRM" → "AT", "Orbit HR portal" → "OR". */
export function suggestKey(name: string, taken: Set<string> = new Set()): string {
  const letters = name.toUpperCase().replace(/[^A-Z ]/g, '');
  const words = letters.split(/\s+/).filter(Boolean);
  const candidates: string[] = [];
  const first = words[0] ?? 'PR';
  candidates.push(first.slice(0, 2));
  if (words.length > 1) candidates.push(words.map((w) => w[0]).join('').slice(0, 4));
  candidates.push(first.slice(0, 3), first.slice(0, 4));
  for (const c of candidates) if (c.length >= 2 && !taken.has(c)) return c;
  for (let i = 0; i < 26; i++) {
    const c = first.slice(0, 2) + String.fromCharCode(65 + i);
    if (!taken.has(c)) return c;
  }
  return 'PRJ';
}

// ── Archive ────────────────────────────────────────────────────────────────

export type ArchiveAccessKey = 'LEADS_ONLY' | 'ALL_DEVELOPERS';

/**
 * Archive access levels a viewer may open (null = all). `archive.view` (leads, managers, admin)
 * opens everything; any other employee with `projects.view` only "All developers" items.
 */
export function archiveAccessLevels(p: { canViewArchive: boolean; canViewProjects: boolean }): ArchiveAccessKey[] | null {
  if (p.canViewArchive) return null;
  return p.canViewProjects ? ['ALL_DEVELOPERS'] : [];
}

export function canOpenArchiveItem(access: string, p: { canViewArchive: boolean; canViewProjects: boolean }): boolean {
  const levels = archiveAccessLevels(p);
  return levels === null || levels.includes(access as ArchiveAccessKey);
}

// ── Interns ────────────────────────────────────────────────────────────────

/** Relationship scope on an intern's sheet: self, mentor (= reporting manager) or interns.viewAll. */
export function internAccess(a: { viewerEmployeeId: string | null; internId: string; internManagerId: string | null; viewAll: boolean }) {
  const isSelf = !!a.viewerEmployeeId && a.internId === a.viewerEmployeeId;
  const isMentor = !!a.viewerEmployeeId && a.internManagerId === a.viewerEmployeeId;
  return { isSelf, isMentor, canView: isSelf || isMentor || a.viewAll, canScore: isMentor || a.viewAll, canEditOwn: isSelf };
}

/** Fields an intern may change on their own task (status, hours, note); everything else is the mentor's. */
export const INTERN_SELF_FIELDS = ['status', 'hours', 'internNote'] as const;
export function internForbiddenFields(keys: string[]): string[] {
  return keys.filter((k) => !(INTERN_SELF_FIELDS as readonly string[]).includes(k));
}

export type InternStatus = 'ASSIGNED' | 'IN_PROGRESS' | 'DONE' | 'NOT_DONE';

/** Sheet status for an intern's day: Done / In progress / Not started / Not done / Not assigned. */
export function internDayStatus(statuses: InternStatus[], opts: { isPastDay: boolean; afterCutoff: boolean }): { key: string; label: string } {
  if (!statuses.length) return { key: 'NOT_ASSIGNED', label: 'Not assigned' };
  if (statuses.every((s) => s === 'DONE')) return { key: 'DONE', label: 'Done' };
  if (statuses.some((s) => s === 'NOT_DONE')) return { key: 'NOT_DONE', label: 'Not done' };
  if ((opts.isPastDay || opts.afterCutoff) && statuses.some((s) => s !== 'DONE')) return { key: 'NOT_DONE', label: 'Not done' };
  if (statuses.some((s) => s === 'IN_PROGRESS' || s === 'DONE')) return { key: 'IN_PROGRESS', label: 'In progress' };
  return { key: 'ASSIGNED', label: 'Not started' };
}

/** Mean of scores rounded to 1 decimal, or null. */
export function meanScore(scores: (number | null | undefined)[]): number | null {
  const s = scores.filter((x): x is number => typeof x === 'number');
  if (!s.length) return null;
  return Math.round((s.reduce((a, b) => a + b, 0) / s.length) * 10) / 10;
}

/** Monday (YYYY-MM-DD) of the ISO week containing a YYYY-MM-DD date. */
export function weekStartOf(dateKey: string): string {
  const d = new Date(`${dateKey}T00:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7; // Mon=0
  return new Date(d.getTime() - dow * DAY_MS).toISOString().slice(0, 10);
}

export function addDays(dateKey: string, n: number): string {
  return new Date(new Date(`${dateKey}T00:00:00Z`).getTime() + n * DAY_MS).toISOString().slice(0, 10);
}

/** Next working day (skips Sunday) — for intern carry-over. */
export function nextWorkingDay(dateKey: string): string {
  let d = addDays(dateKey, 1);
  if (new Date(`${d}T00:00:00Z`).getUTCDay() === 0) d = addDays(d, 1);
  return d;
}
