/** Pure timesheet rules (spec-time J3/J5). */

export type CellParts = { trackedMinutes: number; idleAsWorkMinutes: number; outsideHoursMinutes: number; adjustmentMinutes: number };

export function cellFinal(c: CellParts): number {
  return Math.max(0, c.trackedMinutes + c.idleAsWorkMinutes + c.outsideHoursMinutes + c.adjustmentMinutes);
}

export type EditPlan = { adjustmentMinutes: number; deltaMinutes: number; kind: 'MANUAL_INCREASE' | 'MANUAL_DECREASE'; reviewStatus: 'PENDING_PL' | 'NOT_REQUIRED' };

/**
 * A cell edit sets the cell's final value; the difference from the tracked base is stored as
 * the adjustment. Increases above the tracked base need PL review.
 */
export function planCellEdit(c: CellParts, newMinutes: number): EditPlan | null {
  const base = c.trackedMinutes + c.idleAsWorkMinutes + c.outsideHoursMinutes;
  const current = cellFinal(c);
  const delta = newMinutes - current;
  if (delta === 0) return null;
  const adjustmentMinutes = newMinutes - base;
  const kind = delta > 0 ? 'MANUAL_INCREASE' : 'MANUAL_DECREASE';
  return { adjustmentMinutes, deltaMinutes: delta, kind, reviewStatus: kind === 'MANUAL_INCREASE' && newMinutes > base ? 'PENDING_PL' : 'NOT_REQUIRED' };
}

/**
 * Reason rule: tracker-derived edits always need a reason (≥ 10 chars). Manual users (no tracker
 * data that day) need one only when the day's total would exceed the attendance worked minutes.
 */
export function reasonRequired(p: { hasTrackerData: boolean; dayTotalAfter: number; attendanceWorked: number }): boolean {
  if (p.hasTrackerData) return true;
  return p.dayTotalAfter > p.attendanceWorked;
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
