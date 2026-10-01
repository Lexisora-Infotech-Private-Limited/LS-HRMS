import { describe, expect, it } from 'vitest';
import { DEFAULT_SLA } from '@lexisora/shared';
import { addBusinessMinutes, businessMinutesBetween, calendarWith, DEFAULT_CALENDAR, nextBusinessOpen } from './business-hours';
import { canReopen, canTransition, dueDatesFor, escalationTargets, evaluateSla, pickAssignee, resolvedSlaState, resumeClock, slaLabel, type ClockTicket } from './helpdesk.rules';

/** IST wall clock → instant. */
const ist = (s: string) => new Date(`${s}:00+05:30`);
const fmt = (d: Date) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(d);

describe('business hours (Mon–Fri 09:30–18:30 IST)', () => {
  it('adds minutes within the same day', () => {
    expect(fmt(addBusinessMinutes(ist('2026-09-29T10:00'), 60))).toBe('2026-09-29 11:00');
    expect(fmt(addBusinessMinutes(ist('2026-09-29T10:00'), 480))).toBe('2026-09-29 18:00');
  });

  it('rolls over the end of the day', () => {
    // Tue 10:00 + 24 business hours (Medium): 510 Tue + 540 Wed + 390 Thu → Thu 16:00
    expect(fmt(addBusinessMinutes(ist('2026-09-29T10:00'), 1440))).toBe('2026-10-01 16:00');
    expect(fmt(addBusinessMinutes(ist('2026-09-29T18:00'), 60))).toBe('2026-09-30 10:00');
  });

  it('starts the clock at the next opening when created outside hours', () => {
    expect(fmt(addBusinessMinutes(ist('2026-09-29T20:00'), 60))).toBe('2026-09-30 10:30');
    expect(fmt(addBusinessMinutes(ist('2026-09-29T07:15'), 60))).toBe('2026-09-29 10:30');
    expect(fmt(nextBusinessOpen(ist('2026-09-26T11:00')))).toBe('2026-09-28 09:30'); // Saturday → Monday
  });

  it('skips weekends and holidays', () => {
    // Fri 17:30 + 120 → 60 on Friday, 60 on Monday
    expect(fmt(addBusinessMinutes(ist('2026-09-25T17:30'), 120))).toBe('2026-09-28 10:30');
    // Thu 1 Oct 17:30 + 120 with Gandhi Jayanti (Fri 2 Oct) off → Mon 5 Oct 10:30
    const cal = calendarWith(['2026-10-02']);
    expect(fmt(addBusinessMinutes(ist('2026-10-01T17:30'), 120, cal))).toBe('2026-10-05 10:30');
    // Low (72 business hours = 8 days) from Tue 29 Sep 10:00 with the holiday
    expect(fmt(addBusinessMinutes(ist('2026-09-29T10:00'), DEFAULT_SLA.LOW.resolutionMins, cal))).toBe('2026-10-12 10:00');
  });

  it('counts business minutes between instants', () => {
    expect(businessMinutesBetween(ist('2026-09-29T17:00'), ist('2026-09-30T10:30'))).toBe(150);
    expect(businessMinutesBetween(ist('2026-09-25T18:00'), ist('2026-09-28T10:00'))).toBe(60);
    expect(businessMinutesBetween(ist('2026-09-29T10:00'), ist('2026-09-29T09:00'))).toBe(0);
    expect(businessMinutesBetween(ist('2026-09-26T10:00'), ist('2026-09-27T18:00'))).toBe(0); // weekend
    expect(businessMinutesBetween(ist('2026-10-01T09:30'), ist('2026-10-05T09:30'), calendarWith(['2026-10-02']))).toBe(540);
  });

  it('is the inverse of addBusinessMinutes', () => {
    const start = ist('2026-09-29T11:17');
    for (const m of [1, 59, 300, 541, 1440, 4320]) expect(businessMinutesBetween(start, addBusinessMinutes(start, m))).toBe(m);
  });
});

describe('SLA due dates and evaluation', () => {
  const high = DEFAULT_SLA.HIGH;
  const ticket = (over: Partial<ClockTicket> = {}): ClockTicket => {
    const createdAt = over.createdAt ?? ist('2026-09-29T10:00');
    return { createdAt, status: 'OPEN', ...dueDatesFor(createdAt, high), firstRespondedAt: null, pausedMins: 0, pausedSince: null, ...over };
  };

  it('High raised Tue 10:00 → first response 11:00, resolution 18:00 the same day (spec §6.9.1)', () => {
    const d = dueDatesFor(ist('2026-09-29T10:00'), high);
    expect(fmt(d.firstResponseDueAt)).toBe('2026-09-29 11:00');
    expect(fmt(d.resolutionDueAt)).toBe('2026-09-29 18:00');
  });

  it('is on track, at risk at 80 %, breached at 100 % and level 2 at 150 %', () => {
    const t = ticket({ firstRespondedAt: ist('2026-09-29T10:20'), status: 'IN_PROGRESS' });
    expect(evaluateSla(t, high, ist('2026-09-29T12:00')).state).toBe('ON_TRACK');
    const risk = evaluateSla(t, high, ist('2026-09-29T16:30'));
    expect(risk.state).toBe('AT_RISK');
    expect(risk.elapsedMins).toBe(390);
    const l1 = evaluateSla(t, high, ist('2026-09-30T10:00'));
    expect([l1.state, l1.level]).toEqual(['BREACHED', 1]);
    expect(evaluateSla(t, high, ist('2026-10-01T10:00')).level).toBe(2);
  });

  it('escalates when the first response is late even if resolution time remains', () => {
    const ev = evaluateSla(ticket(), high, ist('2026-09-29T11:01'));
    expect(ev.firstResponseBreached).toBe(true);
    expect([ev.state, ev.level]).toEqual(['BREACHED', 1]);
  });

  it('pauses while waiting and moves the due date by the paused business minutes (spec §6.9.2)', () => {
    const t = ticket({ status: 'WAITING', firstRespondedAt: ist('2026-09-29T10:30'), pausedSince: ist('2026-09-29T11:00') });
    // Paused clock does not run
    expect(evaluateSla(t, high, ist('2026-09-29T13:59')).elapsedMins).toBe(60);
    const r = resumeClock(t, ist('2026-09-29T14:00'));
    expect(r.added).toBe(180);
    expect(r.pausedMins).toBe(180);
    expect(fmt(r.resolutionDueAt)).toBe('2026-09-30 12:00');
    const resumed: ClockTicket = { ...t, status: 'IN_PROGRESS', pausedSince: null, ...r };
    expect(evaluateSla(resumed, high, ist('2026-09-29T15:00')).elapsedMins).toBe(120);
  });

  it('final state on resolve is MET within both SLAs, else BREACHED', () => {
    const t = ticket({ firstRespondedAt: ist('2026-09-29T10:40') });
    expect(resolvedSlaState(t, ist('2026-09-29T17:00'))).toBe('MET');
    expect(resolvedSlaState(t, ist('2026-09-30T09:45'))).toBe('BREACHED');
    expect(resolvedSlaState({ ...t, firstRespondedAt: ist('2026-09-29T11:30') }, ist('2026-09-29T12:00'))).toBe('BREACHED');
  });

  it('labels the SLA chip', () => {
    const t = { ...ticket({ firstRespondedAt: ist('2026-09-29T10:10'), status: 'IN_PROGRESS' }), slaState: 'ON_TRACK' };
    expect(slaLabel(t, high, ist('2026-09-29T15:50')).label).toBe('Due in 2 h 10 m');
    expect(slaLabel(t, high, ist('2026-09-30T10:30')).label).toBe('Breached 1 h 30 m');
    expect(slaLabel({ ...t, pausedSince: ist('2026-09-29T12:00') }, high, ist('2026-09-29T15:00')).label).toBe('Paused');
    expect(slaLabel({ ...t, status: 'RESOLVED', slaState: 'MET' }, high, ist('2026-09-29T15:00')).label).toBe('Met');
  });

  it('uses the tenant calendar for holidays', () => {
    const cal = calendarWith(['2026-10-02'], DEFAULT_CALENDAR);
    const d = dueDatesFor(ist('2026-10-01T16:00'), DEFAULT_SLA.MEDIUM, cal);
    expect(fmt(d.resolutionDueAt)).toBe('2026-10-07 13:00');
  });
});

describe('workflow', () => {
  it('lets agents move tickets through the states', () => {
    expect(canTransition('OPEN', 'IN_PROGRESS', 'agent')).toBe(true);
    expect(canTransition('IN_PROGRESS', 'WAITING', 'agent')).toBe(true);
    expect(canTransition('WAITING', 'RESOLVED', 'agent')).toBe(true);
    expect(canTransition('RESOLVED', 'CLOSED', 'agent')).toBe(true);
    expect(canTransition('CLOSED', 'IN_PROGRESS', 'agent')).toBe(false);
    expect(canTransition('CANCELLED', 'OPEN', 'agent')).toBe(false);
  });

  it('lets requesters cancel only open tickets and reopen within 7 days', () => {
    expect(canTransition('OPEN', 'CANCELLED', 'requester')).toBe(true);
    expect(canTransition('IN_PROGRESS', 'CANCELLED', 'requester')).toBe(false);
    expect(canTransition('RESOLVED', 'IN_PROGRESS', 'requester')).toBe(true);
    expect(canTransition('OPEN', 'RESOLVED', 'requester')).toBe(false);
    expect(canReopen(ist('2026-09-26T12:10'), ist('2026-09-29T10:00'), 'RESOLVED')).toBe(true);
    expect(canReopen(ist('2026-09-20T12:10'), ist('2026-09-29T10:00'), 'RESOLVED')).toBe(false);
    expect(canReopen(ist('2026-09-28T12:10'), ist('2026-09-29T10:00'), 'CLOSED')).toBe(false);
  });

  it('escalates to the group lead and the RM, then adds the desk', () => {
    const base = { groupLeadId: 'lead', assigneeManagerId: 'rmA', requesterManagerId: 'rmR', requesterId: 'priya', deskHolderIds: ['kavya', 'rohit'], adminIds: ['rohit'], isItCategory: true };
    expect(escalationTargets({ ...base, level: 0, hasAssignee: false })).toEqual([]);
    expect(escalationTargets({ ...base, level: 1, hasAssignee: false }).sort()).toEqual(['lead', 'rmR']);
    expect(escalationTargets({ ...base, level: 1, hasAssignee: true }).sort()).toEqual(['lead', 'rmA']);
    expect(escalationTargets({ ...base, level: 2, hasAssignee: true }).sort()).toEqual(['kavya', 'lead', 'rmA', 'rohit']);
    // The requester never escalates to themself
    expect(escalationTargets({ ...base, level: 1, hasAssignee: false, groupLeadId: 'priya' })).toEqual(['rmR']);
  });

  it('round-robin picks the least loaded member', () => {
    expect(pickAssignee(['a', 'b', 'c'], new Map([['a', 3], ['b', 1], ['c', 1]]))).toBe('b');
    expect(pickAssignee([], new Map())).toBeNull();
  });
});

/** The seeded wireframe tickets (prisma/seed/workplace.ts) as of "today" = Tue 29 Sep 2026 09:40 IST. */
describe('demo tickets (wireframe rows)', () => {
  const cal = calendarWith(['2026-10-02']); // Gandhi Jayanti
  const now = ist('2026-09-29T09:40');
  const clock = (createdAt: Date, p: keyof typeof DEFAULT_SLA, over: Partial<ClockTicket> = {}): ClockTicket => ({
    createdAt,
    status: 'IN_PROGRESS',
    ...dueDatesFor(createdAt, DEFAULT_SLA[p], cal),
    firstRespondedAt: null,
    pausedMins: 0,
    pausedSince: null,
    ...over,
  });

  it('HD-1042 (High, Mon 15:30) is due Tue 14:30 and on track this morning', () => {
    const t = clock(ist('2026-09-28T15:30'), 'HIGH', { firstRespondedAt: ist('2026-09-28T16:05') });
    expect(fmt(t.firstResponseDueAt)).toBe('2026-09-28 16:30');
    expect(fmt(t.resolutionDueAt)).toBe('2026-09-29 14:30');
    const ev = evaluateSla(t, DEFAULT_SLA.HIGH, now, cal);
    expect(ev.elapsedMins).toBe(190);
    expect(ev.state).toBe('ON_TRACK');
    expect(slaLabel({ ...t, slaState: 'ON_TRACK' }, DEFAULT_SLA.HIGH, now, cal).label).toBe('Due in 4 h 50 m');
  });

  it('HD-1041 (High, no response) breached its first response and sits at escalation level 1', () => {
    const t = clock(ist('2026-09-28T10:15'), 'HIGH', { status: 'OPEN' });
    expect(fmt(t.firstResponseDueAt)).toBe('2026-09-28 11:15');
    const ev = evaluateSla(t, DEFAULT_SLA.HIGH, now, cal);
    expect(ev.firstResponseBreached).toBe(true);
    expect(ev.level).toBe(1); // 505 of 480 min used (105 %) — level 2 only at 150 %
  });

  it('HD-1038 (Medium, Wed 10:20) resolved Thu 12:15 within its SLA; HD-1037 (Low) spans the holiday', () => {
    const t = clock(ist('2026-09-23T10:20'), 'MEDIUM', { firstRespondedAt: ist('2026-09-23T11:02') });
    expect(fmt(t.resolutionDueAt)).toBe('2026-09-25 16:20');
    expect(resolvedSlaState(t, ist('2026-09-24T12:15'))).toBe('MET');
    expect(fmt(clock(ist('2026-09-22T09:50'), 'LOW').resolutionDueAt)).toBe('2026-10-05 09:50');
  });
});
