/**
 * Pure rules for ID card compliance and attendance period locks (spec-time G5, D9).
 * Kept free of Prisma so they are unit-tested directly.
 */

/** Rounded percentage, or null when nothing was counted. */
export function pctOf(yes: number, total: number): number | null {
  if (!total) return null;
  return Math.round((yes / total) * 100);
}

export type IdFigures = { inOffice: number; checked: number; wearing: number; wearingPct: number; missing: number; unchecked: number };

/**
 * Day KPIs. inOffice = distinct employees in office by punch, plus anyone checked at the desk
 * (a host who has not punched yet still counts as present in the building).
 * Wearing % is over the checked population; unchecked = in office by punch but not checked yet.
 */
export function idDayFigures(inOfficeIds: string[], checks: { employeeId: string; wearing: boolean }[]): IdFigures {
  const office = new Set(inOfficeIds);
  const checked = new Set(checks.map((c) => c.employeeId));
  const wearing = checks.filter((c) => c.wearing).length;
  return {
    inOffice: new Set([...office, ...checked]).size,
    checked: checks.length,
    wearing,
    wearingPct: pctOf(wearing, checks.length) ?? 0,
    missing: checks.length - wearing,
    unchecked: [...office].filter((id) => !checked.has(id)).length,
  };
}

/** Month compliance delta in percentage points ("+2% vs Aug"). */
export function complianceDelta(month: number | null, prev: number | null): number | null {
  return month != null && prev != null ? month - prev : null;
}

/**
 * Validation for locking a month: no future months, `upTo` inside the month and not after today.
 * Returns the user-facing error or null.
 */
export function lockRangeError(month: string, upTo: string | undefined, today: string): string | null {
  if (!/^\d{4}-\d{2}$/.test(month)) return 'Choose a month';
  if (month > today.slice(0, 7)) return "You can't lock a future month";
  if (upTo) {
    if (upTo.slice(0, 7) !== month) return 'Lock date must fall in the chosen month';
    if (upTo > today) return "You can't lock days that haven't happened yet";
  }
  return null;
}

/** Last day to lock by default: month end, or today when locking the running month. */
export function defaultLockUpTo(month: string, monthEnd: string, today: string): string {
  return month === today.slice(0, 7) && today < monthEnd ? today : monthEnd;
}

/**
 * What a badge scan (USB scanner / camera QR) yields → the card's verify token (or an emp code).
 * Accepts the printed verify URL (`…/id-cards/verify/<token>`), vCard/scan URLs or a bare token.
 */
export function parseBadgeToken(scanned: string): string {
  const t = scanned.trim();
  const verify = /\/verify\/([\w-]+)/.exec(t);
  if (verify) return verify[1]!;
  const url = /\/(?:vcard|id-cards?|idcards?)\/(?:scan\/)?([\w-]+)/.exec(t);
  return url?.[1] ?? t;
}
