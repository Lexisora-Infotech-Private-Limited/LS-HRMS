import { formatBizMinutes, type HelpdeskTicketStatus } from '@lexisora/shared';
import { addBusinessMinutes, businessMinutesBetween, DEFAULT_CALENDAR, type BusinessCalendar } from './business-hours';

/**
 * Helpdesk business rules (spec §6.3–6.4): status workflow, SLA clocks with pauses,
 * at-risk / breach evaluation and escalation levels. Pure — unit tested.
 */

export type Priority = 'HIGH' | 'MEDIUM' | 'LOW';
export type SlaPolicyLike = { firstResponseMins: number; resolutionMins: number };
export type SlaState = 'ON_TRACK' | 'AT_RISK' | 'BREACHED' | 'MET';

export const OPEN_STATES: HelpdeskTicketStatus[] = ['OPEN', 'IN_PROGRESS', 'WAITING'];
export const isOpenStatus = (s: string) => (OPEN_STATES as string[]).includes(s);

/** Due dates for a new ticket. The clock starts at the next business opening. */
export function dueDatesFor(createdAt: Date, policy: SlaPolicyLike, cal: BusinessCalendar = DEFAULT_CALENDAR) {
  return {
    firstResponseDueAt: addBusinessMinutes(createdAt, policy.firstResponseMins, cal),
    resolutionDueAt: addBusinessMinutes(createdAt, policy.resolutionMins, cal),
  };
}

export type Actor = 'requester' | 'agent';

/** Allowed manual transitions (agent PATCH status, requester actions). */
export function canTransition(from: HelpdeskTicketStatus, to: HelpdeskTicketStatus, actor: Actor): boolean {
  if (from === to) return false;
  if (actor === 'agent') {
    if (to === 'IN_PROGRESS') return from === 'OPEN' || from === 'WAITING';
    if (to === 'WAITING') return from === 'OPEN' || from === 'IN_PROGRESS';
    if (to === 'OPEN') return from === 'IN_PROGRESS' || from === 'WAITING';
    if (to === 'RESOLVED') return isOpenStatus(from);
    if (to === 'CLOSED') return from === 'RESOLVED';
    return false;
  }
  // requester
  if (to === 'CANCELLED') return from === 'OPEN';
  if (to === 'IN_PROGRESS') return from === 'RESOLVED' || from === 'WAITING'; // reopen / reply while waiting
  if (to === 'CLOSED') return from === 'RESOLVED';
  return false;
}

export const REOPEN_WINDOW_DAYS = 7;

export function canReopen(resolvedAt: Date | null, now: Date, status: string): boolean {
  return status === 'RESOLVED' && !!resolvedAt && now.getTime() - resolvedAt.getTime() <= REOPEN_WINDOW_DAYS * 86_400_000;
}

export type ClockTicket = {
  createdAt: Date;
  status: string;
  firstResponseDueAt: Date;
  resolutionDueAt: Date;
  firstRespondedAt: Date | null;
  resolvedAt?: Date | null;
  pausedMins: number;
  pausedSince: Date | null;
};

/** Business minutes the resolution clock has run (completed pauses and the current pause excluded). */
export function elapsedBusinessMinutes(t: ClockTicket, now: Date, cal: BusinessCalendar = DEFAULT_CALENDAR): number {
  const end = t.status === 'RESOLVED' || t.status === 'CLOSED' ? (t.resolvedAt ?? now) : now;
  const gross = businessMinutesBetween(t.createdAt, end, cal);
  const current = t.pausedSince ? businessMinutesBetween(t.pausedSince, end, cal) : 0;
  return Math.max(0, gross - t.pausedMins - current);
}

export type SlaEvaluation = { state: SlaState; pct: number; elapsedMins: number; firstResponseBreached: boolean; level: 0 | 1 | 2 };

/**
 * pct = elapsed / resolution SLA. ≥ 0.8 → AT_RISK; first-response breach or ≥ 1.0 → BREACHED
 * (escalation level 1); ≥ 1.5 → level 2. While WAITING the clock is paused.
 */
export function evaluateSla(t: ClockTicket, policy: SlaPolicyLike, now: Date, cal: BusinessCalendar = DEFAULT_CALENDAR): SlaEvaluation {
  const elapsedMins = elapsedBusinessMinutes(t, now, cal);
  const pct = policy.resolutionMins > 0 ? elapsedMins / policy.resolutionMins : 0;
  const firstResponseBreached = !t.firstRespondedAt && !t.pausedSince && now.getTime() > t.firstResponseDueAt.getTime();
  const level: 0 | 1 | 2 = pct >= 1.5 ? 2 : pct >= 1 || firstResponseBreached ? 1 : 0;
  const state: SlaState = level > 0 ? 'BREACHED' : pct >= 0.8 ? 'AT_RISK' : 'ON_TRACK';
  return { state, pct, elapsedMins, firstResponseBreached, level };
}

/** Final SLA state when a ticket is resolved. */
export function resolvedSlaState(t: Pick<ClockTicket, 'firstResponseDueAt' | 'resolutionDueAt' | 'firstRespondedAt'>, resolvedAt: Date): SlaState {
  const frOk = (t.firstRespondedAt ?? resolvedAt).getTime() <= t.firstResponseDueAt.getTime();
  return frOk && resolvedAt.getTime() <= t.resolutionDueAt.getTime() ? 'MET' : 'BREACHED';
}

/**
 * Resuming a paused clock (WAITING → IN_PROGRESS, or a reopen): the paused business minutes
 * are added to `pausedMins` and the due dates move forward by the same business minutes.
 */
export function resumeClock(t: ClockTicket, now: Date, cal: BusinessCalendar = DEFAULT_CALENDAR, since: Date | null = t.pausedSince) {
  if (!since) return { pausedMins: t.pausedMins, firstResponseDueAt: t.firstResponseDueAt, resolutionDueAt: t.resolutionDueAt, added: 0 };
  const added = businessMinutesBetween(since, now, cal);
  return {
    added,
    pausedMins: t.pausedMins + added,
    firstResponseDueAt: t.firstRespondedAt ? t.firstResponseDueAt : shiftBusiness(t.firstResponseDueAt, added, cal),
    resolutionDueAt: shiftBusiness(t.resolutionDueAt, added, cal),
  };
}

function shiftBusiness(due: Date, mins: number, cal: BusinessCalendar): Date {
  return mins > 0 ? addBusinessMinutes(due, mins, cal) : due;
}

/** SLA chip for the list: "Due in 2 h 10 m", "Breached 1 d 2 h", "Paused", "Met". */
export function slaLabel(t: ClockTicket & { slaState: string }, policy: SlaPolicyLike, now: Date, cal: BusinessCalendar = DEFAULT_CALENDAR): { state: string; label: string } {
  if (t.status === 'CANCELLED') return { state: t.slaState, label: '—' };
  if (t.status === 'RESOLVED' || t.status === 'CLOSED') return { state: t.slaState, label: t.slaState === 'MET' ? 'Met' : 'Breached' };
  if (t.pausedSince) return { state: t.slaState, label: 'Paused' };
  const ev = evaluateSla(t, policy, now, cal);
  const left = policy.resolutionMins - ev.elapsedMins;
  if (left < 0) return { state: 'BREACHED', label: `Breached ${formatBizMinutes(-left)}` };
  if (ev.firstResponseBreached) return { state: 'BREACHED', label: 'Response overdue' };
  return { state: ev.state, label: `Due in ${formatBizMinutes(left)}` };
}

/**
 * Escalation targets: level 1 → the support group lead plus the reporting manager of the
 * assignee (or of the requester while unassigned); level 2 adds HR/admin desk holders (and
 * admins for IT categories). The requester never escalates to themself.
 */
export function escalationTargets(input: {
  level: number;
  groupLeadId: string | null;
  assigneeManagerId: string | null;
  requesterManagerId: string | null;
  requesterId: string;
  hasAssignee: boolean;
  deskHolderIds: string[];
  adminIds: string[];
  isItCategory: boolean;
}): string[] {
  if (input.level <= 0) return [];
  const out = new Set<string>();
  if (input.groupLeadId) out.add(input.groupLeadId);
  const rm = input.hasAssignee ? input.assigneeManagerId : input.requesterManagerId;
  if (rm) out.add(rm);
  if (input.level >= 2) {
    for (const id of input.deskHolderIds) out.add(id);
    if (input.isItCategory) for (const id of input.adminIds) out.add(id);
  }
  out.delete(input.requesterId);
  return [...out];
}

/** Round-robin pick: member with the fewest open tickets (ties → first in list). */
export function pickAssignee(members: string[], openCounts: Map<string, number>): string | null {
  let best: string | null = null;
  let bestCount = Infinity;
  for (const m of members) {
    const c = openCounts.get(m) ?? 0;
    if (c < bestCount) {
      best = m;
      bestCount = c;
    }
  }
  return best;
}

export const AUTO_CLOSE_DAYS_DEFAULT = 7;
