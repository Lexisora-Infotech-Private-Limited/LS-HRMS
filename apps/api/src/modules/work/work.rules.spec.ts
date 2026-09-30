import { describe, expect, it } from 'vitest';
import {
  boardAccess,
  branchName,
  canMoveTask,
  computeHealth,
  computeProgress,
  meanScore,
  moveMessage,
  mrTitle,
  nextWorkingDay,
  planTransition,
  projectStatusLabel,
  shortName,
  suggestKey,
  taskKeysIn,
  weekStartOf,
  type TaskStatus,
} from './work.rules';
import { StubGitAdapter } from './adapters/git-stub.adapter';

const now = new Date('2026-09-29T06:00:00Z');
const d = (k: string) => new Date(`${k}T00:00:00Z`);
const H = (h: number) => h * 60;

describe('planTransition — git side effects', () => {
  const base = { hasRepo: true, assigneeEmployeeId: 'e1', moverEmployeeId: 'e1', startedAt: null, now };

  it('moving to WIP creates the feature branch and stamps startedAt', () => {
    const p = planTransition({ ...base, from: 'ALLOTTED', to: 'WIP' });
    expect(p.git).toBe('branch');
    expect(p.set.startedAt).toEqual(now);
    expect(p.backward).toBe(false);
  });

  it('moving to Dev Completed opens a merge request', () => {
    const p = planTransition({ ...base, from: 'WIP', to: 'DEV_COMPLETED', startedAt: d('2026-09-24') });
    expect(p.git).toBe('mr');
    expect(p.set.devCompletedAt).toEqual(now);
    expect(p.set.startedAt).toBeUndefined();
  });

  it('dragging straight from Open to Dev Completed still opens an MR (branch ensured by the adapter)', () => {
    expect(planTransition({ ...base, from: 'OPEN', to: 'DEV_COMPLETED' }).git).toBe('mr');
  });

  it('moving back from QA to WIP does not create another branch', () => {
    const p = planTransition({ ...base, from: 'QA', to: 'WIP', startedAt: d('2026-09-24') });
    expect(p.git).toBe('none');
    expect(p.backward).toBe(true);
  });

  it('no repository → no git side effect', () => {
    expect(planTransition({ ...base, hasRepo: false, from: 'ALLOTTED', to: 'WIP' }).git).toBe('none');
    expect(planTransition({ ...base, hasRepo: false, from: 'WIP', to: 'DEV_COMPLETED' }).git).toBe('none');
  });

  it('QA and Done stamp their timestamps; reopening from Done clears doneAt', () => {
    expect(planTransition({ ...base, from: 'DEV_COMPLETED', to: 'QA' }).set.qaAt).toEqual(now);
    expect(planTransition({ ...base, from: 'QA', to: 'DONE' }).set.doneAt).toEqual(now);
    expect(planTransition({ ...base, from: 'DONE', to: 'QA' }).set.doneAt).toBeNull();
  });

  it('moving back to Open unassigns; leaving Open without an assignee assigns the mover', () => {
    expect(planTransition({ ...base, from: 'ALLOTTED', to: 'OPEN' }).set.assigneeEmployeeId).toBeNull();
    expect(planTransition({ ...base, assigneeEmployeeId: null, moverEmployeeId: 'me', from: 'OPEN', to: 'ALLOTTED' }).set.assigneeEmployeeId).toBe('me');
    expect('assigneeEmployeeId' in planTransition({ ...base, from: 'OPEN', to: 'ALLOTTED' }).set).toBe(false);
  });
});

describe('moveMessage — wireframe toasts', () => {
  it('Dev Completed with a synced MR', () => {
    expect(moveMessage('AT-102', 'DEV_COMPLETED', { action: 'mr', status: 'SYNCED', branch: 'feature/at-102' })).toBe(
      'AT-102 → Dev Completed · pushed to GitLab (feature/at-102)',
    );
  });
  it('WIP with a new branch', () => {
    expect(moveMessage('AT-103', 'WIP', { action: 'branch', status: 'SYNCED', branch: 'feature/at-103', targetBranch: 'develop' })).toBe(
      'AT-103 → WIP · branch feature/at-103 created from develop',
    );
  });
  it('Mark done and failed sync', () => {
    expect(moveMessage('AT-106', 'DONE', { action: 'none', status: 'NONE' })).toBe('AT-106 closed');
    expect(moveMessage('AT-102', 'DEV_COMPLETED', { action: 'mr', status: 'FAILED' })).toMatch(/sync failed/);
    expect(moveMessage('AT-104', 'ALLOTTED', { action: 'none', status: 'NONE' })).toBe('AT-104 → Alloted');
  });
});

describe('git naming', () => {
  it('branch names are lower-case feature/<key>', () => {
    expect(branchName('AT-102')).toBe('feature/at-102');
    expect(branchName('KS-7', 'feat/{KEY}')).toBe('feat/ks-7');
    expect(branchName('AT-1', '//bad name/{key}//')).toBe('bad-name/at-1');
  });
  it('MR titles and key detection', () => {
    expect(mrTitle('AT-102', 'GST rounding rules')).toBe('AT-102: GST rounding rules');
    expect(taskKeysIn('AT-101 fix pdf; refs at-102 and feature/ks-43')).toEqual(['AT-101', 'AT-102', 'KS-43']);
  });
});

describe('StubGitAdapter', () => {
  it('records branch and MR URLs, numbers MRs and reuses an open MR for the same branch', async () => {
    let iid = 47;
    const stub = new StubGitAdapter(async () => ++iid);
    const repo = { repoUrl: 'https://gitlab.com/lexisora/atlas-crm.git', projectId: 1 } as any;
    const br = await stub.ensureBranch(repo, 'feature/at-102', 'develop');
    expect(br.url).toBe('https://gitlab.com/lexisora/atlas-crm/-/tree/feature/at-102');
    const mr = await stub.ensureMr(repo, { source: 'feature/at-102', target: 'develop', title: 'AT-102: GST rounding rules' });
    expect(mr).toMatchObject({ iid: 48, state: 'opened', created: true, url: 'https://gitlab.com/lexisora/atlas-crm/-/merge_requests/48' });
    const again = await stub.ensureMr(repo, { source: 'feature/at-102', target: 'develop', title: 'x' });
    expect(again).toMatchObject({ iid: 48, created: false });
    const other = await stub.ensureMr(repo, { source: 'feature/at-101', target: 'develop', title: 'y' });
    expect(other.iid).toBe(49);
    expect((await stub.testConnection()).ok).toBe(true);
  });
});

describe('board access', () => {
  const none = { viewAll: false, isDeptLead: false, isAllocated: false, isProjectLead: false };

  it('private board: members not allocated by the department lead cannot see it', () => {
    expect(boardAccess(none)).toEqual({ canView: false, canManage: false, canAllocate: false });
  });
  it('allocated members view but do not manage', () => {
    expect(boardAccess({ ...none, isAllocated: true })).toEqual({ canView: true, canManage: false, canAllocate: false });
  });
  it('department lead views, manages and allocates', () => {
    expect(boardAccess({ ...none, isDeptLead: true })).toEqual({ canView: true, canManage: true, canAllocate: true });
  });
  it('managers/admin (tasks.viewAllBoards) see every board', () => {
    expect(boardAccess({ ...none, viewAll: true })).toEqual({ canView: true, canManage: true, canAllocate: true });
  });
  it('project lead manages only boards they can see', () => {
    expect(boardAccess({ ...none, isProjectLead: true }).canView).toBe(false);
    expect(boardAccess({ ...none, isProjectLead: true }).canManage).toBe(false);
    expect(boardAccess({ ...none, isProjectLead: true, isAllocated: true })).toEqual({ canView: true, canManage: true, canAllocate: false });
  });
  it('members move their own or unassigned cards; managers move anything', () => {
    const member = { canManage: false, canView: true, me: 'priya' };
    expect(canMoveTask({ ...member, assigneeEmployeeId: 'priya' })).toBe(true);
    expect(canMoveTask({ ...member, assigneeEmployeeId: null })).toBe(true);
    expect(canMoveTask({ ...member, assigneeEmployeeId: 'rahul' })).toBe(false);
    expect(canMoveTask({ canManage: true, canView: true, me: 'arjun', assigneeEmployeeId: 'rahul' })).toBe(true);
    expect(canMoveTask({ canManage: true, canView: false, me: 'x', assigneeEmployeeId: null })).toBe(false);
  });
});

describe('project progress', () => {
  it('weights estimates by status, ignoring cancelled and standing tasks', () => {
    const tasks = [
      { status: 'DONE' as TaskStatus, estimatedMinutes: H(10) },
      { status: 'WIP' as TaskStatus, estimatedMinutes: H(10) },
      { status: 'CANCELLED' as TaskStatus, estimatedMinutes: H(50) },
      { status: 'WIP' as TaskStatus, estimatedMinutes: null, isStanding: true },
    ];
    expect(computeProgress(tasks)).toBe(63); // (10 + 2.5) / 20
  });
  it('un-broken-down budget counts as not started', () => {
    expect(computeProgress([{ status: 'DONE', estimatedMinutes: H(10) }], H(100))).toBe(10);
  });
  it('falls back to counts without estimates; empty is 0', () => {
    expect(computeProgress([{ status: 'DONE', estimatedMinutes: null }, { status: 'OPEN', estimatedMinutes: null }])).toBe(50);
    expect(computeProgress([])).toBe(0);
  });
  it('seeded Atlas CRM lands on the wireframe 64 %', () => {
    const tasks: { status: TaskStatus; estimatedMinutes: number | null; isStanding?: boolean }[] = [
      { status: 'DONE', estimatedMinutes: H(512) }, // history AT-77..AT-100
      { status: 'WIP', estimatedMinutes: H(8) },
      { status: 'DEV_COMPLETED', estimatedMinutes: H(5) },
      { status: 'ALLOTTED', estimatedMinutes: H(6) },
      { status: 'OPEN', estimatedMinutes: H(10) },
      { status: 'QA', estimatedMinutes: H(3) },
      { status: 'OPEN', estimatedMinutes: H(4) },
      { status: 'OPEN', estimatedMinutes: H(6) },
      { status: 'DONE', estimatedMinutes: H(4) },
      { status: 'WIP', estimatedMinutes: H(3) },
      { status: 'WIP', estimatedMinutes: null, isStanding: true },
    ];
    expect(computeProgress(tasks, H(820))).toBe(64);
  });
});

describe('project health', () => {
  const today = d('2026-09-29');
  const p = { status: 'ACTIVE' as const, estimatedMinutes: H(820), loggedMinutes: H(540), progressPct: 64, startDate: d('2026-03-02'), deadline: d('2026-12-18') };

  it('Atlas CRM is on track', () => {
    expect(computeHealth(p, today)).toEqual({ health: 'ON_TRACK', reason: null });
  });
  it('AT_RISK when logged/estimated exceeds progress by more than 15 points', () => {
    const r = computeHealth({ ...p, loggedMinutes: H(700), progressPct: 64 }, today);
    expect(r.health).toBe('AT_RISK');
    expect(r.reason).toBe('Logged 85% of estimate vs 64% progress');
    expect(computeHealth({ ...p, loggedMinutes: H(0.79 * 820), progressPct: 64 }, today).health).toBe('ON_TRACK');
  });
  it('AT_RISK when the deadline is near and progress < 80 %', () => {
    const r = computeHealth({ ...p, deadline: d('2026-10-09'), startDate: null, loggedMinutes: H(400), progressPct: 60 }, today);
    expect(r).toEqual({ health: 'AT_RISK', reason: 'Deadline in 10 days with 60% progress' });
  });
  it('seeded Kestrel mobile app is at risk (schedule almost elapsed)', () => {
    const r = computeHealth({ status: 'ACTIVE', estimatedMinutes: H(400), loggedMinutes: H(372), progressPct: 82, startDate: d('2026-04-01'), deadline: d('2026-10-02') }, today);
    expect(r).toEqual({ health: 'AT_RISK', reason: '98% of the schedule elapsed vs 82% progress' });
  });
  it('OFF_TRACK when the deadline passed or logged exceeds the estimate', () => {
    expect(computeHealth({ ...p, deadline: d('2026-09-20') }, today).health).toBe('OFF_TRACK');
    expect(computeHealth({ ...p, loggedMinutes: H(900), progressPct: 70 }, today).health).toBe('OFF_TRACK');
  });
  it('non-active projects have no health', () => {
    expect(computeHealth({ ...p, status: 'PLANNING' }, today).health).toBe('NA');
  });
  it('status column label', () => {
    expect(projectStatusLabel('ACTIVE', 'ON_TRACK')).toBe('On track');
    expect(projectStatusLabel('ACTIVE', 'AT_RISK')).toBe('At risk');
    expect(projectStatusLabel('PLANNING', 'NA')).toBe('Planning');
  });
});

describe('helpers', () => {
  it('shortName and suggestKey', () => {
    expect(shortName('Priya Sharma')).toBe('Priya S.');
    expect(shortName(null)).toBe('—');
    expect(suggestKey('Atlas CRM')).toBe('AT');
    expect(suggestKey('Orbit HR portal')).toBe('OR');
    expect(suggestKey('Atlas Two', new Set(['AT']))).toBe('ATL');
  });
  it('intern week helpers', () => {
    expect(weekStartOf('2026-09-29')).toBe('2026-09-28');
    expect(nextWorkingDay('2026-10-03')).toBe('2026-10-05');
    expect(meanScore([4, 5, null, 4.5])).toBe(4.5);
  });
});
