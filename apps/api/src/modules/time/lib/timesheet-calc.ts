/** Pure timesheet rules (spec-time J3/J5). */

/** The parts of a cell that count: tracked + approved idle + accepted outside hours + counted adjustment. */
export type CellParts = { trackedMinutes: number; idleAsWorkMinutes: number; outsideHoursMinutes: number; adjustmentMinutes: number };
/** A cell with the manual increase that is still waiting for the Project Lead. */
export type CellState = CellParts & { pendingAdjustmentMinutes: number };

/** A day can't hold more than 24 hours across all rows. */
export const MAX_DAY_MINUTES = 1440;

export function cellFinal(c: CellParts): number {
  return Math.max(0, c.trackedMinutes + c.idleAsWorkMinutes + c.outsideHoursMinutes + c.adjustmentMinutes);
}

/** What the employee claims for the cell: the counted value plus an increase waiting for review. */
export function cellClaimed(c: CellState): number {
  return cellFinal(c) + c.pendingAdjustmentMinutes;
}

/** Highest value of the cell that already counts: tracked time, or an edit above it that needed no review / was accepted. */
export function countedCeiling(c: CellParts): number {
  const base = c.trackedMinutes + c.idleAsWorkMinutes + c.outsideHoursMinutes;
  return Math.max(base, base + c.adjustmentMinutes);
}

export type EditPlan = {
  /** Counted offset from the tracked base. */
  adjustmentMinutes: number;
  /** The part above the counted ceiling, kept apart until the Project Lead accepts it. */
  pendingAdjustmentMinutes: number;
  fromMinutes: number;
  /** Change of the claimed value, or (for a review) the minutes under review. */
  deltaMinutes: number;
  kind: 'MANUAL_INCREASE' | 'MANUAL_DECREASE';
  reviewStatus: 'PENDING_PL' | 'NOT_REQUIRED';
};

/**
 * A cell edit sets what the employee claims for the cell. Up to the counted ceiling (tracked time,
 * or an edit that is already counted) it counts straight away; anything above it waits for the
 * Project Lead and is kept out of the totals until accepted. A new edit replaces an earlier one
 * that is still waiting.
 */
export function planCellEdit(c: CellState, newMinutes: number): EditPlan | null {
  const base = c.trackedMinutes + c.idleAsWorkMinutes + c.outsideHoursMinutes;
  const current = cellClaimed(c);
  if (newMinutes === current) return null;
  const ceiling = countedCeiling(c);
  if (newMinutes <= ceiling) {
    return {
      adjustmentMinutes: newMinutes - base,
      pendingAdjustmentMinutes: 0,
      fromMinutes: current,
      deltaMinutes: newMinutes - current,
      kind: newMinutes > current ? 'MANUAL_INCREASE' : 'MANUAL_DECREASE',
      reviewStatus: 'NOT_REQUIRED',
    };
  }
  return {
    adjustmentMinutes: ceiling - base,
    pendingAdjustmentMinutes: newMinutes - ceiling,
    fromMinutes: ceiling,
    deltaMinutes: newMinutes - ceiling,
    kind: 'MANUAL_INCREASE',
    reviewStatus: 'PENDING_PL',
  };
}

/**
 * Tracked time that arrives after a claim (e.g. the tracker syncs late) covers part of it: the
 * employee claimed `claimedTotal` for the cell, so only what is still above the counted ceiling
 * waits for review. Never double-counts the same work.
 */
export function reanchorPending(c: CellParts, claimedTotal: number): number {
  return Math.max(0, claimedTotal - countedCeiling(c));
}

/** Reviewer decision on (part of) a pending increase: accepted minutes start counting, rejected ones drop. */
export function decidePending(c: Pick<CellState, 'adjustmentMinutes' | 'pendingAdjustmentMinutes'>, minutes: number, accept: boolean) {
  const m = Math.max(0, Math.min(minutes, c.pendingAdjustmentMinutes));
  return { adjustmentMinutes: c.adjustmentMinutes + (accept ? m : 0), pendingAdjustmentMinutes: c.pendingAdjustmentMinutes - m };
}

/**
 * Reason rule: tracker-derived edits always need a reason (≥ 10 chars). Manual users (no tracker
 * data that day) need one only when the day's total would exceed the attendance worked minutes.
 */
export function reasonRequired(p: { hasTrackerData: boolean; dayTotalAfter: number; attendanceWorked: number }): boolean {
  if (p.hasTrackerData) return true;
  return p.dayTotalAfter > p.attendanceWorked;
}

/** Board statuses a task can be worked on in (stored value is WIP; label "In progress"). */
export const ACTIVE_TASK_STATUSES = ['ALLOTTED', 'WIP', 'IN_PROGRESS'] as const;
export function isActiveTask(status: string | null | undefined): boolean {
  return !!status && (ACTIVE_TASK_STATUSES as readonly string[]).includes(status);
}

/** A row with no time at all this week, for a task that is no longer being worked on: hidden by default. */
export function isQuietLine(l: { claimed: number; pendingIdle: number; taskId: string | null; taskStatus: string | null | undefined }): boolean {
  if (l.claimed > 0 || l.pendingIdle > 0) return false;
  return !!l.taskId && !isActiveTask(l.taskStatus);
}

/** Hours expected on a day: none on a weekly off / holiday, less the leave taken. */
export function expectedMinutes(p: { offDay: boolean; leaveFraction: number; requiredMinutes: number }): number {
  if (p.offDay) return 0;
  return Math.round(p.requiredMinutes * Math.max(0, 1 - Math.min(1, p.leaveFraction)));
}

/** "Leave · CL", "½ leave · CL (1st half)". */
export function leaveLabel(p: { typeCode: string | null; fraction: number; session: string | null }): string {
  const code = p.typeCode ? ` · ${p.typeCode}` : '';
  if (p.fraction >= 1) return `Leave${code}`;
  const half = p.session === 'FIRST_HALF' ? ' (1st half)' : p.session === 'SECOND_HALF' ? ' (2nd half)' : '';
  return `½ leave${code}${half}`;
}

export type ChainTone = 'accent' | 'outline' | 'neutral';
/** Approval chain chips: Employee → Project Lead → Reporting Manager → Payroll (J3 mapping). */
export function chainTones(status: string): [ChainTone, ChainTone, ChainTone, ChainTone] {
  switch (status) {
    case 'SUBMITTED':
      return ['accent', 'outline', 'neutral', 'neutral'];
    case 'PENDING_RM':
      return ['accent', 'accent', 'outline', 'neutral'];
    case 'APPROVED':
      return ['accent', 'accent', 'accent', 'outline'];
    case 'LOCKED':
      return ['accent', 'accent', 'accent', 'accent'];
    default: // DRAFT, RETURNED
      return ['outline', 'neutral', 'neutral', 'neutral'];
  }
}

export function submitLabel(status: string): string {
  if (status === 'RETURNED') return 'Resubmit';
  if (status === 'SUBMITTED' || status === 'PENDING_RM') return 'Submitted';
  if (status === 'APPROVED' || status === 'LOCKED') return 'Approved';
  return 'Submit for approval';
}

export function isEditableStatus(status: string): boolean {
  return status === 'DRAFT' || status === 'RETURNED';
}

/** Outside-hours entry length rule (J5): 15 min – 12 h, same day. */
export function outsideHoursMinutes(from: number, to: number): { minutes: number; error?: string } {
  const minutes = to - from;
  if (minutes < 15) return { minutes, error: 'Outside-hours entries must be at least 15 minutes' };
  if (minutes > 720) return { minutes, error: 'Outside-hours entries can be at most 12 hours' };
  return { minutes };
}

/** "4:30" / "–" grid format. */
export function hmm(minutes: number): string {
  if (!minutes) return '–';
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`;
}
